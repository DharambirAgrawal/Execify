const { v4: uuidv4 } = require('uuid')
const { getWorker, markBusy, markFree, cleanWorkerWorkspace } = require('./pool')
const config = require('./config')

const sessions = new Map()

function now() {
	return Date.now()
}

function clearSessionTimer(session) {
	if (session?.timer) {
		clearTimeout(session.timer)
	}
}

function isExpired(session) {
	return Boolean(session && session.expiresAt <= now())
}

async function deleteSession(sessionId, { reason = 'deleted' } = {}) {
	const session = sessions.get(sessionId)
	if (!session) {
		return null
	}

	if (session.inUse) {
		return { error: 'Session is busy', status: 409, sessionId }
	}

	clearSessionTimer(session)
	sessions.delete(sessionId)

	try {
		await cleanWorkerWorkspace(session.worker)
	} catch {}

	markFree(session.worker)

	return {
		sessionId,
		reason,
		workerName: session.worker.name
	}
}

async function createSession({ expiresIn = config.session.defaultTtlSeconds } = {}) {
	const ttlSeconds = Math.max(1, Math.min(Number(expiresIn) || config.session.defaultTtlSeconds, config.session.maxTtlSeconds))
	const worker = getWorker()

	if (!worker) {
		return { error: 'No workers available for session creation', status: 503 }
	}

	markBusy(worker)
	await cleanWorkerWorkspace(worker)

	const sessionId = uuidv4()
	const expiresAt = now() + (ttlSeconds * 1000)
	const createdAt = new Date().toISOString()
	const session = {
		sessionId,
		worker,
		createdAt,
		lastUsedAt: createdAt,
		expiresAt,
		expired: false,
		inUse: false,
		timer: null
	}

	session.timer = setTimeout(() => {
		session.expired = true
		if (!session.inUse) {
			void deleteSession(sessionId, { reason: 'expired' })
		}
	}, ttlSeconds * 1000)

	if (typeof session.timer.unref === 'function') {
		session.timer.unref()
	}

	sessions.set(sessionId, session)

	return {
		session_id: sessionId,
		expires_in: ttlSeconds,
		expires_at: new Date(expiresAt).toISOString(),
		worker: worker.name
	}
}

function getSession(sessionId) {
	const session = sessions.get(sessionId)
	if (!session) {
		return null
	}

	if ((session.expired || isExpired(session)) && !session.inUse) {
		void deleteSession(sessionId, { reason: 'expired' })
		return null
	}

	return session
}

function beginSessionUse(session) {
	if (!session || session.inUse || session.expired || isExpired(session)) {
		return false
	}

	session.inUse = true
	session.lastUsedAt = new Date().toISOString()
	return true
}

function endSessionUse(session) {
	if (!session) {
		return
	}

	if (session.expired || isExpired(session)) {
		void deleteSession(session.sessionId, { reason: 'expired' })
		return
	}

	session.inUse = false
	session.lastUsedAt = new Date().toISOString()
}

function getSessionSnapshot(sessionId) {
	const session = getSession(sessionId)
	if (!session) {
		return null
	}

	return {
		session_id: session.sessionId,
		worker: session.worker.name,
		created_at: session.createdAt,
		last_used_at: session.lastUsedAt,
		expires_at: new Date(session.expiresAt).toISOString(),
		in_use: session.inUse
	}
}

module.exports = {
	createSession,
	deleteSession,
	getSession,
	getSessionSnapshot,
	beginSessionUse,
	endSessionUse
}