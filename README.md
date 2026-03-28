# Execify

Sandboxed code and command execution engine for running Python/Node code and predefined utility commands inside isolated Docker workers.

Execify exposes a simple HTTP API so any client (AI agent, frontend app, CLI, automation script) can execute code safely, fetch outputs, and run approved commands.

## What This Project Does

Execify provides two execution modes through one endpoint:

- `execute`: run arbitrary `python` or `node` code in an isolated container.
- `command`: run named operations like `fetch_url`, `write_file`, `read_file`, `zip_files`, and more.

Each job executes in a pooled sandbox worker with strict limits:

- no internet by default in workers (`--network none`)
- memory and CPU caps
- read-only container filesystem except `/workspace`
- timeout-protected execution

## Architecture (High Level)

- `src/server.js`: Express API, routing, validation, startup
- `src/pool.js`: pre-warmed Docker worker pool
- `src/executor.js`: language execution flow (`python`/`node`)
- `src/commands.js`: command registry and handlers
- `src/auth.js`: API key middleware (`X-API-Key`)
- `src/output.js`: output encoding/collection utilities (reserved)
- `docker/Dockerfile`: sandbox runtime image
- `workspace/`: temporary local job artifacts (if used)

## Prerequisites

- Node.js 18+
- Docker Desktop / Docker Engine
- Git

Optional (for host utility endpoint `docx -> pdf`):

- LibreOffice

Verify tools:

```bash
node --version
docker --version
git --version
```

## Install

```bash
npm install
```

## Build Sandbox Image

Build the container image used by worker pool:

```bash
docker build -t execify-sandbox ./docker
```

Check it exists:

```bash
docker images | grep execify-sandbox
```

## Environment Configuration

Create `.env` in project root:

```env
API_KEYS=key-abc123,key-def456
PORT=3000
ALLOWED_INPUT_EXTENSIONS=.txt,.json,.csv,.md,.pdf,.docx,.xlsx,.png,.jpg,.jpeg
ALLOWED_OUTPUT_EXTENSIONS=.txt,.json,.csv,.md,.pdf,.docx,.xlsx,.png,.jpg,.jpeg,.zip
PERSIST_OUTPUTS=false
PERSIST_OUTPUT_DIR=workspace/jobs
MODULE_PROBE_TIMEOUT_MS=15000
MODULE_LIST_MAX_ITEMS=2000
```

`API_KEYS` is a comma-separated list of allowed request keys.

### Execution Policy Controls

- `ALLOWED_INPUT_EXTENSIONS`: input files accepted in `files[]` for execute requests
- `ALLOWED_OUTPUT_EXTENSIONS`: only these generated files are returned in `outputFiles`
- `PERSIST_OUTPUTS=true`: also save generated output files on host disk
- `PERSIST_OUTPUT_DIR`: host directory used when persistence is enabled

If an extension is not allowed, execution is rejected before run.

## Run Locally

Start server:

```bash
node src/server.js
```

Expected startup behavior:

1. Worker pool starts (`POOL_SIZE` from `src/pool.js`)
2. Each sandbox container becomes ready
3. API server listens on `PORT` (default `3000`)

## API Reference

### 1) Health Check (No Auth)

```http
GET /health
```

Example:

```bash
curl http://localhost:3000/health
```

### 2) Capabilities (No Auth)

```http
GET /capabilities
```

Returns supported languages, command names, and runtime limits.

### 3) Main Execution Endpoint (Auth Required)

```http
POST /run
X-API-Key: <your-key>
Content-Type: application/json
```

Request body depends on `type`:

- `type: "execute"` for code execution
- `type: "command"` for named command execution

For execute requests, responses include deterministic error metadata:

- `errorType: syntax_error` -> do not retry (code must be fixed)
- `errorType: missing_dependency` -> do not retry (library unavailable)
- `errorType: input_validation` -> do not retry (invalid file/request shape)
- `errorType: runtime_error` -> retry optional
- `errorType: timeout` -> retry allowed

`retryable` is returned as a boolean for agent logic.

### 4) Installed Modules Endpoint (Auth Required)

```http
GET /installed-modules
X-API-Key: <your-key>
```

Returns module inventory from a live worker:

- Python: available top-level modules from the worker runtime
- Node: builtin modules + global npm packages

Use this endpoint before code generation so your AI agent can avoid unsupported libraries.

## Usage Examples

### Execute Python

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

### Execute Node.js

```bash
curl -X POST http://localhost:3000/run \
	-H "Content-Type: application/json" \
	-H "X-API-Key: key-abc123" \
	-d '{
		"type": "execute",
		"language": "node",
		"code": "console.log(\"hello from node sandbox\")"
	}'
```

### Run Command: list_dir

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

### Generate Output Files

If executed code creates files in `/workspace`, response includes `outputFiles` as Base64:

```bash
curl -X POST http://localhost:3000/run \
	-H "Content-Type: application/json" \
	-H "X-API-Key: key-abc123" \
	-d '{
		"type": "execute",
		"language": "python",
		"code": "with open(\"hello.txt\", \"w\") as f:\n    f.write(\"created inside sandbox\")"
	}'
```

By default output files are not persisted on host disk; they are copied from container to response and temporary files are deleted. If `PERSIST_OUTPUTS=true`, files are also saved under `PERSIST_OUTPUT_DIR/<jobId>`.

## Supported Commands

Defined in `src/commands.js`:

- `fetch_url` (whitelist-based)
- `write_file`
- `read_file`
- `list_dir`
- `delete_file`
- `zip_files`
- `clear_workspace`

## Authentication

Every protected endpoint requires:

```http
X-API-Key: <key>
```

If missing or invalid, API returns `401`.

## Security Model

Worker containers are launched with important restrictions:

- `--network none`: block outbound network from user code
- `--memory 256m` and `--cpus 0.5`: limit resource abuse
- `--read-only`: immutable container filesystem
- `--tmpfs /workspace`: bounded writable scratch space
- execution timeout to prevent infinite loops

This design reduces host risk while keeping execution fast via container reuse.

## Optional Utility Endpoint: DOCX to PDF

You can add a host-side endpoint (outside sandbox) for file conversion:

```http
POST /convert/docx-to-pdf
```

Requires LibreOffice installed on host machine.

Ubuntu/Debian install:

```bash
sudo apt-get install -y libreoffice
```

## Deploying to a VPS

Recommended for Docker-based execution (e.g., DigitalOcean, Hetzner, Vultr).

Typical server setup:

```bash
# Docker
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker $USER

# Node.js 18
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Optional conversions
sudo apt-get install -y libreoffice

# App setup
git clone https://github.com/DharambirAgrawal/Execify.git
cd Execify
npm install
docker build -t execify-sandbox ./docker
```

Run with PM2:

```bash
npm install -g pm2
pm2 start src/server.js --name execify
pm2 startup
pm2 save
```

Use Nginx + Certbot for HTTPS termination and reverse proxy.

## Common Errors

- `All workers busy`: increase pool size or retry later
- `Execution timed out`: optimize code or raise timeout safely
- `Invalid or missing API key`: verify `X-API-Key` and `.env`
- Docker command failures: ensure Docker daemon is running and image is built

## Roadmap Ideas

- persistent queue (Redis/BullMQ)
- per-key rate limits and quotas
- richer observability/metrics
- stronger path validation and command hardening
- horizontal scaling with multiple worker hosts

## License

ISC
