require('dotenv').config()
const express = require('express')
const { execFile } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises
const os = require('os')
const path = require('path')
const { initPool } = require('./pool')
const { runCode } = require('./executor')
const { runCommand, COMMANDS } = require('./commands')
const { requireApiKey } = require('./auth')

const execFileAsync = promisify(execFile)
const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

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
app.use(express.json({ limit: '10mb' }))

// Health check — no auth needed
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() })
})

// List available languages and commands — no auth needed
app.get('/capabilities', (req, res) => {
  res.json({
    languages: ['python', 'node'],
    commands: Object.keys(COMMANDS),
    limits: {
      timeout_seconds: 25,
      max_memory_mb: 256,
      max_file_size_mb: 10
    }
  })
})

// Main execution endpoint — auth required
app.post('/run', requireApiKey, async (req, res) => {
  const { type, language, code, files, command, params } = req.body

  if (!type) {
    return res.status(400).json({ error: 'Missing field: type (execute or command)' })
  }

  if (type === 'execute') {
    if (!language || !['python', 'node'].includes(language)) {
      return res.status(400).json({ error: 'language must be python or node' })
    }
    if (!code || typeof code !== 'string') {
      return res.status(400).json({ error: 'Missing field: code' })
    }
    if (code.length > 100000) {
      return res.status(400).json({ error: 'Code too large (max 100kb)' })
    }

    const result = await runCode(language, code, files || [])

    if (result.status === 503) {
      return res.status(503).json({ error: result.error })
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

const PORT = process.env.PORT || 3000

async function start() {
  await initPool()
  app.listen(PORT, () => {
    console.log(`Execify running on port ${PORT}`)
  })
}

start()