const path = require('path')
require('dotenv').config()

function parseList(rawValue, fallback = []) {
  if (!rawValue || typeof rawValue !== 'string') {
    return fallback
  }

  const parts = rawValue
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)

  return parts.length > 0 ? parts : fallback
}

function parseExtensions(rawValue, fallback = []) {
  return parseList(rawValue, fallback)
    .map(v => v.toLowerCase())
    .map(v => (v.startsWith('.') ? v : `.${v}`))
}

const SAFE_FILENAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

const DEFAULT_ALLOWED_INPUT_EXTENSIONS = ['.txt', '.json', '.csv', '.md', '.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg']
const DEFAULT_ALLOWED_OUTPUT_EXTENSIONS = ['.txt', '.json', '.csv', '.md', '.pdf', '.docx', '.xlsx', '.png', '.jpg', '.jpeg', '.zip']
const DEFAULT_URL_WHITELIST = ['https://api.github.com', 'https://jsonplaceholder.typicode.com']

const config = {
  app: {
    port: Number(process.env.PORT || 3000),
    requestBodyLimit: process.env.REQUEST_BODY_LIMIT || '10mb'
  },
  execution: {
    languages: ['python', 'node'],
    codeMaxChars: Number(process.env.CODE_MAX_CHARS || 100000),
    timeoutSeconds: Number(process.env.EXECUTION_TIMEOUT_SECONDS || 25),
    timeoutMs: Number(process.env.EXECUTION_TIMEOUT_MS || 30000),
    moduleProbeTimeoutMs: Number(process.env.MODULE_PROBE_TIMEOUT_MS || 15000),
    moduleListMaxItems: Number(process.env.MODULE_LIST_MAX_ITEMS || 2000),
    maxDockerBufferBytes: Number(process.env.MAX_DOCKER_BUFFER_BYTES || 10 * 1024 * 1024),
    allowedInputExtensions: parseExtensions(process.env.ALLOWED_INPUT_EXTENSIONS, DEFAULT_ALLOWED_INPUT_EXTENSIONS),
    allowedOutputExtensions: parseExtensions(process.env.ALLOWED_OUTPUT_EXTENSIONS, DEFAULT_ALLOWED_OUTPUT_EXTENSIONS),
    persistOutputs: String(process.env.PERSIST_OUTPUTS || 'false').toLowerCase() === 'true',
    persistOutputDir: process.env.PERSIST_OUTPUT_DIR || path.join(process.cwd(), 'workspace', 'jobs')
  },
  session: {
    defaultTtlSeconds: Number(process.env.SESSION_TTL_SECONDS || 3600),
    maxTtlSeconds: Number(process.env.SESSION_MAX_TTL_SECONDS || 86400)
  },
  usage: {
    maxRecentEventsPerKey: Number(process.env.USAGE_LOG_MAX_EVENTS || 200)
  },
  workerPool: {
    size: Number(process.env.POOL_SIZE || 3),
    memoryMb: Number(process.env.WORKER_MEMORY_MB || 256),
    cpus: Number(process.env.WORKER_CPUS || 0.5),
    tmpfsSizeMb: Number(process.env.WORKER_TMPFS_MB || 100),
    workspaceUid: Number(process.env.WORKSPACE_UID || 1001),
    networkMode: process.env.WORKER_NETWORK_MODE || 'none',
    image: process.env.SANDBOX_IMAGE || 'execify-sandbox',
    readOnly: String(process.env.WORKER_READONLY || 'false').toLowerCase() === 'true'
  },
  commands: {
    fetchTimeoutMs: Number(process.env.FETCH_TIMEOUT_MS || 10000),
    allowedHttpMethods: parseList(
      process.env.ALLOWED_HTTP_METHODS,
      ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']
    ).map(m => m.toUpperCase()),
    urlWhitelist: parseList(process.env.URL_WHITELIST, DEFAULT_URL_WHITELIST)
  },
  retryRules: {
    syntax_error: 'do_not_retry',
    missing_dependency: 'do_not_retry',
    input_validation: 'do_not_retry',
    runtime_error: 'retry_optional',
    timeout: 'retry_allowed'
  },
  limits: {
    maxMemoryMb: Number(process.env.WORKER_MEMORY_MB || 256),
    maxFileSizeMb: Number(process.env.MAX_FILE_SIZE_MB || 10)
  },
  SAFE_FILENAME_RE
}

module.exports = config
