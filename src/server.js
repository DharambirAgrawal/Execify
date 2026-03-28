require('dotenv').config()
const express = require('express')
const { execFile } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const { initPool, getWorker, markBusy, markFree } = require('./pool')
const { runCode, getExecutionPolicy } = require('./executor')
const { runCommand, COMMANDS } = require('./commands')
const { requireApiKey } = require('./auth')
const config = require('./config')

const execFileAsync = promisify(execFile)
const SAFE_FILENAME_RE = config.SAFE_FILENAME_RE

async function dockerExec(args) {
  return execFileAsync('docker', args, {
    maxBuffer: config.execution.maxDockerBufferBytes
  })
}

async function dockerExecWithTimeout(args, timeoutMs) {
  return Promise.race([
    dockerExec(args),
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('MODULE_PROBE_TIMEOUT')), timeoutMs)
    )
  ])
}

function safeParseJson(text, fallback = []) {
  try {
    return JSON.parse(text)
  } catch {
    return fallback
  }
}

function sanitizeDocxFilename(rawName) {
  if (typeof rawName !== 'string') {
    throw new Error('filename must be a string')
  }

  const fileName = path.basename(rawName.trim())
  if (!SAFE_FILENAME_RE.test(fileName) || !fileName.toLowerCase().endsWith('.docx')) {
    throw new Error('filename must be a safe .docx file name')
  }

  return fileName
}

const app = express()
app.use(express.json({ limit: config.app.requestBodyLimit }))

// Health check — no auth needed
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// List available languages and commands — no auth needed
app.get('/capabilities', (req, res) => {
  const policy = getExecutionPolicy()

  res.json({
      languages: config.execution.languages,
    commands: Object.keys(COMMANDS),
      endpoints: {
        run: '/run',
        module_inventory: '/installed-modules',
        convert_docx_to_pdf: '/convert/docx-to-pdf'
      },
    limits: {
        timeout_seconds: config.execution.timeoutSeconds,
        max_memory_mb: config.limits.maxMemoryMb,
        max_file_size_mb: config.limits.maxFileSizeMb
    },
    policy: {
      allowed_input_extensions: policy.allowedInputExtensions,
      allowed_output_extensions: policy.allowedOutputExtensions,
      persist_outputs: policy.persistOutputs,
      persisted_output_dir: policy.persistOutputDir
    },
      retry_rules: config.retryRules
  })
})

// Return available Python and Node modules from a live sandbox worker.
app.get('/installed-modules', requireApiKey, async (req, res) => {
  const worker = getWorker()
  if (!worker) {
    return res.status(503).json({ error: 'No workers available for module probe' })
  }

  markBusy(worker)

  try {
    const timeoutMs = config.execution.moduleProbeTimeoutMs
    const maxItems = config.execution.moduleListMaxItems

    const pythonScript = [
      'import json, pkgutil',
      'mods = sorted({m.name.split(".")[0] for m in pkgutil.iter_modules()})',
      'print(json.dumps(mods))'
    ].join(';')

    const nodeBuiltinScript = [
      'const { builtinModules } = require("module")',
      'const mods = Array.from(new Set(builtinModules.map(m => m.replace(/^node:/, "")))).sort()',
      'process.stdout.write(JSON.stringify(mods))'
    ].join(';')

    const pythonResult = await dockerExecWithTimeout(
      ['exec', worker.name, 'python3', '-c', pythonScript],
      timeoutMs
    )

    const nodeBuiltinResult = await dockerExecWithTimeout(
      ['exec', worker.name, 'node', '-e', nodeBuiltinScript],
      timeoutMs
    )

    let nodeGlobalPackages = []
    try {
      const nodeGlobalResult = await dockerExecWithTimeout(
        ['exec', worker.name, 'npm', 'ls', '-g', '--depth=0', '--json'],
        timeoutMs
      )
      const parsed = safeParseJson(nodeGlobalResult.stdout, {})
      nodeGlobalPackages = Object.keys(parsed.dependencies || {}).sort()
    } catch {
      nodeGlobalPackages = []
    }

    const pythonModules = safeParseJson(pythonResult.stdout, [])
    const nodeBuiltinModules = safeParseJson(nodeBuiltinResult.stdout, [])

    return res.json({
      worker: worker.name,
      timestamp: new Date().toISOString(),
      python: {
        modules: pythonModules.slice(0, maxItems),
        total: pythonModules.length,
        truncated: pythonModules.length > maxItems
      },
      node: {
        builtin_modules: nodeBuiltinModules.slice(0, maxItems),
        builtin_total: nodeBuiltinModules.length,
        global_packages: nodeGlobalPackages.slice(0, maxItems),
        global_total: nodeGlobalPackages.length,
        truncated: nodeBuiltinModules.length > maxItems || nodeGlobalPackages.length > maxItems
      }
    })
  } catch (err) {
    if (err.message === 'MODULE_PROBE_TIMEOUT') {
      return res.status(504).json({ error: 'Module probe timed out' })
    }

    return res.status(500).json({ error: err.message })
  } finally {
    markFree(worker)
  }
})

// Main execution endpoint — auth required
app.post('/run', requireApiKey, async (req, res) => {
  const { type, language, code, files, command, params } = req.body

  if (!type) {
    return res.status(400).json({ error: 'Missing field: type (execute or command)' })
  }

  if (type === 'execute') {
    if (!language || !config.execution.languages.includes(language)) {
      return res.status(400).json({ error: 'language must be python or node' })
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing field: code' })
    }
    if (code.length > config.execution.codeMaxChars) {
      const maxKb = Math.round(config.execution.codeMaxChars / 1024)
      return res.status(400).json({ error: `Code too large (max ${maxKb}kb)` })
    }

    const result = await runCode(language, code, files || [])

    if (result.status === 503) {
      return res.status(503).json({ error: result.error })
    }

    if (
      result.errorType === 'syntax_error' ||
      result.errorType === 'missing_dependency' ||
      result.errorType === 'input_validation'
    ) {
      return res.status(422).json(result)
    }

    return res.json(result)
  }

  if (type === 'command') {
    if (!command) {
      return res.status(400).json({ error: 'Missing field: command' })
    }

    const result = await runCommand(command, params || {})
    return res.json(result)
  }

  return res.status(400).json({ error: 'type must be execute or command' })
})

// Host utility endpoint (outside sandbox): convert DOCX to PDF via LibreOffice.
app.post('/convert/docx-to-pdf', requireApiKey, async (req, res) => {
  const { file, filename } = req.body || {}

  if (!file || !filename) {
    return res.status(400).json({ error: 'Missing file or filename' })
  }

  let tempDir = ''

  try {
    const safeFilename = sanitizeDocxFilename(filename)
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'execify-convert-'))

    const inputPath = path.join(tempDir, safeFilename)
    await fs.writeFile(inputPath, Buffer.from(file, 'base64'))

    await execFileAsync('libreoffice', [
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      tempDir,
      inputPath
    ])

    const pdfName = safeFilename.replace(/\.docx$/i, '.pdf')
    const pdfPath = path.join(tempDir, pdfName)
    const pdfContent = await fs.readFile(pdfPath)

    return res.json({
      filename: pdfName,
      content: pdfContent.toString('base64'),
      size: pdfContent.length
    })
  } catch (err) {
    return res.status(500).json({ error: err.message })
  } finally {
    if (tempDir) {
      try {
        await fs.rm(tempDir, { recursive: true, force: true })
      } catch {}
    }
  }
})

const PORT = config.app.port

async function start() {
  await initPool()
  app.listen(PORT, () => {
    console.log(`Execify running on port ${PORT}`)
  })
}

start()