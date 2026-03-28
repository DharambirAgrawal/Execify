require('dotenv').config({ quiet: true });
const fs = require('fs');
const path = require('path');

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GEMINI_API_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const AI_PROVIDER = (process.env.AI_PROVIDER || (process.env.GEMINI_API_KEY ? 'gemini' : 'groq')).toLowerCase();
const DEFAULT_MODEL = AI_PROVIDER === 'gemini'
	? (process.env.GEMINI_MODEL || 'gemini-3-flash-preview')
	: (process.env.GROQ_MODEL || 'llama-3.3-70b-versatile');
const DEFAULT_REVIEW_MODEL = AI_PROVIDER === 'gemini'
	? (process.env.GEMINI_REVIEW_MODEL || DEFAULT_MODEL)
	: (process.env.GROQ_REVIEW_MODEL || DEFAULT_MODEL);
const ENABLE_REVIEW_PASS = (process.env.GROQ_ENABLE_REVIEW || 'true').toLowerCase() !== 'false';
const DEFAULT_SKILL_PATH = process.env.SKILL_FILE || path.join(__dirname, 'skills', 'docskill.md');

function sleep(ms) {
	return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfterMs(message) {
	const secMatch = /try again in\s+([0-9]+(?:\.[0-9]+)?)s/i.exec(message || '');
	if (!secMatch) {
		return 2000;
	}
	return Math.ceil(Number(secMatch[1]) * 1000) + 300;
}

function getUserDescription() {
	const input = process.argv.slice(2).join(' ').trim();
	if (!input) {
		throw new Error(
			'Missing description. Usage: node fetch.js "Create a 1-page resume with sections: Summary, Skills, Experience"'
		);
	}
	return input;
}

function loadSkillText(skillPath) {
	if (!fs.existsSync(skillPath)) {
		throw new Error(`Skill file not found: ${skillPath}`);
	}
	return fs.readFileSync(skillPath, 'utf8');
}

function buildMessages(skillText, description) {
	return [
		{
			role: 'system',
			content:
				'You are a senior DOCX JavaScript generator. Follow the provided skill exactly and return strict JSON only. Prioritize high-quality structure, detailed layout, and reusable helper functions over minimal examples.'
		},
		{
			role: 'user',
			content: [
				'Skill to follow:',
				skillText,
				'',
				'Document request:',
				description,
				'',
				'Return strict JSON with the schema from the skill. The code should be production-ready and complex enough for professional documents.',
				'Quality requirements: explicit page settings, proper section hierarchy, robust numbering config for bullets, helper functions for repeated patterns, and realistic content depth.',
				'Hard correctness rules: Header/Footer must be configured in section headers/footers only, never inside children; headers.default/footers.default must be Header/Footer objects, not Paragraph.'
			].join('\n')
		}
	];
}

async function requestGroq(messages, options = {}) {
	const apiKey = process.env.GROQ_API_KEY;
	if (!apiKey) {
		throw new Error('GROQ_API_KEY is missing in .env');
	}

	const model = options.model || DEFAULT_MODEL;
	const temperature = options.temperature ?? 0.1;
	const useJsonMode = options.useJsonMode ?? true;
	const maxRetries = options.maxRetries ?? 3;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const response = await fetch(GROQ_API_URL, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${apiKey}`,
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				model,
				temperature,
				messages,
				response_format: useJsonMode ? { type: 'json_object' } : undefined
			})
		});

		const data = await response.json().catch(() => ({}));

		if (response.ok) {
			const content = data.choices?.[0]?.message?.content;
			if (!content) {
				throw new Error('No content returned by Groq model');
			}
			return content;
		}

		const msg = data.error?.message || `Groq request failed with status ${response.status}`;
		const errCode = data.error?.code || '';
		const isRateLimit = response.status === 429 || /rate limit/i.test(msg);
		const isJsonValidation =
			/failed to validate json/i.test(msg) ||
			/failed to generate json/i.test(msg) ||
			/failed_generation/i.test(msg) ||
			/failed_generation/i.test(errCode);

		if (isRateLimit && attempt < maxRetries) {
			const waitMs = parseRetryAfterMs(msg);
			await sleep(waitMs);
			continue;
		}

		if (isJsonValidation && useJsonMode && !options._jsonFallbackTried) {
			return requestGroq(messages, {
				...options,
				useJsonMode: false,
				_jsonFallbackTried: true
			});
		}

		throw new Error(msg);
	}

	throw new Error('Groq request failed after retries');
}

function toGeminiContents(messages) {
	return messages.map((m) => ({
		role: m.role === 'assistant' ? 'model' : 'user',
		parts: [{ text: m.content }]
	}));
}

async function requestGemini(messages, options = {}) {
	const apiKey = process.env.GEMINI_API_KEY;
	if (!apiKey) {
		throw new Error('GEMINI_API_KEY is missing in .env');
	}

	const model = options.model || DEFAULT_MODEL;
	const temperature = options.temperature ?? 0.1;
	const maxRetries = options.maxRetries ?? 3;

	for (let attempt = 1; attempt <= maxRetries; attempt++) {
		const response = await fetch(`${GEMINI_API_URL}/${model}:generateContent?key=${apiKey}`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json'
			},
			body: JSON.stringify({
				generationConfig: {
					temperature,
					responseMimeType: options.useJsonMode ? 'application/json' : 'text/plain'
				},
				contents: toGeminiContents(messages)
			})
		});

		const data = await response.json().catch(() => ({}));

		if (response.ok) {
			const parts = data.candidates?.[0]?.content?.parts || [];
			const content = parts.map((p) => p.text || '').join('\n').trim();
			if (!content) {
				throw new Error('No content returned by Gemini model');
			}
			return content;
		}

		const msg = data.error?.message || `Gemini request failed with status ${response.status}`;
		const isRateLimit = response.status === 429 || /rate limit|quota|resource exhausted/i.test(msg);

		if (isRateLimit && attempt < maxRetries) {
			await sleep(parseRetryAfterMs(msg));
			continue;
		}

		throw new Error(msg);
	}

	throw new Error('Gemini request failed after retries');
}

async function requestModel(messages, options = {}) {
	if (AI_PROVIDER === 'gemini') {
		return requestGemini(messages, options);
	}
	return requestGroq(messages, options);
}

function normalizeOutput(raw) {
	const trimmed = raw.trim();

	// Many models wrap JSON in markdown fences; strip them for easy copy/paste.
	const fenceMatch = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
	return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

function ensureWorkspaceDir() {
	const dir = path.join(__dirname, 'workspace');
	fs.mkdirSync(dir, { recursive: true });
	return dir;
}

function tryParseJson(text) {
	try {
		return JSON.parse(text);
	} catch {
		return null;
	}
}

function tryParseLooseJson(text) {
	const strict = tryParseJson(text);
	if (strict) {
		return strict;
	}

	const start = text.indexOf('{');
	const end = text.lastIndexOf('}');
	if (start === -1 || end === -1 || end <= start) {
		return null;
	}

	return tryParseJson(text.slice(start, end + 1));
}

function extractJsonStringField(jsonLikeText, fieldName) {
	const keyPattern = new RegExp(`"${fieldName}"\\s*:\\s*"`, 'i');
	const match = keyPattern.exec(jsonLikeText);
	if (!match) {
		return null;
	}

	let i = match.index + match[0].length;
	let escaped = false;
	let collected = '';

	while (i < jsonLikeText.length) {
		const ch = jsonLikeText[i];
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
			break;
		}

		collected += ch;
		i += 1;
	}

	if (i >= jsonLikeText.length) {
		return null;
	}

	try {
		return JSON.parse(`"${collected}"`);
	} catch {
		return null;
	}
}

function extractUsableCode(raw, depth = 0) {
	if (typeof raw !== 'string') {
		return null;
	}

	const text = raw.trim();
	if (!text) {
		return null;
	}

	if (depth >= 4) {
		return text;
	}

	const nested = tryParseLooseJson(text);
	if (nested && typeof nested === 'object' && typeof nested.code === 'string') {
		return extractUsableCode(nested.code, depth + 1);
	}

	// Fallback for malformed JSON-like strings that still contain a quoted "code" field.
	const codeField = extractJsonStringField(text, 'code');
	if (typeof codeField === 'string' && codeField.trim()) {
		return extractUsableCode(codeField, depth + 1);
	}

	const fenced = text.match(/```(?:javascript|js)?\s*([\s\S]*?)\s*```/i);
	if (fenced) {
		return fenced[1].trim();
	}

	return text;
}

function inferOutputFilename(description) {
	if (/resume/i.test(description)) {
		return 'resume.docx';
	}
	if (/assignment/i.test(description)) {
		return 'assignment.docx';
	}
	if (/report/i.test(description)) {
		return 'report.docx';
	}
	return 'generated.docx';
}

function extractCodeFromText(text) {
	const fencedJs = text.match(/```(?:javascript|js)\s*([\s\S]*?)\s*```/i);
	if (fencedJs) {
		return fencedJs[1].trim();
	}

	const anyFenced = text.match(/```\s*([\s\S]*?)\s*```/);
	if (anyFenced) {
		return anyFenced[1].trim();
	}

	if (/\bconst\b|\brequire\(|\bnew\s+Document\b/.test(text)) {
		return text.trim();
	}

	return null;
}

function coerceToPayload(rawText, description) {
	const parsed = tryParseLooseJson(rawText);
	if (parsed && typeof parsed === 'object') {
		if (typeof parsed.code === 'string' && parsed.code.trim()) {
			const extractedCode = extractUsableCode(parsed.code);
			if (extractedCode) {
				parsed.code = extractedCode;
			}

			const filename = inferOutputFilename(description);
			parsed.file_name = 'test.js';
			parsed.language = 'javascript';
			parsed.dependencies = Array.isArray(parsed.dependencies) && parsed.dependencies.length
				? parsed.dependencies
				: ['docx'];
			parsed.run_command = 'node test.js';
			parsed.output_file = `workspace/${filename}`;
			parsed.notes = Array.isArray(parsed.notes) && parsed.notes.length
				? parsed.notes
				: [
					'Install dependency with: npm install docx',
					'Running node test.js will generate the DOCX file in workspace'
				];
			return parsed;
		}

		const nestedCode =
			typeof parsed.javascript === 'string' ? parsed.javascript :
			typeof parsed.js === 'string' ? parsed.js :
			null;

		if (nestedCode) {
			const extractedCode = extractUsableCode(nestedCode);
			parsed.code = extractedCode || nestedCode;
			const filename = inferOutputFilename(description);
			parsed.file_name = 'test.js';
			parsed.language = 'javascript';
			parsed.dependencies = ['docx'];
			parsed.run_command = 'node test.js';
			parsed.output_file = `workspace/${filename}`;
			parsed.notes = [
				'Install dependency with: npm install docx',
				'Running node test.js will generate the DOCX file in workspace'
			];
			return parsed;
		}
	}

	const code = extractCodeFromText(rawText);
	if (!code) {
		return null;
	}

	const extractedCode = extractUsableCode(code) || code;

	const filename = inferOutputFilename(description);
	return {
		file_name: 'test.js',
		language: 'javascript',
		dependencies: ['docx'],
		run_command: 'node test.js',
		output_file: `workspace/${filename}`,
		notes: [
			'Install dependency with: npm install docx',
			'Running node test.js will generate the DOCX file in workspace'
		],
		code: extractedCode
	};
}

function writeOutputFiles(normalized, description) {
	const workspaceDir = ensureWorkspaceDir();
	const fullOutputPath = path.join(workspaceDir, 'groq-output.txt');
	const codeOutputPath = path.join(workspaceDir, 'generated-code.txt');
	const codeJsPath = path.join(workspaceDir, 'generated-code.js');
	const jsonOutputPath = path.join(workspaceDir, 'generated-docx-response.json');

	fs.writeFileSync(fullOutputPath, normalized + '\n', 'utf8');

	const parsed = tryParseJson(normalized);
	const codeText = parsed && typeof parsed.code === 'string' ? parsed.code : normalized;
	if (parsed) {
		fs.writeFileSync(jsonOutputPath, JSON.stringify(parsed, null, 2) + '\n', 'utf8');
	}

	// Keep this file copy-ready: only code, no metadata prefix.
	fs.writeFileSync(codeOutputPath, codeText + '\n', 'utf8');
	fs.writeFileSync(codeJsPath, codeText + '\n', 'utf8');

	return {
		fullOutputPath,
		codeOutputPath,
		codeJsPath,
		jsonOutputPath: parsed ? jsonOutputPath : null
	};
}

function buildReviewMessages(skillText, description, firstPassJson) {
	return [
		{
			role: 'system',
			content:
				'You are a strict DOCX code reviewer. Improve quality and complexity while preserving valid JSON schema and runnable JavaScript. Output JSON only.'
		},
		{
			role: 'user',
			content: [
				'Skill:',
				skillText,
				'',
				'Document request:',
				description,
				'',
				'Current JSON output to improve:',
				JSON.stringify(firstPassJson),
				'',
				'Improve it to a professional level: richer sections, cleaner structure, reusable helper functions, valid docx APIs, and strong formatting defaults.',
				'Return only the final improved JSON with the same top-level keys.'
			].join('\n')
		}
	];
}

function validateGeneratedPayload(payload) {
	const errors = [];

	if (!payload || typeof payload !== 'object') {
		return ['Response JSON is not an object'];
	}

	if (typeof payload.code !== 'string' || !payload.code.trim()) {
		return ['Missing or empty "code" field'];
	}

	const code = payload.code;
	const checks = [
		{ re: /new\s+Document\(\s*\)/, msg: 'Do not use new Document() without options.' },
		{ re: /\bdoc\.addParagraph\s*\(/, msg: 'Invalid docx API: doc.addParagraph(...)' },
		{ re: /\bdoc\.addTable\s*\(/, msg: 'Invalid docx API: doc.addTable(...)' },
		{ re: /\bdoc\.addHeader\s*\(/, msg: 'Invalid docx API: doc.addHeader(...)' },
		{ re: /new\s+Bullet\s*\(/, msg: 'Invalid docx API: new Bullet(...)' },
		{ re: /children\s*:\s*\[[\s\S]*?new\s+Header\s*\(/, msg: 'Header must not be placed inside section children.' },
		{ re: /children\s*:\s*\[[\s\S]*?new\s+Footer\s*\(/, msg: 'Footer must not be placed inside section children.' },
		{ re: /headers\s*:\s*\{[\s\S]*?default\s*:\s*new\s+Paragraph\s*\(/, msg: 'headers.default must be new Header(...), not Paragraph.' },
		{ re: /footers\s*:\s*\{[\s\S]*?default\s*:\s*new\s+Paragraph\s*\(/, msg: 'footers.default must be new Footer(...), not Paragraph.' }
	];

	for (const c of checks) {
		if (c.re.test(code)) {
			errors.push(c.msg);
		}
	}

	if (/numbering\s*:\s*\{\s*reference\s*:\s*['"]bullets?['"]/.test(code) && !/numbering\s*:\s*\{[\s\S]*config\s*:/.test(code)) {
		errors.push('Bullet paragraph uses numbering reference, but Document-level numbering.config is missing.');
	}

	if (!/new\s+Document\s*\(\s*\{[\s\S]*sections\s*:/.test(code)) {
		errors.push('Document options should include sections.');
	}

	return errors;
}

function buildRepairMessages(skillText, description, draftJson, validationErrors) {
	return [
		{
			role: 'system',
			content: 'You are a strict DOCX JavaScript fixer. Output JSON only. Fix all validation errors and keep quality high. Never place Header/Footer in section children.'
		},
		{
			role: 'user',
			content: [
				'Skill:',
				skillText,
				'',
				'Document request:',
				description,
				'',
				'Current JSON to fix:',
				JSON.stringify(draftJson),
				'',
				'Validation errors:',
				validationErrors.map((e) => `- ${e}`).join('\n'),
				'',
				'Hard fix instructions:',
				'- If you see new Header/new Footer in section children, move them under section headers.default / footers.default.',
				'- headers.default must be new Header({ children: [...] }).',
				'- footers.default must be new Footer({ children: [...] }).',
				'- Ensure Header and Footer are imported from docx if used.',
				'- Keep section children for paragraphs/tables only.',
				'',
				'Return corrected JSON with the same top-level schema. Ensure code is runnable with current docx package.'
			].join('\n')
		}
	];
}

async function repairUntilValid(skillText, description, parsed, maxAttempts = 2) {
	let candidate = parsed;

	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const errs = validateGeneratedPayload(candidate);
		if (errs.length === 0) {
			return candidate;
		}

		const repairMessages = buildRepairMessages(skillText, description, candidate, errs);
		const repairResult = await requestModel(repairMessages, {
			model: DEFAULT_REVIEW_MODEL,
			temperature: 0.1,
			useJsonMode: true
		});

		const repaired = normalizeOutput(repairResult);
		const repairedParsed = tryParseJson(repaired);
		if (!repairedParsed) {
			continue;
		}

		candidate = repairedParsed;
	}

	const finalErrors = validateGeneratedPayload(candidate);
	if (finalErrors.length > 0) {
		throw new Error(`Generated code failed validation: ${finalErrors.join(' | ')}`);
	}

	return candidate;
}

async function main() {
	try {
		const description = getUserDescription();
		const skillText = loadSkillText(DEFAULT_SKILL_PATH);
		const messages = buildMessages(skillText, description);

		const result = await requestModel(messages, {
			model: DEFAULT_MODEL,
			temperature: 0.1,
			useJsonMode: false
		});
		let normalized = normalizeOutput(result);
		const parsed = coerceToPayload(normalized, description);
		if (parsed) {
			normalized = JSON.stringify(parsed, null, 2);
		}

		const saved = writeOutputFiles(normalized, description);

		// Print model output and file locations for easy copy/paste.
		process.stdout.write(normalized + '\n');
		process.stderr.write(`Provider: ${AI_PROVIDER}\n`);
		process.stderr.write(`Model: ${DEFAULT_MODEL}\n`);
		process.stderr.write(`Saved full output: ${saved.fullOutputPath}\n`);
		process.stderr.write(`Saved code text: ${saved.codeOutputPath}\n`);
		process.stderr.write(`Saved runnable JS: ${saved.codeJsPath}\n`);
		if (saved.jsonOutputPath) {
			process.stderr.write(`Saved JSON output: ${saved.jsonOutputPath}\n`);
		}
	} catch (error) {
		console.error(`Error: ${error.message}`);
		process.exit(1);
	}
}

main();
