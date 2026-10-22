import { isAbsolute, relative } from 'path';

import { promptText } from './sessions/history';
import { transcriptFile } from './sessions/transcript';

// What Claude did, turn by turn, from its transcript: each prompt, then the tools it used in order (what each was
// about, whether it worked, a little of what it said back), how long the turn took, and how full the context was.
// Transcripts run to tens of megabytes, so only their end is read: the turns worth looking back at.
export const TAIL_BYTES = 6 * 1024 * 1024;
const MAX_TURNS = 40;
const OUTPUT_CHARACTERS = 2000;
const PROMPT_PREVIEW = 200;
// The prompt as asked, for what reads a turn's words rather than lists it
const ASKED_CHARACTERS = 2000;
// The end of what Claude last wrote in a turn: its answer, usually
const SAID_CHARACTERS = 800;

const cache = new Map();
const DECLINED = /doesn't want to proceed with this tool use/;

export const lastLines = async file => {
	const size = file.size;
	const text = await file.slice(Math.max(0, size - TAIL_BYTES)).text();
	// Read from partway through a line: the first is cut short
	const lines = text.split('\n').slice(size > TAIL_BYTES ? 1 : 0);

	return lines.flatMap(line => {
		if (!line) return [];

		try {
			return [JSON.parse(line)];
		} catch {
			return [];
		}
	});
};

const shown = (cwd, file) => {
	if (typeof file !== 'string') return null;

	const within = relative(cwd, file);

	return within && !within.startsWith('..') && !isAbsolute(within) ? within : file;
};

// What a tool call was about, in a few words, and the project file it touched (to open)
export const describeTool = (name, input = {}, cwd = '') => {
	const file = shown(cwd, input.file_path ?? input.notebook_path ?? input.path);

	switch (name) {
		case 'Read':
			return { summary: file, file, line: input.offset ? input.offset + 1 : null };
		case 'Edit':
		case 'MultiEdit':
		case 'Write':
		case 'NotebookEdit':
			return { summary: file, file, edits: true };
		case 'Bash':
			return { summary: input.description || input.command, command: input.command };
		case 'Grep':
			return { summary: `${input.pattern}${input.path ? ` in ${file}` : ''}` };
		case 'Glob':
			return { summary: input.pattern };
		case 'WebFetch':
			return { summary: input.url };
		case 'WebSearch':
			return { summary: input.query };
		case 'Task':
		case 'Agent':
			return { summary: input.description || input.prompt?.slice(0, 120) };
		case 'TodoWrite':
			return { summary: `${input.todos?.length ?? 0} to-dos` };
		default:
			return {
				summary:
					Object.values(input)
						.find(value => typeof value === 'string')
						?.slice(0, 120) ?? '',
			};
	}
};

// What a tool printed, its start and its end when it said more: a test run's summary comes last
const resultText = content => {
	const text =
		typeof content === 'string'
			? content
			: (content ?? [])
					.filter(block => block.type === 'text')
					.map(block => block.text)
					.join('\n');
	const half = OUTPUT_CHARACTERS / 2;

	return text.length <= OUTPUT_CHARACTERS ? text : `${text.slice(0, half)}\n[...]\n${text.slice(-half)}`;
};

// How much of the context the request after this message carried: what was sent, cached or not
const contextOf = usage =>
	usage
		? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
		: null;

// The transcript's lines as turns, newest last: [{ id, prompt, at, endedAt, steps, context, output, said }]
export const timelineFrom = (lines, cwd) => {
	const turns = [];
	const pending = new Map();

	for (const line of lines) {
		const prompt = promptText(line);

		if (prompt !== null) {
			const asked = prompt.replace(/<\/?pasted_content[^>]*>/g, '').trim();

			turns.push({
				id: line.uuid,
				prompt: asked.slice(0, PROMPT_PREVIEW),
				asked: asked.slice(0, ASKED_CHARACTERS),
				at: line.timestamp,
				endedAt: line.timestamp,
				interrupted: /^\[Request interrupted/.test(prompt),
				// Claude Code's summary of the conversation so far, carried into a fresh context: not the person's words
				summary: Boolean(line.isCompactSummary),
				steps: [],
				context: null,
				output: 0,
			});
			continue;
		}

		const turn = turns.at(-1);

		if (!turn) continue;
		if (line.timestamp) turn.endedAt = line.timestamp;

		if (line.type === 'assistant') {
			const { usage, content = [] } = line.message ?? {};

			turn.context = contextOf(usage) ?? turn.context;
			turn.output += usage?.output_tokens ?? 0;
			turn.model = line.message?.model ?? turn.model;

			const said = content
				.filter(block => block.type === 'text')
				.map(block => block.text)
				.join('\n')
				.trim();

			if (said) turn.said = said.slice(-SAID_CHARACTERS);

			for (const block of content) {
				if (block.type !== 'tool_use') continue;

				const step = {
					id: block.id,
					tool: block.name,
					at: line.timestamp,
					...describeTool(block.name, block.input, cwd),
				};

				turn.steps.push(step);
				pending.set(block.id, step);
			}
		} else if (line.type === 'user' && Array.isArray(line.message?.content)) {
			for (const block of line.message.content) {
				const step = block.type === 'tool_result' && pending.get(block.tool_use_id);

				if (!step) continue;

				step.ok = !block.is_error;
				step.output = resultText(block.content);
				// Turned down at its permission prompt: a person steering, not a failure
				if (step.ok === false && DECLINED.test(step.output)) step.declined = true;
				step.endedAt = line.timestamp;
				pending.delete(block.tool_use_id);
			}
		}
	}

	return turns;
};

// Every turn in the part of the transcript read, oldest first, read again only when it has grown
export const sessionTurns = async (id, cwd) => {
	const file = await transcriptFile(id, cwd);

	if (!file) return [];

	const key = `${file.name}:${file.size}`;

	if (cache.get(id)?.key !== key) cache.set(id, { key, turns: timelineFrom(await lastLines(file), cwd) });

	return cache.get(id).turns;
};

// The latest turns, newest first, and how full the context is now
export const sessionTimeline = async (id, cwd) => {
	const turns = await sessionTurns(id, cwd);
	const latest = turns.findLast(turn => turn.context !== null);

	return {
		turns: turns.slice(-MAX_TURNS).reverse(),
		context: latest ? { tokens: latest.context, model: latest.model } : null,
	};
};
