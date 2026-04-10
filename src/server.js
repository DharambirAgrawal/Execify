require('dotenv').config()
const express = require('express')
const { execFile } = require('child_process')
const { promisify } = require('util')
const path = require('path')
const { initPool, getWorker, markBusy, markFree, cleanWorkerWorkspace } = require('./pool')
const { runCode, runCodeStream, getExecutionPolicy } = require('./executor')
const { runCommand, COMMANDS } = require('./commands')
const { requireApiKey } = require('./auth')
const { createSession, deleteSession, getSession, beginSessionUse, endSessionUse, getSessionSnapshot } = require('./sessionManager')
const { recordUsage, getUsage } = require('./usageTracker')
const config = require('./config')

const execFileAsync = promisify(execFile)
const SAFE_FILENAME_RE = config.SAFE_FILENAME_RE
let docxConverterBinary = null

async function dockerExec(args) {
  return execFileAsync('docker', args, {
    maxBuffer: config.execution.maxDockerBufferBytes
  })
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

async function writeBase64FileToWorker(worker, filename, base64Content) {
  await dockerExec([
    'exec',
    worker.name,
    'bash',
    '-lc',
    `printf '%s' '${base64Content}' | base64 -d > /workspace/${filename}`
  ])
}

async function readBase64FileFromWorker(worker, filename) {
  const { stdout } = await dockerExec([
    'exec',
    worker.name,
    'bash',
    '-lc',
    `base64 -w 0 /workspace/${filename}`
  ])

  return String(stdout).trim()
}

async function detectDocxConverterBinary() {
  const worker = getWorker()
  if (!worker) {
    return null
  }

  for (const candidate of ['libreoffice', 'soffice']) {
    try {
      await dockerExec(['exec', worker.name, candidate, '--version'])
      return candidate
    } catch {}
  }

  return null
}

function normalizeRunPayload(req) {
  const source = req.method === 'GET'
    ? { ...req.query }
    : { ...(req.body || {}) }

  if (typeof source.payload === 'string') {
    const parsed = safeParseJson(source.payload, null)
    if (parsed && typeof parsed === 'object') {
      return parsed
    }
  }

  if (typeof source.files === 'string') {
    source.files = safeParseJson(source.files, source.files)
  }

  if (typeof source.params === 'string') {
    source.params = safeParseJson(source.params, source.params)
  }

  return source
}

function validateRunPayload(payload) {
  if (!payload.type) {
    return { status: 400, error: 'Missing field: type (execute or command)' }
  }

  if (payload.type === 'execute') {
    if (!payload.language || !config.execution.languages.includes(payload.language)) {
      return { status: 400, error: 'language must be python or node' }
    }

    if (!payload.code || typeof payload.code !== 'string') {
      return { status: 400, error: 'Missing field: code' }
    }

    if (payload.code.length > config.execution.codeMaxChars) {
      const maxKb = Math.round(config.execution.codeMaxChars / 1024)
      return { status: 400, error: `Code too large (max ${maxKb}kb)` }
    }
  }

  if (payload.type === 'command' && !payload.command) {
    return { status: 400, error: 'Missing field: command' }
  }

  if (payload.type !== 'execute' && payload.type !== 'command') {
    return { status: 400, error: 'type must be execute or command' }
  }

  return null
}

function sendSseEvent(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

function sendSseError(res, error, status = 400) {
  sendSseEvent(res, {
    type: 'error',
    status,
    error: typeof error === 'string' ? error : String(error)
  })
  res.end()
}

async function resolveSessionWorker(sessionId) {
  if (!sessionId) {
    return { session: null, worker: null }
  }

  const session = getSession(sessionId)
  if (!session) {
    return { error: { status: 404, error: `Unknown session: ${sessionId}` } }
  }

  if (!beginSessionUse(session)) {
    return { error: { status: 409, error: `Session is busy: ${sessionId}` } }
  }

  return { session, worker: session.worker }
}

async function handleRun(payload, apiKey, { stream = false, res = null } = {}) {
  const startedAt = Date.now()
  const validationError = validateRunPayload(payload)
  if (validationError) {
    recordUsage(apiKey, {
      kind: payload.type === 'command' ? 'command' : (stream ? 'streamRun' : 'run'),
      durationMs: Date.now() - startedAt,
      language: payload.language || null,
      command: payload.command || null,
      sessionId: payload.session_id || payload.sessionId || null,
      status: validationError.status,
      streamed: stream
    })

    if (stream && res) {
      sendSseError(res, validationError.error, validationError.status)
      return null
    }

    return { status: validationError.status, body: { error: validationError.error } }
  }

  const sessionId = payload.session_id || payload.sessionId || null
  const sessionResolution = await resolveSessionWorker(sessionId)
  if (sessionResolution.error) {
    recordUsage(apiKey, {
      kind: payload.type === 'command' ? 'command' : (stream ? 'streamRun' : 'run'),
      durationMs: Date.now() - startedAt,
      language: payload.language || null,
      command: payload.command || null,
      sessionId,
      status: sessionResolution.error.status,
      streamed: stream
    })

    if (stream && res) {
      sendSseError(res, sessionResolution.error.error, sessionResolution.error.status)
      return null
    }

    return { status: sessionResolution.error.status, body: { error: sessionResolution.error.error } }
  }

  const { session, worker } = sessionResolution

  try {
    let result

    if (payload.type === 'execute') {
      const onStdoutLine = stream && res
        ? (line) => sendSseEvent(res, { type: 'stdout', line })
        : undefined
      const onStderrLine = stream && res
        ? (line) => sendSseEvent(res, { type: 'stderr', line })
        : undefined

      const runner = stream ? runCodeStream : runCode

      result = await runner(
        payload.language,
        payload.code,
        Array.isArray(payload.files) ? payload.files : [],
        {
          worker,
          resetWorkspace: !session,
          onStdoutLine,
          onStderrLine
        }
      )
    } else {
      result = await runCommand(payload.command, payload.params || {}, worker)
    }

    const durationMs = Date.now() - startedAt
    recordUsage(apiKey, {
      kind: payload.type === 'execute' ? (stream ? 'streamRun' : 'run') : 'command',
      durationMs,
      language: payload.language || null,
      command: payload.command || null,
      sessionId,
      exitCode: result.exitCode ?? null,
      status: result.status ?? 200,
      streamed: stream
    })

    if (payload.type === 'execute' && session) {
      result.session_id = session.sessionId
      result.session = getSessionSnapshot(session.sessionId)
    }

    if (stream && res) {
      sendSseEvent(res, {
        type: 'done',
        exit_code: result.exitCode ?? 0,
        error_type: result.errorType ?? null,
        retryable: Boolean(result.retryable),
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        output_files: result.outputFiles || [],
        session_id: session ? session.sessionId : null,
        worker: session ? session.worker.name : null
      })
      res.end()
      return null
    }

    return {
      status: result.status && result.status !== 200 ? result.status : (result.errorType ? 422 : 200),
      body: result
    }
  } finally {
    if (session) {
      endSessionUse(session)
    }
  }
}

const app = express()
app.use(express.json({ limit: config.app.requestBodyLimit }))

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

app.get('/capabilities', (req, res) => {
  const policy = getExecutionPolicy()

  res.json({
    languages: config.execution.languages,
    commands: Object.keys(COMMANDS),
    endpoints: {
      run: '/run',
      run_stream: '/run/stream',
      session_create: '/session/create',
      session_delete: '/session/:session_id',
      usage: '/usage',
      module_inventory: '/installed-modules',
      convert_docx_to_pdf: '/convert/docx-to-pdf'
    },
    host_utilities: {
      docx_to_pdf_available: Boolean(docxConverterBinary),
      docx_to_pdf_binary: docxConverterBinary
    },
    features: {
      session_workspaces: true,
      streaming_output: true,
      usage_tracking: true,
      container_docx_conversion: true
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

app.get('/usage', requireApiKey, (req, res) => {
  res.json(getUsage(req.apiKey))
})

app.get('/installed-modules', requireApiKey, async (req, res) => {
  const startedAt = Date.now()
  const worker = getWorker()
  if (!worker) {
    recordUsage(req.apiKey, { kind: 'moduleInventory', durationMs: Date.now() - startedAt, status: 503 })
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
    ].join('\n')

    const nodeBuiltinScript = [
      'const { builtinModules } = require("module")',
      'const mods = Array.from(new Set(builtinModules.map(m => m.replace(/^node:/, "")))).sort()',
      'process.stdout.write(JSON.stringify(mods))'
    ].join('\n')

    const pythonResult = await Promise.race([
      dockerExec(['exec', worker.name, 'python3', '-c', pythonScript]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MODULE_PROBE_TIMEOUT')), timeoutMs))
    ])

    const nodeBuiltinResult = await Promise.race([
      dockerExec(['exec', worker.name, 'node', '-e', nodeBuiltinScript]),
      new Promise((_, reject) => setTimeout(() => reject(new Error('MODULE_PROBE_TIMEOUT')), timeoutMs))
    ])

    let nodeGlobalPackages = []
    try {
      const nodeGlobalResult = await Promise.race([
        dockerExec(['exec', worker.name, 'npm', 'ls', '-g', '--depth=0', '--json']),
        new Promise((_, reject) => setTimeout(() => reject(new Error('MODULE_PROBE_TIMEOUT')), timeoutMs))
      ])
      const parsed = safeParseJson(nodeGlobalResult.stdout, {})
      nodeGlobalPackages = Object.keys(parsed.dependencies || {}).sort()
    } catch {
      nodeGlobalPackages = []
    }

    const pythonModules = safeParseJson(pythonResult.stdout, [])
    const nodeBuiltinModules = safeParseJson(nodeBuiltinResult.stdout, [])

    recordUsage(req.apiKey, { kind: 'moduleInventory', durationMs: Date.now() - startedAt, status: 200 })

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
    recordUsage(req.apiKey, {
      kind: 'moduleInventory',
      durationMs: Date.now() - startedAt,
      status: err.message === 'MODULE_PROBE_TIMEOUT' ? 504 : 500
    })

    if (err.message === 'MODULE_PROBE_TIMEOUT') {
      return res.status(504).json({ error: 'Module probe timed out' })
    }

    return res.status(500).json({ error: err.message })
  } finally {
    markFree(worker)
  }
})

app.post('/session/create', requireApiKey, async (req, res) => {
  const startedAt = Date.now()
  const result = await createSession({ expiresIn: req.body?.expires_in ?? req.body?.expiresIn })

  if (result.status === 503) {
    recordUsage(req.apiKey, { kind: 'sessionCreate', durationMs: Date.now() - startedAt, status: 503 })
    return res.status(503).json({ error: result.error })
  }

  recordUsage(req.apiKey, { kind: 'sessionCreate', durationMs: Date.now() - startedAt, status: 200 })
  return res.status(201).json(result)
})

app.delete('/session/:session_id', requireApiKey, async (req, res) => {
  const startedAt = Date.now()
  const result = await deleteSession(req.params.session_id)

  if (!result) {
    recordUsage(req.apiKey, { kind: 'sessionDelete', durationMs: Date.now() - startedAt, status: 404 })
    return res.status(404).json({ error: 'Session not found' })
  }

  if (result.error) {
    recordUsage(req.apiKey, { kind: 'sessionDelete', durationMs: Date.now() - startedAt, status: result.status || 409 })
    return res.status(result.status || 409).json({ error: result.error })
  }

  recordUsage(req.apiKey, { kind: 'sessionDelete', durationMs: Date.now() - startedAt, status: 200 })
  return res.json({ success: true, ...result })
})

app.post('/run', requireApiKey, async (req, res) => {
  const startedAt = Date.now()
  const payload = normalizeRunPayload(req)
  const outcome = await handleRun(payload, req.apiKey, { stream: false })

  if (!outcome) {
    return
  }

  return res.status(outcome.status).json(outcome.body)
})

async function handleStreamRun(req, res) {
  const startedAt = Date.now()
  const payload = normalizeRunPayload(req)

  res.status(200)
  res.set({
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive'
  })
  res.flushHeaders?.()

  const outcome = await handleRun(payload, req.apiKey, { stream: true, res })
  if (outcome) {
    recordUsage(req.apiKey, {
      kind: 'streamRun',
      durationMs: Date.now() - startedAt,
      language: payload.language || null,
      command: payload.command || null,
      sessionId: payload.session_id || payload.sessionId || null,
      status: outcome.status,
      streamed: true
    })

    sendSseEvent(res, {
      type: 'done',
      exit_code: outcome.body?.exitCode ?? 0,
      error_type: outcome.body?.errorType ?? null,
      retryable: Boolean(outcome.body?.retryable),
      stdout: outcome.body?.stdout || '',
      stderr: outcome.body?.stderr || '',
      output_files: outcome.body?.outputFiles || [],
      session_id: outcome.body?.session_id || null,
      worker: outcome.body?.worker || null
    })
    res.end()
  }
}

app.get('/run/stream', requireApiKey, handleStreamRun)
app.post('/run/stream', requireApiKey, handleStreamRun)

app.post('/convert/docx-to-pdf', requireApiKey, async (req, res) => {
  const startedAt = Date.now()
  const { file, filename } = req.body || {}

  if (!file || !filename) {
    recordUsage(req.apiKey, { kind: 'conversion', durationMs: Date.now() - startedAt, status: 400 })
    return res.status(400).json({ error: 'Missing file or filename' })
  }

  if (!docxConverterBinary) {
    recordUsage(req.apiKey, { kind: 'conversion', durationMs: Date.now() - startedAt, status: 503 })
    return res.status(503).json({ error: 'DOCX to PDF conversion unavailable: libreoffice/soffice not installed in the sandbox image' })
  }

  let safeFilename
  try {
    safeFilename = sanitizeDocxFilename(filename)
  } catch (err) {
    recordUsage(req.apiKey, { kind: 'conversion', durationMs: Date.now() - startedAt, status: 400 })
    return res.status(400).json({ error: err.message })
  }

  const worker = getWorker()
  if (!worker) {
    recordUsage(req.apiKey, { kind: 'conversion', durationMs: Date.now() - startedAt, status: 503 })
    return res.status(503).json({ error: 'No workers available for conversion' })
  }

  markBusy(worker)

  try {
    const pdfName = safeFilename.replace(/\.docx$/i, '.pdf')

    await cleanWorkerWorkspace(worker)
    await writeBase64FileToWorker(worker, safeFilename, String(file))

    await dockerExec([
      'exec',
      worker.name,
      docxConverterBinary,
      '--headless',
      '--convert-to',
      'pdf',
      '--outdir',
      '/workspace',
      `/workspace/${safeFilename}`
    ])

    const pdfContent = await readBase64FileFromWorker(worker, pdfName)

    recordUsage(req.apiKey, { kind: 'conversion', durationMs: Date.now() - startedAt, status: 200 })

    return res.json({
      filename: pdfName,
      content: pdfContent,
      size: Buffer.from(pdfContent, 'base64').length,
      worker: worker.name
    })
  } catch (err) {
    recordUsage(req.apiKey, { kind: 'conversion', durationMs: Date.now() - startedAt, status: 500 })
    return res.status(500).json({ error: err.message })
  } finally {
    try {
      await cleanWorkerWorkspace(worker)
    } catch {}
    markFree(worker)
  }
})

const PORT = config.app.port

async function start() {
  await initPool()
  docxConverterBinary = await detectDocxConverterBinary()

  if (!docxConverterBinary) {
    console.warn('DOCX converter unavailable in the sandbox image: install libreoffice to enable /convert/docx-to-pdf')
  }

  app.listen(PORT, () => {
    console.log(`Execify running on port ${PORT}`)
  })
}

start().catch((err) => {
  console.error(err)
  process.exit(1)
})