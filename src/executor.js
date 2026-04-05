// This is the core function and It takes code and a language, copies the code into the container, runs it, and returns what came out.

const { execFile } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises
const fsSync = require('fs')
const os = require('os')
const path = require('path')
const { builtinModules } = require('module')
const { v4: uuidv4 } = require('uuid')
const { getWorker, markBusy, markFree, cleanWorkerWorkspace } = require('./pool')
const config = require('./config')

const execFileAsync = promisify(execFile)

const TIMEOUT_MS = config.execution.timeoutMs
const SAFE_FILENAME_RE = config.SAFE_FILENAME_RE
const BUILTIN_JS_MODULES = new Set(builtinModules.map(m => m.replace(/^node:/, '')))
const PERSIST_OUTPUTS = config.execution.persistOutputs
const PERSIST_OUTPUT_DIR = config.execution.persistOutputDir
const ALLOWED_INPUT_EXTENSIONS = config.execution.allowedInputExtensions
const ALLOWED_OUTPUT_EXTENSIONS = config.execution.allowedOutputExtensions

function getExtension(filename) {
  return path.extname(filename || '').toLowerCase()
}

function isAllowedInputExtension(filename) {
  return ALLOWED_INPUT_EXTENSIONS.includes(getExtension(filename))
}

function isAllowedOutputExtension(filename) {
  return ALLOWED_OUTPUT_EXTENSIONS.includes(getExtension(filename))
}

function classifyExecutionError(err) {
  const stderr = String(err?.stderr || '')
  const message = String(err?.message || '')
  const combined = `${stderr}\n${message}`

  // GNU timeout exits with 124 when child exceeds time budget.
  if (Number(err?.code) === 124 || /\bexit code 124\b|\btimeout\b/i.test(combined)) {
    return {
      errorType: 'timeout',
      retryable: true,
      userMessage: 'Execution timed out'
    }
  }

  if (/Input extension not allowed|Invalid input file name|Each input file must be an object|files must be an array|Invalid content for file/.test(combined)) {
    return {
      errorType: 'input_validation',
      retryable: false,
      userMessage: 'Input validation failed. Fix request payload before retrying.'
    }
  }

  if (/No module named\s+['\"][^'\"]+['\"]/.test(combined) || /Cannot find module/.test(combined) || /MISSING_MODULES:/.test(combined)) {
    return {
      errorType: 'missing_dependency',
      retryable: false,
      userMessage: 'Missing dependency. Use installed libraries only or adjust code.'
    }
  }

  if (/SyntaxError|invalid syntax|Unexpected token|Failed to compile/.test(combined)) {
    return {
      errorType: 'syntax_error',
      retryable: false,
      userMessage: 'Syntax error detected. Fix code before retrying.'
    }
  }

  return {
    errorType: 'runtime_error',
    retryable: true,
    userMessage: 'Runtime error during execution.'
  }
}

function extractPythonImports(code) {
  const modules = new Set()
  const lines = String(code || '').split('\n')

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    const importMatch = trimmed.match(/^import\s+(.+)$/)
    if (importMatch) {
      const parts = importMatch[1].split(',')
      for (const part of parts) {
        const candidate = part.trim().split(/\s+as\s+/i)[0].trim().split('.')[0]
        if (candidate && /^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) {
          modules.add(candidate)
        }
      }
      continue
    }

    const fromMatch = trimmed.match(/^from\s+([A-Za-z_][A-Za-z0-9_.]*)\s+import\s+/)
    if (fromMatch) {
      const candidate = fromMatch[1].split('.')[0]
      if (candidate) {
        modules.add(candidate)
      }
    }
  }

  return Array.from(modules)
}

function extractJsImports(code) {
  const modules = new Set()
  const text = String(code || '')
  const importRegex = /import\s+(?:[^'\"]+from\s+)?['\"]([^'\"]+)['\"]/g
  const requireRegex = /require\(\s*['\"]([^'\"]+)['\"]\s*\)/g

  for (const regex of [importRegex, requireRegex]) {
    let match
    while ((match = regex.exec(text)) !== null) {
      const raw = match[1]
      if (!raw || raw.startsWith('.') || raw.startsWith('/')) {
        continue
      }

      const packageName = raw.startsWith('@')
        ? raw.split('/').slice(0, 2).join('/')
        : raw.split('/')[0]

      if (packageName && !BUILTIN_JS_MODULES.has(packageName)) {
        modules.add(packageName)
      }
    }
  }

  return Array.from(modules)
}

async function preflightCheck(language, worker, filename, code) {
  if (language === 'python') {
    await dockerExec(['exec', worker.name, 'python3', '-m', 'py_compile', `/workspace/${filename}`])

    const imports = extractPythonImports(code)
    if (imports.length > 0) {
      const checkScript = [
        'import importlib, sys',
        'missing = []',
        'for mod in sys.argv[1:]:',
        '    try:',
        '        importlib.import_module(mod)',
        '    except Exception:',
        '        missing.append(mod)',
        'if missing:',
        '    print("MISSING_MODULES:" + ",".join(missing))',
        '    raise SystemExit(2)'
        ].join('\n')

      await dockerExec(['exec', worker.name, 'python3', '-c', checkScript, ...imports])
    }

    return
  }

  await dockerExec(['exec', worker.name, 'node', '--check', `/workspace/${filename}`])

  const jsImports = extractJsImports(code)
  if (jsImports.length > 0) {
    const checkScript = [
      'const mods = process.argv.slice(1)',
      'const missing = []',
      'for (const m of mods) {',
      '  try { require.resolve(m) } catch (_) { missing.push(m) }',
      '}',
      'if (missing.length) {',
      '  console.error("MISSING_MODULES:" + missing.join(","))',
      '  process.exit(2)',
      '}'
    ].join(';')

    await dockerExec(['exec', worker.name, 'node', '-e', checkScript, ...jsImports])
  }
}

async function persistOutputFiles(jobId, outputFiles) {
  if (!PERSIST_OUTPUTS || outputFiles.length === 0) {
    return null
  }

  const targetDir = path.join(PERSIST_OUTPUT_DIR, jobId)
  if (!fsSync.existsSync(targetDir)) {
    await fs.mkdir(targetDir, { recursive: true })
  }

  for (const file of outputFiles) {
    const destination = path.join(targetDir, file.name)
    await fs.writeFile(destination, Buffer.from(file.content, 'base64'))
  }

  return targetDir
}

function getExecutionPolicy() {
  return {
    timeoutMs: TIMEOUT_MS,
    allowedInputExtensions: ALLOWED_INPUT_EXTENSIONS,
    allowedOutputExtensions: ALLOWED_OUTPUT_EXTENSIONS,
    persistOutputs: PERSIST_OUTPUTS,
    persistOutputDir: PERSIST_OUTPUTS ? PERSIST_OUTPUT_DIR : null
  }
}

function sanitizeFilename(rawName) {
  if (typeof rawName !== 'string') {
    throw new Error('Invalid input file name')
  }

  const filename = path.basename(rawName.trim())
  if (!SAFE_FILENAME_RE.test(filename)) {
    throw new Error(`Invalid input file name: ${rawName}`)
  }

  return filename
}

function getTempPath(prefix) {
  return path.join(os.tmpdir(), `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`)
}

async function dockerExec(args) {
  return execFileAsync('docker', args, { maxBuffer: config.execution.maxDockerBufferBytes })
}

async function writeFileToContainer(worker, filename, content) {
  // content should be a Buffer or string
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf-8')
  const base64 = buffer.toString('base64')
  
  // Use docker exec to write the file by decoding base64 inside the container
  // This works with tmpfs mounts unlike docker cp
  await dockerExec([
    'exec',
    worker.name,
    'bash',
    '-c',
    `echo '${base64}' | base64 -d > /workspace/${filename}`
  ])
}

async function runCode(language, code, inputFiles = []) {
  const worker = getWorker()

  if (!worker) {
    return { error: 'All workers busy, try again shortly', status: 503 }
  }

  markBusy(worker)
  const jobId = uuidv4()

  try {
    await cleanWorkerWorkspace(worker)

    if (!Array.isArray(inputFiles)) {
      throw new Error('files must be an array')
    }

    // Write input files into the container
    for (const file of inputFiles) {
      if (!file || typeof file !== 'object') {
        throw new Error('Each input file must be an object with name and content')
      }

      const safeName = sanitizeFilename(file.name)
      if (!isAllowedInputExtension(safeName)) {
        throw new Error(`Input extension not allowed: ${getExtension(safeName) || '(none)'}`)
      }
      if (typeof file.content !== 'string') {
        throw new Error(`Invalid content for file: ${safeName}`)
      }

      const content = Buffer.from(file.content, 'base64')
      await writeFileToContainer(worker, safeName, content)
    }

    // Write the code file
    const filename = language === 'python' ? 'main.py' : 'main.js'
    await writeFileToContainer(worker, filename, code)

    await preflightCheck(language, worker, filename, code)

    // Run it
    const runner = language === 'python' ? 'python3' : 'node'

    const startTime = Date.now()

    const { stdout, stderr } = await Promise.race([
        dockerExec(['exec', worker.name, 'timeout', String(config.execution.timeoutSeconds), runner, `/workspace/${filename}`]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), TIMEOUT_MS)
      )
    ])

    const duration = Date.now() - startTime

    // Collect any output files the code produced
    const outputFiles = await collectOutputFiles(worker, jobId)
    const persistedPath = await persistOutputFiles(jobId, outputFiles)

    return {
      stdout,
      stderr,
      duration,
      outputFiles,
      persistedOutputPath: persistedPath,
      exitCode: 0,
      errorType: null,
      retryable: false
    }

  } catch (err) {
    if (err.message === 'TIMEOUT') {
      return {
        error: 'Execution timed out',
        stdout: '',
        stderr: '',
        exitCode: 124,
        errorType: 'timeout',
        retryable: true,
        outputFiles: []
      }
    }

    const classified = classifyExecutionError(err)
    return {
      error: classified.userMessage,
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code || 1,
      outputFiles: [],
      errorType: classified.errorType,
      retryable: classified.retryable
    }
  } finally {
    markFree(worker)
  }
}

async function collectOutputFiles(worker, jobId) {
  try {
    const { stdout } = await dockerExec([
      'exec',
      worker.name,
      'find',
      '/workspace',
      '-maxdepth',
      '1',
      '-type',
      'f',
      '-printf',
      '%f\\n'
    ])

    const files = stdout.trim().split('\n').filter(f =>
      f &&
      f !== 'main.py' &&
      f !== 'main.js' &&
      !f.endsWith('.pyc') &&
      isAllowedOutputExtension(f)
    )

    const result = []
    for (const filename of files) {
      try {
        const { stdout: fileContent } = await dockerExec([
          'exec',
          worker.name,
          'bash',
          '-c',
          `base64 -w 0 /workspace/${filename}`
        ])

        const content = Buffer.from(String(fileContent).trim(), 'base64')
        result.push({
          name: filename,
          content: content.toString('base64'),
          size: content.length
        })
      } catch {}
    }

    return result
  } catch {
    return []
  }
}

module.exports = { runCode, getExecutionPolicy }