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