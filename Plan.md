# Execify — Build and Operating Plan
### Sandboxed code + command execution engine with centralized config

---

## 1. Objective

Build a Node.js HTTP service that can:

- run user-generated code (`python` or `node`) in isolated Docker workers
- run named commands (`fetch_url`, `write_file`, `zip_files`, etc.)
- return logs and generated files
- classify failures so an AI agent knows whether to retry
- keep a worker alive across multiple steps when a session workspace is requested
- stream output during long jobs
- track usage per API key for operational visibility

The service is API-key protected and designed for agent usage.

---

## 2. Current Architecture

Project structure now:

```text
Execify/
├── src/
│   ├── config.js          # central constants and env-based policy
│   ├── server.js          # API routes and orchestration
│   ├── pool.js            # docker worker pool manager
│   ├── executor.js        # code execution + preflight + output handling
│   ├── commands.js        # named command handlers
│   ├── auth.js            # API key middleware
│   ├── sessionManager.js  # session workspace lifecycle
│   ├── usageTracker.js    # in-memory usage log per API key
│   ├── queue.js           # in-memory queue utility
│   └── output.js          # output helper utilities
├── docker/
│   └── Dockerfile         # sandbox image
├── workspace/
├── .env
├── README.md
└── Plan.md
```

---

## 3. Single Source of Configuration

All important constants and tunables are centralized in `src/config.js`.

### Config sections

- `app`: port, request body size
- `execution`: language allowlist, code size limit, timeout, extension policy, output persistence
- `workerPool`: pool size and container runtime limits
- `commands`: URL whitelist, fetch timeout, allowed HTTP methods
- `retryRules`: retry behavior per error type
- `limits`: values shown in capabilities endpoint
- `SAFE_FILENAME_RE`: shared filename policy
- `session`: default and maximum session TTL values
- `usage`: in-memory log retention limit

This means you can adjust behavior from one file instead of hunting across modules.

---

## 4. Security and Isolation Model

### Worker container controls

Workers are launched with:

- no network (`--network none`)
- memory and CPU caps
- read-only root filesystem
- writable tmpfs only at `/workspace`
- non-root user

### Shell safety

- Docker calls use argument-safe process execution (`execFile`) for user-influenced values.
- Filenames are sanitized and restricted via `SAFE_FILENAME_RE`.
- Path traversal is blocked by `path.basename` normalization.

---

## 5. Execution Flow (run code)

When `POST /run` with `type: execute` arrives:

1. Validate request shape and language.
2. Acquire a free worker from the pool.
3. Clean worker workspace.
4. Validate file inputs and allowed input extensions.
5. Copy input files and generated code file into worker.
6. Preflight checks before actual execution:
   - Python syntax: `python3 -m py_compile`
   - Node syntax: `node --check`
   - Python dependency probe: parse imports, `importlib.import_module`
   - Node dependency probe: parse imports/requires, `require.resolve`
7. Execute code with timeout.
8. Collect output files filtered by allowed output extensions.
9. Optionally persist output files on host disk.
10. Return structured result with `errorType` and `retryable`.

---

## 6. Error Classification Contract (Agent-Friendly)

The executor returns deterministic failure types:

- `input_validation`: bad request/file shape or disallowed extension
- `syntax_error`: code parse/compile error
- `missing_dependency`: requested package/module not available in sandbox image
- `runtime_error`: code executed but failed at runtime
- `timeout`: execution exceeded limit

Retry guidance:

- `input_validation`, `syntax_error`, `missing_dependency` -> do not retry unchanged code
- `runtime_error` -> retry optional (depends on agent strategy)
- `timeout` -> retry allowed

HTTP behavior:

- Non-retryable code/setup errors (`syntax_error`, `missing_dependency`, `input_validation`) return `422`.

---

## 7. File Extension Control

Extension allowlists are enforced from config/env:

- `ALLOWED_INPUT_EXTENSIONS`
- `ALLOWED_OUTPUT_EXTENSIONS`

If an input file extension is not allowed, execution fails before run.
If an output file extension is not allowed, file is ignored and not returned.

---

## 8. Output Storage Behavior

Default behavior:

- outputs are returned in API response as base64 in `outputFiles`
- temporary host copies are deleted
- nothing is persisted permanently

Optional persistence:

- set `PERSIST_OUTPUTS=true`
- set `PERSIST_OUTPUT_DIR`
- outputs are saved under `PERSIST_OUTPUT_DIR/<jobId>/...`

---

## 9. Dependency Strategy (Important)

This platform is intentionally offline inside worker containers.

That means:

- no dynamic `pip install` / `npm install` during execution jobs
- dependencies must be preinstalled in the sandbox image (`docker/Dockerfile`)
- if code asks for a package that is not present, return `missing_dependency` and let agent regenerate code

This is the same practical pattern used by robust code-execution agents.

---

## 10. Command Registry Behavior

Named commands are implemented in `src/commands.js`.

Highlights:

- `fetch_url` uses URL origin whitelist + method allowlist + timeout
- file commands (`write_file`, `read_file`, `delete_file`, `zip_files`) sanitize names
- command file operations enforce extension policy allowlists (unsafe extensions rejected)
- workspace maintenance (`list_dir`, `clear_workspace`) runs against worker `/workspace`

Session-aware workflows reuse the same worker so files persist across multiple `/run` calls until the session is deleted or expires.

---

## 11. API Endpoints

- `GET /health`: liveness
- `GET /capabilities`: supported languages, commands, limits, extension policy, retry rules
- `POST /session/create`: reserve a worker and create a persistent workspace
- `DELETE /session/:session_id`: free a reserved worker and clear its workspace
- `GET /installed-modules`: returns Python and Node module inventory from live worker (API key required)
- `POST /run`: execute code or run command (API key required)
- `GET /run/stream` and `POST /run/stream`: stream stdout/stderr as Server-Sent Events (API key required)
- `GET /usage`: per-key usage summary (API key required)
- `POST /convert/docx-to-pdf`: container-based LibreOffice conversion endpoint (API key required)

### Conversion availability contract

- `GET /capabilities` exposes `host_utilities.docx_to_pdf_available` and `host_utilities.docx_to_pdf_binary`.
- LibreOffice is installed in the sandbox image, so conversion happens inside the container.
- If converter dependency is missing, `POST /convert/docx-to-pdf` returns `503` with explicit error.

### Session and stream contract

- `POST /session/create` returns a `session_id`, `expires_in`, `expires_at`, and reserved worker name.
- Include `session_id` on later `/run` or `/run/stream` calls to preserve `/workspace` across steps.
- `GET /run/stream` emits stdout and stderr lines as they arrive and ends with a `done` event.
- `GET /usage` returns recent per-key request activity, duration totals, and run metadata.

---

## 12. Environment Variables (Operational)

Required:

- `API_KEYS`
- `PORT`

Execution policy:

- `ALLOWED_INPUT_EXTENSIONS`
- `ALLOWED_OUTPUT_EXTENSIONS`
- `PERSIST_OUTPUTS`
- `PERSIST_OUTPUT_DIR`
- `EXECUTION_TIMEOUT_SECONDS`
- `EXECUTION_TIMEOUT_MS`
- `MODULE_PROBE_TIMEOUT_MS`
- `MODULE_LIST_MAX_ITEMS`
- `CODE_MAX_CHARS`
- `MAX_DOCKER_BUFFER_BYTES`

Worker policy:

- `POOL_SIZE`
- `WORKER_MEMORY_MB`
- `WORKER_CPUS`
- `WORKER_TMPFS_MB`
- `WORKSPACE_UID`
- `WORKER_NETWORK_MODE`
- `SANDBOX_IMAGE`

Command policy:

- `FETCH_TIMEOUT_MS`
- `ALLOWED_HTTP_METHODS`
- `URL_WHITELIST`

---

## 13. Deployment Notes

- Build sandbox image once per dependency change.
- Restart API service after `.env` or code/config updates.
- Use process manager (`pm2`) and reverse proxy (`nginx`) for production.
- Use HTTPS certificates (certbot/nginx) for public access.

---

## 14. Maintenance Workflow

For policy updates:

1. Update `src/config.js` defaults and/or `.env` values.
2. Rebuild sandbox image only if runtime dependencies changed.
3. Restart server.
4. Check `GET /capabilities` to confirm effective policy.

For agent compatibility checks:

1. Call `GET /installed-modules` before generating code.
2. Restrict generated imports to returned modules.
3. If execution still returns `missing_dependency`, regenerate with available packages only.

For new command:

1. Add handler in `src/commands.js`.
2. Keep filename/path safety rules.
3. Return structured JSON result.

For new host utility endpoint:

1. Add endpoint in `src/server.js`.
2. Validate input strictly.
3. Use temp directory + cleanup.

---

## 15. Validation Matrix (Current)

Validated with automated tests in `tests/`:

- Unit: core Python/Node execution behavior.
- Integration (file I/O): output file generation, read paths, zip paths.
- Integration (commands): `fetch_url`, `write_file`, `read_file`, `list_dir`, `delete_file`, `zip_files`, `clear_workspace`.
- Security: timeout kill, readonly enforcement, network isolation, privilege escalation blocking, memory limits.
- Algorithms (standard): LeetCode-style array/string/sort/search/math coverage.
- Algorithms (complex/stress): dynamic programming, graph shortest path, CPU-heavy finite workload, plus timeout/memory boundary checks.
- Documents: txt/json/csv/md/docx/zip generation workflow.

Known environment dependency:

- DOCX -> PDF requires host LibreOffice/soffice binary. Endpoint is safe-fail with explicit `503` until dependency is installed.
