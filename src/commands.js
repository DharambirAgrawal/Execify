// Commands are named operations that do not require the caller to write code.
const { execFile } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const https = require('https')
const http = require('http')
const { getWorker, markBusy, markFree } = require('./pool')
const config = require('./config')

const execFileAsync = promisify(execFile)

const SAFE_FILENAME_RE = config.SAFE_FILENAME_RE
const FETCH_TIMEOUT_MS = config.commands.fetchTimeoutMs
const ALLOWED_HTTP_METHODS = new Set(config.commands.allowedHttpMethods)
const ALLOWED_COMMAND_FILE_EXTENSIONS = new Set([
  ...config.execution.allowedInputExtensions,
  ...config.execution.allowedOutputExtensions
])

function sanitizeFilename(rawName) {
  if (typeof rawName !== 'string') {
    throw new Error('filename must be a string')
  }

  const filename = path.basename(rawName.trim())
  if (!SAFE_FILENAME_RE.test(filename)) {
    throw new Error('Invalid filename. Use only letters, numbers, dot, dash, underscore.')
  }

  return filename
}

async function dockerExec(args) {
  return execFileAsync('docker', args, { maxBuffer: config.execution.maxDockerBufferBytes })
}

async function writeFileToContainer(worker, filename, dataBuffer) {
  const base64 = dataBuffer.toString('base64')
  await dockerExec([
    'exec',
    worker.name,
    'bash',
    '-c',
    `echo '${base64}' | base64 -d > /workspace/${filename}`
  ])
}

async function readFileFromContainer(worker, filename) {
  const { stdout } = await dockerExec([
    'exec',
    worker.name,
    'bash',
    '-c',
    `base64 -w 0 /workspace/${filename}`
  ])
  return Buffer.from(String(stdout).trim(), 'base64')
}

// Only these URLs can be fetched via fetch_url
// Add to this list as needed
const URL_WHITELIST = new Set([
  ...config.commands.urlWhitelist
])

function isWhitelisted(url) {
  try {
    const parsed = new URL(url)
    return URL_WHITELIST.has(parsed.origin)
  } catch {
    return false
  }
}

function getExtension(filename) {
  return path.extname(filename || '').toLowerCase()
}

function ensureAllowedCommandExtension(filename) {
  const ext = getExtension(filename)
  if (!ext || !ALLOWED_COMMAND_FILE_EXTENSIONS.has(ext)) {
    throw new Error(`Extension not allowed for command file: ${ext || '(none)'}`)
  }
}

const COMMANDS = {

  fetch_url: async ({ url, method = 'GET', body = null, headers = {} }) => {
    if (typeof url !== 'string' || !isWhitelisted(url)) {
      return { error: `URL not in whitelist: ${url}` }
    }

    const normalizedMethod = String(method || 'GET').toUpperCase()
    if (!ALLOWED_HTTP_METHODS.has(normalizedMethod)) {
      return { error: `Unsupported HTTP method: ${method}` }
    }

    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http
      const options = {
        method: normalizedMethod,
        timeout: FETCH_TIMEOUT_MS,
        headers: { 'User-Agent': 'Execify/1.0', ...headers }
      }

      const req = lib.request(url, options, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        }))
      })

      req.setTimeout(FETCH_TIMEOUT_MS, () => {
        req.destroy(new Error('Request timed out'))
      })
      req.on('error', err => resolve({ error: err.message }))
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
      req.end()
    })
  },

  write_file: async ({ filename, content, encoding = 'utf8' }, worker) => {
    if (!worker) return { error: 'No worker available' }
    const safeFilename = sanitizeFilename(filename)
    ensureAllowedCommandExtension(safeFilename)

    if (typeof content !== 'string') {
      return { error: 'content must be a string' }
    }

    const data = encoding === 'base64'
      ? Buffer.from(content, 'base64')
      : Buffer.from(content, 'utf8')

    await writeFileToContainer(worker, safeFilename, data)
    return { success: true, filename: safeFilename }
  },

  read_file: async ({ filename }, worker) => {
    if (!worker) return { error: 'No worker available' }
    const safeFilename = sanitizeFilename(filename)
    ensureAllowedCommandExtension(safeFilename)

    const content = await readFileFromContainer(worker, safeFilename)
    return {
      filename: safeFilename,
      content: content.toString('base64'),
      size: content.length
    }
  },

  list_dir: async ({}, worker) => {
    if (!worker) return { error: 'No worker available' }
    const { stdout } = await dockerExec(['exec', worker.name, 'ls', '-la', '/workspace/'])
    return { listing: stdout.trim() }
  },

  delete_file: async ({ filename }, worker) => {
    if (!worker) return { error: 'No worker available' }
    const safeFilename = sanitizeFilename(filename)
    ensureAllowedCommandExtension(safeFilename)
    await dockerExec(['exec', worker.name, 'rm', '-f', `/workspace/${safeFilename}`])
    return { success: true, deleted: safeFilename }
  },

  zip_files: async ({ filenames, output_name = 'output.zip' }, worker) => {
    if (!worker) return { error: 'No worker available' }
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return { error: 'filenames must be a non-empty array' }
    }

    const safeOutputName = sanitizeFilename(output_name)
    ensureAllowedCommandExtension(safeOutputName)
    const safeFiles = filenames.map(sanitizeFilename)
    safeFiles.forEach(ensureAllowedCommandExtension)

    await dockerExec([
      'exec',
      worker.name,
      'zip',
      '-j',
      `/workspace/${safeOutputName}`,
      ...safeFiles.map(name => `/workspace/${name}`)
    ])

    return { success: true, zip_file: safeOutputName }
  },

  clear_workspace: async ({}, worker) => {
    if (!worker) return { error: 'No worker available' }
    await dockerExec(['exec', worker.name, 'find', '/workspace', '-mindepth', '1', '-delete'])
    return { success: true }
  }

}

async function runCommand(commandName, params, workerOverride = null) {
  const handler = COMMANDS[commandName]

  if (!handler) {
    return {
      status: 400,
      error: `Unknown command: ${commandName}`,
      available: Object.keys(COMMANDS)
    }
  }

  const needsWorker = ['write_file', 'read_file', 'list_dir',
                        'delete_file', 'zip_files', 'clear_workspace']

  let worker = null
  const manageWorker = !workerOverride && needsWorker.includes(commandName)

  if (manageWorker) {
    worker = getWorker()
    if (!worker) return { error: 'No workers available' }
    markBusy(worker)
  } else if (workerOverride) {
    worker = workerOverride
  }

  try {
    const result = await handler(params, worker)
    if (result && result.error && !result.status) {
      return { ...result, status: 400 }
    }
    return result
  } catch (err) {
    return { status: 400, error: err.message }
  } finally {
    if (manageWorker && worker) markFree(worker)
  }
}

module.exports = { runCommand, COMMANDS }