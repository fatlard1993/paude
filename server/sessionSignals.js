import { appendFile } from 'fs/promises';
import os from 'os';
import path from 'path';

import { transcriptLines } from './sessions/transcript';

// What a session reached for, kept when its transcript is deleted: counts and sizes, never what was said, one JSON
// line per session in session-signals.jsonl. Enough to ask later which tools, skills, agents and commands earn their
// place, where hooks push back, and what the context at start weighs, after the sessions themselves are gone.

let file;

export const initSessionSignals = dataDir => {
	file = path.join(dataDir, 'session-signals.jsonl');
};

const add = (counts, key, by = 1) => {
	if (key) counts[key] = (counts[key] ?? 0) + by;
};

const HEREDOC_BODY = /<<-?\s*['"]?(\w+)['"]?([^\n]*)\n[\s\S]*?\n\s*\1(?=\n|$)/g;
const QUOTED = /'[^']*'|"(?:\\.|[^"\\])*"/g;
// The shell's words that come before a command, and those that stand where one would but aren't one
const BEFORE_COMMAND = new Set(['do', 'then', 'else', 'elif', 'if', 'while', 'until', '!', '{']);
const NOT_COMMANDS = new Set(['cd', 'for', 'case', 'done', 'fi', 'esac', '}']);

// The programs a shell command runs: the first word of each piece between pipes, &&, || and ;, past any VAR=value
// and the shell's own words, and not inside a heredoc's body or a quoted script (bun -e "...")
export const programsOf = command =>
	command
		.replace(HEREDOC_BODY, '$2')
		.replace(QUOTED, "''")
		.split(/\|\||&&|[|;\n]/)
		.map(piece =>
			piece
				.trim()
				.split(/\s+/)
				.find(word => word && !/^\w+=/.test(word) && !BEFORE_COMMAND.has(word)),
		)
		.filter(word => word && !NOT_COMMANDS.has(word) && /^[\w./~-]+$/.test(word))
		.map(word => path.basename(word));

const textOf = content =>
	typeof content === 'string'
		? content
		: (content ?? [])
				.filter(block => block.type === 'text')
				.map(block => block.text)
				.join('\n');

const isToolResult = content => Array.isArray(content) && content.some(block => block.type === 'tool_result');

export const signalsOf = (lines, { id, cwd, at = new Date().toISOString(), host = os.hostname() } = {}) => {
	const signals = {
		id,
		at,
		host,
		cwd,
		title: null,
		started: null,
		ended: null,
		prompts: 0,
		models: {},
		tools: {},
		programs: {},
		skills: {},
		agents: {},
		commands: {},
		hookBlocks: {},
		permissionDenials: 0,
		compactions: 0,
		startContextChars: 0,
		tokens: { input: 0, cacheWrite: 0, cacheRead: 0, output: 0 },
	};
	// A reply streams in as several lines carrying the same message and the same usage: counted once
	const counted = new Set();

	for (const line of lines) {
		if (line.isSidechain) continue;
		if (line.timestamp) {
			signals.started ??= line.timestamp;
			signals.ended = line.timestamp;
		}
		if (line.type === 'ai-title' && line.aiTitle) signals.title = line.aiTitle;

		const { attachment, message } = line;

		if (line.type === 'system' && line.subtype === 'compact_boundary') signals.compactions += 1;
		if (attachment?.type === 'hook_success' && attachment.hookEvent === 'SessionStart')
			signals.startContextChars += attachment.content?.length ?? 0;
		if (attachment?.type === 'hook_blocking_error') add(signals.hookBlocks, attachment.hookName);
		if (attachment?.type === 'hook_permission_decision' && attachment.decision === 'deny')
			signals.permissionDenials += 1;

		if (line.type === 'user' && message && !line.isMeta && !line.isCompactSummary && !isToolResult(message.content)) {
			const text = textOf(message.content);
			const command = /<command-name>\/?([^<\s]+)<\/command-name>/.exec(text)?.[1];

			if (command) add(signals.commands, command);
			else if (text.trim()) signals.prompts += 1;
		}

		if (line.type !== 'assistant' || !message) continue;

		// A <synthetic> reply is Claude Code's own (an error, an interruption), not a model's
		if (message.usage && !message.model?.startsWith('<') && !counted.has(message.id)) {
			counted.add(message.id);
			add(signals.models, message.model);
			signals.tokens.input += message.usage.input_tokens ?? 0;
			signals.tokens.cacheWrite += message.usage.cache_creation_input_tokens ?? 0;
			signals.tokens.cacheRead += message.usage.cache_read_input_tokens ?? 0;
			signals.tokens.output += message.usage.output_tokens ?? 0;
		}

		for (const block of Array.isArray(message.content) ? message.content : []) {
			if (block.type !== 'tool_use') continue;

			const input = block.input ?? {};

			add(signals.tools, block.name);
			if (block.name === 'Bash') for (const program of programsOf(input.command ?? '')) add(signals.programs, program);
			if (block.name === 'Skill') add(signals.skills, input.skill);
			if (block.name === 'Agent' || block.name === 'Task')
				add(signals.agents, input.subagent_type ?? 'general-purpose');
		}
	}

	return signals;
};

// Kept before the transcript goes; a session that never got a prompt has nothing worth keeping
export const keepSignals = async (id, cwd) => {
	if (!file) return;

	const lines = await transcriptLines(id, cwd);

	if (!lines.length) return;

	await appendFile(file, `${JSON.stringify(signalsOf(lines, { id, cwd }))}\n`);
};
