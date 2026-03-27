# Execify — Build Guide
### Sandboxed code and command execution engine

---

## What you are building

A Node.js HTTP server that accepts two kinds of requests — run code (Python or JS) and run a named command (fetch a URL, create a file, zip files, etc.) — executes them safely inside Docker containers, and returns the output. It is completely self-contained. Anything can call it: your AI agent, a web app, a curl command.

By the end you will have this running on a server, accessible over HTTPS, with API key auth.

---

## Before you start — what you need to know

You do not need to know Docker deeply. You need to understand one idea: a Docker container is a process that thinks it is its own computer. It has its own filesystem, its own network (or none), and when it stops, everything inside it disappears. That is the entire security model here.

You need basic Node.js comfort — writing an Express server, async/await, reading and writing files.

That is it.

---

## Tools to install on your machine

- **Node.js** v18 or higher — your API server runs on this
- **Docker Desktop** — the isolation layer, install from docker.com
- **Git** — for version control

Verify everything works before continuing:

```
node --version
docker --version
git --version
```

---

## Project structure

Create this folder structure. You will fill each file in as you go through this guide.

```
execify/
├── src/
│   ├── server.js          — Express app, routes
│   ├── queue.js           — Job queue (in-memory to start)
│   ├── pool.js            — Container pool manager
│   ├── executor.js        — Runs code inside a container
│   ├── commands.js        — Command registry and handlers
│   ├── auth.js            — API key middleware
│   └── output.js          — Collect and encode output files
├── docker/
│   └── Dockerfile         — The sandbox container image
├── workspace/             — Temp job directories go here (auto-created)
├── .env                   — API keys and config
├── package.json
└── README.md
```

Run this to create it all at once:

```bash
mkdir execify && cd execify
mkdir -p src docker workspace
touch src/server.js src/queue.js src/pool.js src/executor.js
touch src/commands.js src/auth.js src/output.js
touch docker/Dockerfile .env
npm init -y
npm install express dotenv uuid
```

---

## Phase 1 — Build the Docker image

This is the container your code will actually run inside. You build it once and reuse it.

Open `docker/Dockerfile` and write this:

```dockerfile
FROM node:18-slim

RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    python3-venv \
    curl \
    zip \
    unzip \
    && rm -rf /var/lib/apt/lists/*

RUN pip3 install --break-system-packages \
    python-docx \
    pandas \
    openpyxl \
    requests \
    pillow

RUN useradd -m -u 1001 sandboxuser

RUN mkdir -p /workspace && chown sandboxuser:sandboxuser /workspace

USER sandboxuser

WORKDIR /workspace

CMD ["tail", "-f", "/dev/null"]
```

The last line keeps the container alive and doing nothing. Your server will reach into it to run jobs.

Build the image:

```bash
docker build -t execify-sandbox ./docker
```

This will take 2-3 minutes the first time. When it finishes, verify it exists:

```bash
docker images | grep execify-sandbox
```

---

## Phase 2 — The container pool

Instead of starting a new container for every job (slow, resource heavy), you start a fixed number upfront and reuse them.

Open `src/pool.js`:

```javascript
const { execSync, exec } = require('child_process')
const { promisify } = require('util')
const execAsync = promisify(exec)

const POOL_SIZE = 3
const pool = []

async function startContainer(id) {
  const name = `execify-worker-${id}`

  try {
    execSync(`docker rm -f ${name}`, { stdio: 'ignore' })
  } catch {}

  await execAsync(`
    docker run -d \
      --name ${name} \
      --network none \
      --memory 256m \
      --cpus 0.5 \
      --read-only \
      --tmpfs /workspace:size=100m,uid=1001 \
      --user 1001 \
      execify-sandbox
  `)

  return {
    id,
    name,
    busy: false
  }
}

async function initPool() {
  console.log(`Starting ${POOL_SIZE} sandbox containers...`)
  for (let i = 0; i < POOL_SIZE; i++) {
    const worker = await startContainer(i)
    pool.push(worker)
    console.log(`Worker ${i} ready`)
  }
  console.log('Pool ready')
}

function getWorker() {
  return pool.find(w => !w.busy) || null
}

function markBusy(worker) {
  worker.busy = true
}

function markFree(worker) {
  worker.busy = false
}

async function cleanWorkerWorkspace(worker) {
  try {
    await execAsync(`docker exec ${worker.name} sh -c "rm -rf /workspace/*"`)
  } catch {}
}

module.exports = { initPool, getWorker, markBusy, markFree, cleanWorkerWorkspace }
```

Key decisions here: `--network none` means zero internet access inside the container. `--read-only` means the filesystem cannot be written except the `/workspace` tmpfs we explicitly allow. `--memory 256m` means a runaway script cannot eat your server's RAM.

---

## Phase 3 — The executor

This is the core function. It takes code and a language, copies the code into the container, runs it, and returns what came out.

Open `src/executor.js`:

```javascript
const { exec } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises
const path = require('path')
const { v4: uuidv4 } = require('uuid')
const { getWorker, markBusy, markFree, cleanWorkerWorkspace } = require('./pool')

const execAsync = promisify(exec)

const TIMEOUT_MS = 30000

async function runCode(language, code, inputFiles = []) {
  const worker = getWorker()

  if (!worker) {
    return { error: 'All workers busy, try again shortly', status: 503 }
  }

  markBusy(worker)
  const jobId = uuidv4()

  try {
    await cleanWorkerWorkspace(worker)

    // Write input files into the container
    for (const file of inputFiles) {
      const content = Buffer.from(file.content, 'base64')
      const tmpPath = `/tmp/execify-upload-${jobId}-${file.name}`
      await fs.writeFile(tmpPath, content)
      await execAsync(`docker cp ${tmpPath} ${worker.name}:/workspace/${file.name}`)
      await fs.unlink(tmpPath)
    }

    // Write the code file
    const filename = language === 'python' ? 'main.py' : 'main.js'
    const tmpCodePath = `/tmp/execify-code-${jobId}`
    await fs.writeFile(tmpCodePath, code)
    await execAsync(`docker cp ${tmpCodePath} ${worker.name}:/workspace/${filename}`)
    await fs.unlink(tmpCodePath)

    // Run it
    const runner = language === 'python' ? 'python3' : 'node'
    const cmd = `docker exec ${worker.name} timeout 25 ${runner} /workspace/${filename}`

    const startTime = Date.now()

    const { stdout, stderr } = await Promise.race([
      execAsync(cmd, { maxBuffer: 5 * 1024 * 1024 }),
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
    const { stdout } = await execAsync(
      `docker exec ${worker.name} sh -c "ls /workspace/ 2>/dev/null"`
    )

    const files = stdout.trim().split('\n').filter(f =>
      f && f !== 'main.py' && f !== 'main.js' && !f.endsWith('.pyc')
    )

    const result = []
    for (const filename of files) {
      try {
        const tmpPath = `/tmp/execify-out-${jobId}-${filename}`
        await execAsync(`docker cp ${worker.name}:/workspace/${filename} ${tmpPath}`)
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
```

---

## Phase 4 — The command registry

Commands are named operations that do not require the caller to write any code. The AI agent calls `fetch_url` or `write_file` by name, with parameters. Your server handles what actually happens.

Open `src/commands.js`:

```javascript
const { exec } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises
const https = require('https')
const http = require('http')
const { getWorker, markBusy, markFree } = require('./pool')

const execAsync = promisify(exec)

// Only these URLs can be fetched via fetch_url
// Add to this list as needed
const URL_WHITELIST = [
  'https://api.github.com',
  'https://jsonplaceholder.typicode.com',
  // add your trusted domains here
]

function isWhitelisted(url) {
  return URL_WHITELIST.some(allowed => url.startsWith(allowed))
}

const COMMANDS = {

  fetch_url: async ({ url, method = 'GET', body = null, headers = {} }) => {
    if (!isWhitelisted(url)) {
      return { error: `URL not in whitelist: ${url}` }
    }

    return new Promise((resolve) => {
      const lib = url.startsWith('https') ? https : http
      const options = { method, headers: { 'User-Agent': 'Execify/1.0', ...headers } }

      const req = lib.request(url, options, (res) => {
        let data = ''
        res.on('data', chunk => data += chunk)
        res.on('end', () => resolve({
          status: res.statusCode,
          headers: res.headers,
          body: data
        }))
      })

      req.on('error', err => resolve({ error: err.message }))
      if (body) req.write(typeof body === 'string' ? body : JSON.stringify(body))
      req.end()
    })
  },

  write_file: async ({ filename, content, encoding = 'utf8' }, worker) => {
    if (!worker) return { error: 'No worker available' }
    const tmpPath = `/tmp/execify-write-${Date.now()}-${filename}`
    const data = encoding === 'base64'
      ? Buffer.from(content, 'base64')
      : Buffer.from(content, 'utf8')
    await fs.writeFile(tmpPath, data)
    await execAsync(`docker cp ${tmpPath} ${worker.name}:/workspace/${filename}`)
    await fs.unlink(tmpPath)
    return { success: true, filename }
  },

  read_file: async ({ filename }, worker) => {
    if (!worker) return { error: 'No worker available' }
    const tmpPath = `/tmp/execify-read-${Date.now()}-${filename}`
    await execAsync(`docker cp ${worker.name}:/workspace/${filename} ${tmpPath}`)
    const content = await fs.readFile(tmpPath)
    await fs.unlink(tmpPath)
    return {
      filename,
      content: content.toString('base64'),
      size: content.length
    }
  },

  list_dir: async ({}, worker) => {
    if (!worker) return { error: 'No worker available' }
    const { stdout } = await execAsync(
      `docker exec ${worker.name} sh -c "ls -la /workspace/ 2>/dev/null"`
    )
    return { listing: stdout.trim() }
  },

  delete_file: async ({ filename }, worker) => {
    if (!worker) return { error: 'No worker available' }
    await execAsync(`docker exec ${worker.name} sh -c "rm -f /workspace/${filename}"`)
    return { success: true, deleted: filename }
  },

  zip_files: async ({ filenames, output_name = 'output.zip' }, worker) => {
    if (!worker) return { error: 'No worker available' }
    const fileList = filenames.join(' ')
    await execAsync(
      `docker exec ${worker.name} sh -c "cd /workspace && zip ${output_name} ${fileList}"`
    )
    return { success: true, zip_file: output_name }
  },

  clear_workspace: async ({}, worker) => {
    if (!worker) return { error: 'No worker available' }
    await execAsync(`docker exec ${worker.name} sh -c "rm -rf /workspace/*"`)
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
```

---

## Phase 5 — Auth middleware

Simple API key check. Every request must include `X-API-Key` in the header.

Open `.env`:

```
API_KEYS=key-abc123,key-def456
PORT=3000
```

Open `src/auth.js`:

```javascript
require('dotenv').config()

const validKeys = (process.env.API_KEYS || '').split(',').map(k => k.trim())

function requireApiKey(req, res, next) {
  const key = req.headers['x-api-key']

  if (!key || !validKeys.includes(key)) {
    return res.status(401).json({ error: 'Invalid or missing API key' })
  }

  next()
}

module.exports = { requireApiKey }
```

---

## Phase 6 — The server

This is where everything connects. Open `src/server.js`:

```javascript
require('dotenv').config()
const express = require('express')
const { initPool } = require('./pool')
const { runCode } = require('./executor')
const { runCommand, COMMANDS } = require('./commands')
const { requireApiKey } = require('./auth')

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
  const { type, language, code, files, command, params, timeout } = req.body

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

const PORT = process.env.PORT || 3000

async function start() {
  await initPool()
  app.listen(PORT, () => {
    console.log(`Execify running on port ${PORT}`)
  })
}

start()
```

---

## Phase 7 — Test it locally

Start the server:

```bash
node src/server.js
```

You should see the pool starting and then "Execify running on port 3000".

Test the health endpoint:

```bash
curl http://localhost:3000/health
```

Test running Python code:

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -H "X-API-Key: key-abc123" \
  -d '{
    "type": "execute",
    "language": "python",
    "code": "print(\"hello from sandbox\")\nfor i in range(3):\n    print(i)"
  }'
```

Test a command:

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -H "X-API-Key: key-abc123" \
  -d '{
    "type": "command",
    "command": "list_dir",
    "params": {}
  }'
```

Test generating a file (Python writes a file, you get it back):

```bash
curl -X POST http://localhost:3000/run \
  -H "Content-Type: application/json" \
  -H "X-API-Key: key-abc123" \
  -d '{
    "type": "execute",
    "language": "python",
    "code": "f = open(\"hello.txt\", \"w\")\nf.write(\"this file was made inside the sandbox\")\nf.close()"
  }'
```

The response will include `outputFiles` with `hello.txt` base64 encoded.

---

## Phase 8 — Add the custom functions

These are fixed utility operations you build once on your server — not inside the sandbox, just regular Node.js endpoints. You mentioned converting docx to PDF as an example.

Install LibreOffice on your host server (not in Docker) for this:

```bash
sudo apt-get install libreoffice
```

Add a new endpoint in `server.js`:

```javascript
const { exec } = require('child_process')
const { promisify } = require('util')
const fs = require('fs').promises
const execAsync = promisify(exec)

app.post('/convert/docx-to-pdf', requireApiKey, async (req, res) => {
  const { file, filename } = req.body

  if (!file || !filename) {
    return res.status(400).json({ error: 'Missing file or filename' })
  }

  const inputPath = `/tmp/convert-input-${Date.now()}-${filename}`
  const outputDir = `/tmp/convert-output-${Date.now()}`

  try {
    await fs.mkdir(outputDir)
    await fs.writeFile(inputPath, Buffer.from(file, 'base64'))

    await execAsync(
      `libreoffice --headless --convert-to pdf --outdir ${outputDir} ${inputPath}`
    )

    const pdfName = filename.replace(/\.docx$/i, '.pdf')
    const pdfPath = `${outputDir}/${pdfName}`
    const pdfContent = await fs.readFile(pdfPath)

    res.json({
      filename: pdfName,
      content: pdfContent.toString('base64'),
      size: pdfContent.length
    })

  } catch (err) {
    res.status(500).json({ error: err.message })
  } finally {
    try {
      await fs.unlink(inputPath)
      await execAsync(`rm -rf ${outputDir}`)
    } catch {}
  }
})
```

This is the pattern for any fixed utility. PDF to text, merge PDFs, compress an image — each one is a small endpoint like this. You write it once, it never changes.

---

## Phase 9 — Deploy to a VPS

Render works but for a project involving Docker-in-Docker you will have a smoother experience with a basic VPS. DigitalOcean, Hetzner, or Vultr all work. A $6/month droplet (1GB RAM) is fine for learning.

**On your VPS:**

```bash
# Install Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Install Node
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install LibreOffice for doc conversion
sudo apt-get install -y libreoffice

# Clone your project
git clone https://github.com/yourusername/execify.git
cd execify

# Install dependencies
npm install

# Build the sandbox image
docker build -t execify-sandbox ./docker

# Set up environment
cp .env.example .env
nano .env   # add your real API keys

# Start it
node src/server.js
```

To keep it running after you disconnect, use PM2:

```bash
npm install -g pm2
pm2 start src/server.js --name execify
pm2 startup    # makes it survive reboots
pm2 save
```

**Set up HTTPS with nginx:**

```bash
sudo apt-get install -y nginx certbot python3-certbot-nginx

# Point your domain to the VPS IP first, then:
sudo certbot --nginx -d yourdomain.com
```

Create `/etc/nginx/sites-available/execify`:

```nginx
server {
    listen 80;
    server_name yourdomain.com;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        client_max_body_size 20M;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/execify /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl restart nginx
```

Certbot will handle the HTTPS certificate automatically.

---

## What you have when you are done

A server running at `https://yourdomain.com` that accepts POST requests to `/run` with an API key. It can run Python or Node code in isolation, handle any of the named commands, convert docx to PDF, and return output files. Anything — your AI agent, a web app, a curl command from your laptop — can use it.

To add a new command you add one entry to the `COMMANDS` object in `commands.js` and one handler function. To add a new custom utility you add one endpoint. Nothing else changes.

---

## What to write on your resume

**Execify — Sandboxed Code Execution Engine**

Built a language-agnostic code execution service that runs untrusted Python and Node.js code in isolated Docker containers with no network access, memory limits, and automatic workspace cleanup. Designed a command registry pattern allowing named operations (file I/O, URL fetching, archiving) to be added without modifying the execution core. Used container pooling to serve concurrent users without per-request container startup overhead. Deployed on a Linux VPS behind nginx with HTTPS and API key authentication.

**Technologies:** Node.js, Express, Docker, Linux namespaces, nginx, PM2

**Impact framing for interviews:** "This is the execution layer that makes an AI agent able to produce real files — not just text. The agent sends code, the sandbox runs it safely, and a real .docx or .pdf comes back."