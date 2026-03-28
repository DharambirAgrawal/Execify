class InMemoryJobQueue {
	constructor({ maxSize = 1000 } = {}) {
		this.maxSize = maxSize
		this.pending = []
		this.running = false
		this.nextId = 1
	}

	enqueue(handler, payload = {}) {
		if (typeof handler !== 'function') {
			throw new Error('handler must be a function')
		}

		if (this.pending.length >= this.maxSize) {
			throw new Error('Queue is full')
		}

		const id = this.nextId++

		return new Promise((resolve, reject) => {
			this.pending.push({ id, handler, payload, resolve, reject, enqueuedAt: Date.now() })
			this.processNext()
		})
	}

	getStats() {
		return {
			queued: this.pending.length,
			running: this.running
		}
	}

	async processNext() {
		if (this.running || this.pending.length === 0) {
			return
		}

		const job = this.pending.shift()
		this.running = true

		try {
			const result = await job.handler(job.payload)
			job.resolve({ id: job.id, result, enqueuedAt: job.enqueuedAt, completedAt: Date.now() })
		} catch (error) {
			job.reject(error)
		} finally {
			this.running = false
			this.processNext()
		}
	}
}

function createJobQueue(options) {
	return new InMemoryJobQueue(options)
}

const queue = createJobQueue()

module.exports = {
	InMemoryJobQueue,
	createJobQueue,
	queue
}
