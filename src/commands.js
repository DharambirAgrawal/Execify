// Commands are named operations that do not require the caller to write code.
const { execFile } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const https = require('https')
const http = require('http')
const { getWorker, markBusy, markFree } = require('./pool')

const execFileAsync = promisify(execFile)

const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/
const FETCH_TIMEOUT_MS = 10000
const ALLOWED_HTTP_METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])

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

function getTempPath(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
}

async function dockerExec(args) {
  return execFileAsync('docker', args, { maxBuffer: 10 * 1024 * 1024 })
}

// Only these URLs can be fetched via fetch_url
// Add to this list as needed
const URL_WHITELIST = new Set([
  'https://api.github.com',
  'https://jsonplaceholder.typicode.com',
  // add your trusted domains here
])

function isWhitelisted(url) {
  try {
    const parsed = new URL(url)
    return URL_WHITELIST.has(parsed.origin)
  } catch {
    return false
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
    const tmpPath = getTempPath('execify-write')
    const data = encoding === 'base64'
      ? Buffer.from(content, 'base64')
      : Buffer.from(content, 'utf8')
    await fs.writeFile(tmpPath, data)
    await dockerExec(['cp', tmpPath, `${worker.name}:/workspace/${safeFilename}`])
    await fs.unlink(tmpPath)
    return { success: true, filename: safeFilename }
  },

  read_file: async ({ filename }, worker) => {
    if (!worker) return { error: 'No worker available' }
    const safeFilename = sanitizeFilename(filename)
    const tmpPath = getTempPath('execify-read')
    await dockerExec(['cp', `${worker.name}:/workspace/${safeFilename}`, tmpPath])
    const content = await fs.readFile(tmpPath)
    await fs.unlink(tmpPath)
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
    await dockerExec(['exec', worker.name, 'rm', '-f', `/workspace/${safeFilename}`])
    return { success: true, deleted: safeFilename }
  },

  zip_files: async ({ filenames, output_name = 'output.zip' }, worker) => {
    if (!worker) return { error: 'No worker available' }
    if (!Array.isArray(filenames) || filenames.length === 0) {
      return { error: 'filenames must be a non-empty array' }
    }

    const safeOutputName = sanitizeFilename(output_name)
    const safeFiles = filenames.map(sanitizeFilename)

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

async function runCommand(commandName, params) {
  const handler = COMMANDS[commandName]

  if (!handler) {
    return {
      error: `Unknown command: ${commandName}`,
      available: Object.keys(COMMANDS)
    }
  }

  const needsWorker = ['write_file', 'read_file', 'list_dir',
                        'delete_file', 'zip_files', 'clear_workspace']

  let worker = null
  if (needsWorker.includes(commandName)) {
    worker = getWorker()
    if (!worker) return { error: 'No workers available' }
    markBusy(worker)
  }

  try {
    const result = await handler(params, worker)
    return result
  } catch (err) {
    return { error: err.message }
  } finally {
    if (worker) markFree(worker)
  }
}

module.exports = { runCommand, COMMANDS }