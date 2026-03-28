const fs = require('fs').promises
const path = require('path')

async function encodeFileToBase64(filePath) {
	const content = await fs.readFile(filePath)
	return {
		name: path.basename(filePath),
		content: content.toString('base64'),
		size: content.length
	}
}

async function collectOutputFilesFromDirectory(directory, { exclude = [] } = {}) {
	const entries = await fs.readdir(directory, { withFileTypes: true })
	const excludedNames = new Set(exclude)
	const outputFiles = []

	for (const entry of entries) {
		if (!entry.isFile() || excludedNames.has(entry.name)) {
			continue
		}

		const fullPath = path.join(directory, entry.name)
		outputFiles.push(await encodeFileToBase64(fullPath))
	}

	return outputFiles
}

module.exports = {
	encodeFileToBase64,
	collectOutputFilesFromDirectory
}
