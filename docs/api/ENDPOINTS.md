# Execify API Reference

## Overview

Execify is a sandboxed code execution service with support for Python and Node.js. It provides endpoints for:
- Arbitrary code execution
- Named command execution
- Module inventory
- Document conversion (DOCX → PDF)
- Health checks and capabilities

## Authentication

All endpoints (except `/health`) require API key authentication via `X-API-Key` header:

```bash
curl -H "X-API-Key: your-api-key" http://localhost:3000/capabilities
```

## Endpoints

### 1. Health Check
**GET** `/health` (No auth required)

Returns server status and timestamp.

```bash
curl http://localhost:3000/health
```

Response:
```json
{
  "status": "ok",
  "timestamp": "2026-04-05T21:50:08.091Z"
}
```

---

### 2. Capabilities

**GET** `/capabilities` (Auth required)

Returns supported languages, commands, limits, policies, and retry rules.

```bash
curl -H "X-API-Key: test-key-123" http://localhost:3000/capabilities
```

Response:
```json
{
  "languages": ["python", "node"],
  "commands": [
    "fetch_url", "write_file", "read_file", "list_dir",
    "delete_file", "zip_files", "clear_workspace"
  ],
  "endpoints": {
    "run": "/run",
    "module_inventory": "/installed-modules",
    "convert_docx_to_pdf": "/convert/docx-to-pdf"
  },
  "limits": {
    "timeout_seconds": 25,
    "max_memory_mb": 512,
    "max_file_size_mb": 10
  },
  "policy": {
    "allowed_input_extensions": [".txt", ".json", ".csv", ".md", ".py", ".js", ".pdf", ".docx"],
    "allowed_output_extensions": [".txt", ".json", ".csv", ".md", ".py", ".js", ".log", ".zip", ".pdf"],
    "persist_outputs": true,
    "persisted_output_dir": "workspace/jobs"
  },
  "retry_rules": {
    "syntax_error": "do_not_retry",
    "missing_dependency": "do_not_retry",
    "input_validation": "do_not_retry",
    "runtime_error": "retry_optional",
    "timeout": "retry_allowed"
  }
}
```

---

### 3. Execute Code

**POST** `/run` (Auth required)

Execute Python or Node.js code with optional input files.

#### Request Body

```json
{
  "type": "execute",
  "language": "python",
  "code": "print('Hello World')",
  "files": [
    {
      "name": "input.txt",
      "content": "base64-encoded-file-content"
    }
  ]
}
```

#### Parameters

- **type** (string, required): `"execute"` or `"command"`
- **language** (string, required): `"python"` or `"node"`
- **code** (string, required): Source code to execute (max 100KB)
- **files** (array, optional): Input files (base64 encoded)
  - **name** (string): Filename (sanitized)
  - **content** (string): File content (base64 encoded)

#### Response

```json
{
  "stdout": "Hello World\n",
  "stderr": "",
  "duration": 142,
  "exitCode": 0,
  "outputFiles": [
    {
      "name": "output.txt",
      "content": "base64-encoded-content"
    }
  ],
  "persistedOutputPath": "workspace/jobs/job-id-123/output.txt",
  "errorType": null,
  "retryable": false
}
```

#### Error Responses

**Syntax Error (422)**
```json
{
  "error": "Syntax error in code",
  "stdout": "",
  "stderr": "SyntaxError: invalid syntax",
  "errorType": "syntax_error",
  "retryable": false
}
```

**Missing Dependency (422)**
```json
{
  "error": "Missing required module",
  "errorType": "missing_dependency",
  "retryable": false
}
```

**Timeout (200 with error classification)**
```json
{
  "error": "Execution timeout",
  "errorType": "timeout",
  "retryable": true
}
```

---

### 4. Run Named Command

**POST** `/run` (Auth required)

Execute predefined commands without writing code.

#### Request Body

```json
{
  "type": "command",
  "command": "fetch_url",
  "params": {
    "url": "https://jsonplaceholder.typicode.com/posts/1"
  }
}
```

#### Available Commands

##### `fetch_url`
Fetch content from whitelisted URLs.

```json
{
  "type": "command",
  "command": "fetch_url",
  "params": {
    "url": "https://jsonplaceholder.typicode.com/posts/1",
    "method": "GET",
    "headers": {"Accept": "application/json"}
  }
}
```

Response:
```json
{
  "status": 200,
  "headers": {"content-type": "application/json"},
  "body": "{\"id\": 1, \"title\": \"...\"}"
}
```

##### `write_file`
Write content to workspace.

```json
{
  "type": "command",
  "command": "write_file",
  "params": {
    "filename": "output.txt",
    "content": "base64-encoded-content",
    "encoding": "base64"
  }
}
```

##### `read_file`
Read file from workspace.

```json
{
  "type": "command",
  "command": "read_file",
  "params": {
    "filename": "input.txt"
  }
}
```

Response:
```json
{
  "filename": "input.txt",
  "content": "base64-encoded-content",
  "size": 1024
}
```

##### `list_dir`
List files in workspace.

```json
{
  "type": "command",
  "command": "list_dir"
}
```

Response:
```json
{
  "listing": "total 24\ndrwxr-xr-x  5 user  group  160 Apr  5 21:50 .\n..."
}
```

##### `delete_file`
Delete file from workspace.

```json
{
  "type": "command",
  "command": "delete_file",
  "params": {
    "filename": "temp.txt"
  }
}
```

##### `zip_files`
Create ZIP archive.

```json
{
  "type": "command",
  "command": "zip_files",
  "params": {
    "filenames": ["file1.txt", "file2.json"],
    "output_name": "archive.zip"
  }
}
```

##### `clear_workspace`
Remove all files from workspace.

```json
{
  "type": "command",
  "command": "clear_workspace"
}
```

---

### 5. Installed Modules

**GET** `/installed-modules` (Auth required)

Get inventory of installed Python and Node modules.

```bash
curl -H "X-API-Key: test-key-123" http://localhost:3000/installed-modules
```

Response:
```json
{
  "worker": "execify-worker-0",
  "timestamp": "2026-04-05T21:50:08.091Z",
  "python": {
    "modules": ["abc", "asyncio", "base64", "csv", "json", "os", "sys", "time", "pandas", "requests", "pillow", ...],
    "total": 142,
    "truncated": false
  },
  "node": {
    "builtin_modules": ["assert", "buffer", "crypto", "fs", "http", "https", "path", "process", ...],
    "builtin_total": 31,
    "global_packages": [],
    "global_total": 0,
    "truncated": false
  }
}
```

---

### 6. DOCX to PDF Conversion

**POST** `/convert/docx-to-pdf` (Auth required)

Convert DOCX document to PDF using LibreOffice.

#### Request Body

```json
{
  "file": "base64-encoded-docx-content",
  "filename": "document.docx"
}
```

#### Response

```json
{
  "filename": "document.pdf",
  "content": "base64-encoded-pdf-content",
  "size": 45678
}
```

---

## HTTP Status Codes

| Code | Meaning |
|------|---------|
| 200 | Success |
| 400 | Bad request (validation error) |
| 401 | Unauthorized (invalid/missing API key) |
| 422 | Unprocessable (code syntax/dependency error) |
| 503 | Service unavailable (no workers) |
| 504 | Timeout on module probe |

---

## Error Classification

Execify returns consistent error types to help clients decide on retry strategy:

| Error Type | HTTP | Retryable | Reason |
|-----------|------|-----------|---------|
| `input_validation` | 422 | ❌ No | Fix request format |
| `syntax_error` | 422 | ❌ No | Fix code syntax |
| `missing_dependency` | 422 | ❌ No | Use available packages |
| `runtime_error` | 200 | ⚠️ Optional | May succeed if data changes |
| `timeout` | 200 | ✓ Yes | Safe to retry (timeout rule may adjust) |

---

## Rate Limits

Via reverse proxy (e.g., nginx):
- Recommended: 10 req/s per IP
- Burst: 20 requests allowed

Configure in nginx:
```nginx
limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
limit_req zone=api burst=20 nodelay;
```

---

## Examples

See `docs/examples/` for complete code samples in:
- Python (requests, agents)
- JavaScript/Node.js (axios, async)
- cURL commands
- LeetCode-style problems
- Document generation workflows

---

## Support

- Check server health: `GET /health`
- Get capabilities: `GET /capabilities`
- View error classification in response: `errorType` field
- Enable output persistence: `PERSIST_OUTPUTS=true` in `.env`
