const { execSync, exec } = require('child_process')
const { promisify } = require('util')
const config = require('./config')
const execAsync = promisify(exec)

const POOL_SIZE = config.workerPool.size
const pool = []

async function startContainer(id) {
  const name = `execify-worker-${id}`

  try {
    execSync(`docker rm -f ${name}`, { stdio: 'ignore' })
  } catch {}

  const readOnlyFlag = config.workerPool.readOnly ? '--read-only' : ''
  await execAsync(`
    docker run -d \
      --name ${name} \
      --network ${config.workerPool.networkMode} \
      --memory ${config.workerPool.memoryMb}m \
      --cpus ${config.workerPool.cpus} \
      ${readOnlyFlag} \
      --tmpfs /workspace:size=${config.workerPool.tmpfsSizeMb}m,uid=${config.workerPool.workspaceUid} \
      --user ${config.workerPool.workspaceUid} \
      ${config.workerPool.image}
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