// This is the core function and It takes code and a language, copies the code into the container, runs it, and returns what came out.

const { execFile } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const { getWorker, markBusy, markFree, cleanWorkerWorkspace } = require('./pool')

const execFileAsync = promisify(execFile)

const TIMEOUT_MS = 30000
const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

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
  return execFileAsync('docker', args, { maxBuffer: 10 * 1024 * 1024 })
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
      if (typeof file.content !== 'string') {
        throw new Error(`Invalid content for file: ${safeName}`)
      }

      const content = Buffer.from(file.content, 'base64')
      const tmpPath = getTempPath(`execify-upload-${jobId}`)
      await fs.writeFile(tmpPath, content)
      await dockerExec(['cp', tmpPath, `${worker.name}:/workspace/${safeName}`])
      await fs.unlink(tmpPath)
    }

    // Write the code file
    const filename = language === 'python' ? 'main.py' : 'main.js'
    const tmpCodePath = getTempPath(`execify-code-${jobId}`)
    await fs.writeFile(tmpCodePath, code)
    await dockerExec(['cp', tmpCodePath, `${worker.name}:/workspace/${filename}`])
    await fs.unlink(tmpCodePath)

    // Run it
    const runner = language === 'python' ? 'python3' : 'node'

    const startTime = Date.now()

    const { stdout, stderr } = await Promise.race([
      dockerExec(['exec', worker.name, 'timeout', '25', runner, `/workspace/${filename}`]),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), TIMEOUT_MS)
      )
    ])

    const duration = Date.now() - startTime

    // Collect any output files the code produced
    const outputFiles = await collectOutputFiles(worker, jobId)

    return { stdout, stderr, duration, outputFiles, exitCode: 0 }

  } catch (err) {
    if (err.message === 'TIMEOUT') {
      return { error: 'Execution timed out', stdout: '', stderr: '', exitCode: 124 }
    }
    return {
      stdout: err.stdout || '',
      stderr: err.stderr || err.message,
      exitCode: err.code || 1,
      outputFiles: []
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
      f && f !== 'main.py' && f !== 'main.js' && !f.endsWith('.pyc')
    )

    const result = []
    for (const filename of files) {
      try {
        const tmpPath = getTempPath(`execify-out-${jobId}`)
        await dockerExec(['cp', `${worker.name}:/workspace/${filename}`, tmpPath])
        const content = await fs.readFile(tmpPath)
        result.push({
          name: filename,
          content: content.toString('base64'),
          size: content.length
        })
        await fs.unlink(tmpPath)
      } catch {}
    }

    return result
  } catch {
    return []
  }
}

module.exports = { runCode }