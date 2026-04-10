const config = require('./config')

const usageByKey = new Map()

function getOrCreateKeyUsage(apiKey) {
	if (!usageByKey.has(apiKey)) {
		usageByKey.set(apiKey, {
			apiKey,
			totalRequests: 0,
			totalDurationMs: 0,
			counts: {
				run: 0,
				streamRun: 0,
				command: 0,
				sessionCreate: 0,
				sessionDelete: 0,
				moduleInventory: 0,
				conversion: 0
			},
			recent: []
		})
	}

	return usageByKey.get(apiKey)
}

function recordUsage(apiKey, entry = {}) {
	if (!apiKey) {
		return null
	}

	const record = getOrCreateKeyUsage(apiKey)
	record.totalRequests += 1

	if (Number.isFinite(entry.durationMs)) {
		record.totalDurationMs += entry.durationMs
	}

	if (entry.kind && Object.prototype.hasOwnProperty.call(record.counts, entry.kind)) {
		record.counts[entry.kind] += 1
	}

	record.recent.unshift({
		timestamp: new Date().toISOString(),
		...entry
	})

	if (record.recent.length > config.usage.maxRecentEventsPerKey) {
		record.recent.length = config.usage.maxRecentEventsPerKey
	}

	return record
}

function getUsage(apiKey) {
	const record = getOrCreateKeyUsage(apiKey)
	return {
		apiKey: record.apiKey,
		totalRequests: record.totalRequests,
		totalDurationMs: record.totalDurationMs,
		counts: { ...record.counts },
		recent: [...record.recent]
	}
}

module.exports = {
	recordUsage,
	getUsage
}