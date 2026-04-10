require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const OpenAI = require('openai').default || require('openai');

// Previous default model: minimax/minimax-m2.5:free
// Requested but invalid on OpenRouter: qwen/qwen3-coder-480b-a35b:free
const MODEL = process.env.OPENROUTER_MODEL || 'openrouter/free';
const FALLBACK_MODELS = (process.env.OPENROUTER_FALLBACK_MODELS || [
	'qwen/qwen3-coder:free',
	'google/gemma-4-31b-it:free',
	'meta-llama/llama-3.3-70b-instruct:free',
	'qwen/qwen-2.5-coder-32b-instruct'
].join(','))
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean);
const DEFAULT_SKILL_PATH = process.env.SKILL_FILE || path.join(__dirname, 'skills', 'docskill.md');

const client = new OpenAI({
	apiKey: process.env.OPENROUTER_API_KEY,
	baseURL: 'https://openrouter.ai/api/v1',
	defaultHeaders: {
		'X-OpenRouter-Title': 'Execify Code Generator'
	}
});

function getUserPrompt() {
	const input = process.argv.slice(2).join(' ').trim();
	if (!input) {
		throw new Error('Missing prompt. Usage: node ortest.js "Your instructions here"');
	}
	return input;
}

function loadSkillText(skillPath) {
	if (!fs.existsSync(skillPath)) {
		throw new Error(`Skill file not found: ${skillPath}`);
	}
	return fs.readFileSync(skillPath, 'utf8');
}

async function requestOpenRouter(messages) {
	console.log('📡 Sending request to OpenRouter via OpenAI SDK...');

	const modelsToTry = [MODEL, ...FALLBACK_MODELS.filter((m) => m !== MODEL)];

	console.log('\n📋 Request:');
	console.log(`Model(s): ${modelsToTry.join(' -> ')}`);
	console.log(`Messages: ${messages.length} message(s)`);
	console.log(`User message length: ${messages[0].content.length} chars`);
	console.log(`API baseURL: https://openrouter.ai/api/v1\n`);

	let lastError = null;
	for (const model of modelsToTry) {
		try {
			console.log(`⏳ Trying model: ${model}`);
			const response = await client.chat.completions.create({
				model,
				max_tokens: 8000,
				temperature: 0.2,
				messages
			});

			console.log('✨ Response received!\n');

			const choice = response.choices?.[0];
			const rawContent = choice?.message?.content;
			const content = typeof rawContent === 'string'
				? rawContent
				: Array.isArray(rawContent)
					? rawContent.map((p) => (typeof p === 'string' ? p : p?.text || '')).join('')
					: null;

			if (!content || !content.trim()) {
				const finishReason = choice?.finish_reason || 'unknown';
				const modelUsed = response?.model || model;
				console.log(`⚠️ Empty content from ${modelUsed} (finish_reason: ${finishReason}).`);
				if (finishReason === 'length') {
					console.log('↪️ Output hit length limit; trying next fallback model...\n');
					continue;
				}
				throw new Error('No content in API response');
			}

			console.log(`✓ Got ${content.length} chars of code\n`);
			return content;
		} catch (error) {
			lastError = error;
			const status = error?.status;
			const msg = error?.message || '';

			if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT')) {
				throw new Error(`Connection error: ${msg}. Check if OpenRouter API is reachable.`);
			}

			if (status === 402 || status === 429 || /Provider returned error/i.test(msg)) {
				console.log(`⚠️ Model failed (${status || 'error'}): ${msg}`);
				console.log('↪️ Trying next fallback model...\n');
				continue;
			}

			throw error;
		}
	}

	throw lastError || new Error('All model attempts failed');
}

function ensureWorkspaceDir() {
	const dir = path.join(__dirname, 'workspace');
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function stripCodeFences(text) {
	const fenceMatch = text.match(/^```(?:javascript|js)?\s*([\s\S]*?)\s*```$/i);
	return fenceMatch ? fenceMatch[1].trim() : text.trim();
}

function parseModelOutputToCode(raw) {
	const cleaned = stripCodeFences(raw);

	try {
		const parsed = JSON.parse(cleaned);
		if (parsed && typeof parsed.code === 'string' && parsed.code.trim()) {
			return stripCodeFences(parsed.code);
		}
	} catch {
		// Not JSON; continue with plain text handling.
	}

	const keyIdx = cleaned.indexOf('"code"');
	if (keyIdx !== -1) {
		const colonIdx = cleaned.indexOf(':', keyIdx);
		const firstQuoteIdx = cleaned.indexOf('"', colonIdx + 1);
		if (colonIdx !== -1 && firstQuoteIdx !== -1) {
			let i = firstQuoteIdx + 1;
			let escaped = false;
			let collected = '';

			while (i < cleaned.length) {
				const ch = cleaned[i];
				if (escaped) {
					collected += `\\${ch}`;
					escaped = false;
					i += 1;
					continue;
				}

				if (ch === '\\') {
					escaped = true;
					i += 1;
					continue;
				}

				if (ch === '"') {
					try {
						return JSON.parse(`"${collected}"`);
					} catch {
						break;
					}
				}

				collected += ch;
				i += 1;
			}

			// Truncated response fallback: decode common escapes from collected fragment.
			if (collected.trim()) {
				return collected
					.replace(/\\n/g, '\n')
					.replace(/\\r/g, '\r')
					.replace(/\\t/g, '\t')
					.replace(/\\"/g, '"')
					.replace(/\\\\/g, '\\');
			}
		}
	}

	return cleaned;
}

function assertValidJavaScript(code) {
	try {
		new vm.Script(code);
		return null;
	} catch (err) {
		return err.message;
	}
}

async function main() {
	try {
		const prompt = getUserPrompt();
		console.log(`📝 Generating code for: "${prompt}"\n`);
		
		console.log('📂 Loading skill file...');
		const skillText = loadSkillText(DEFAULT_SKILL_PATH);
		console.log(`✓ Skill file loaded (${skillText.length} chars)\n`);

		const messages = [
			{
				role: 'user',
				content: [
					`Request:\n${prompt}`,
					'Return ONLY raw JavaScript code.',
					'Do not return JSON.',
					'Do not wrap the code in markdown fences.',
					'Ensure the code is syntactically valid and runnable in Node.js CommonJS.',
					'Keep the code compact and complete: prefer helper functions and generated/repeated paragraphs over extremely long hardcoded text blocks.'
				].join('\n\n')
			}
		];

		const result = await requestOpenRouter(messages);
		const code = parseModelOutputToCode(result);
		const syntaxError = assertValidJavaScript(code);

		const workspaceDir = ensureWorkspaceDir();
		const outputFile = path.join(workspaceDir, 'generated_code.js');
		const rawOutputFile = path.join(workspaceDir, 'generated_raw_response.txt');

		if (syntaxError) {
			fs.writeFileSync(rawOutputFile, result, 'utf8');
			throw new Error(
				`Generated output is not valid JavaScript: ${syntaxError}. Raw response saved at ${rawOutputFile}`
			);
		}
		
		fs.writeFileSync(outputFile, code, 'utf8');

		console.log(`\n✅ Code generated and saved to: ${outputFile}\n`);
		console.log('═'.repeat(60));
		console.log('Generated code:\n');
		console.log(code);
		console.log('\n' + '═'.repeat(60));
	} catch (error) {
		console.error(`❌ Error: ${error.message}`);
		process.exit(1);
	}
}

main();
