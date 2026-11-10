import { isAbsolute, relative } from 'path';

import { commandEditsOf } from './commandEdits';
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
// What Claude last wrote in a turn, its start and its end when long: its answer, usually, whose list of what it did
// sits at its start as often as its end
const SAID_CHARACTERS = 2000;

const cache = new Map();
const DECLINED = /doesn't want to proceed with this tool use/;

export const lastLines = async (file, bytes = TAIL_BYTES) => {
	const size = file.size;
	const text = await file.slice(Math.max(0, size - bytes)).text();
	// Read from partway through a line: the first is cut short
	return parseLines(text.split('\n').slice(size > bytes ? 1 : 0));
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

// A text's start and its end, when it's longer than room
export const startAndEnd = (text, room) =>
	text.length <= room ? text : `${text.slice(0, room / 2)}\n[...]\n${text.slice(-room / 2)}`;

// What a tool printed, its start and its end when it said more: a test run's summary comes last
const resultText = content =>
	startAndEnd(
		typeof content === 'string'
			? content
			: (content ?? [])
					.filter(block => block.type === 'text')
					.map(block => block.text)
					.join('\n'),
		OUTPUT_CHARACTERS,
	);

// How much of the context the request after this message carried: what was sent, cached or not
const contextOf = usage =>
	usage
		? (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
		: null;

// More of the transcript's lines folded into the turns read so far, which can go on being folded into as it grows
const foldLines = ({ turns, pending }, lines, cwd) => {
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
		// What the person sent while Claude worked, which it takes in mid-turn rather than as a turn of its own
		if (line.attachment?.type === 'queued_command' && line.attachment.origin?.kind === 'human') {
			// A string, or content blocks when it came with an image
			const added = promptText({ type: 'user', message: { content: line.attachment.prompt } });

			if (added) turn.added = [...(turn.added ?? []), added.slice(0, ASKED_CHARACTERS)];
			continue;
		}

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

			if (said) turn.said = startAndEnd(said, SAID_CHARACTERS);

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
};

// The transcript's lines as turns, newest last: [{ id, prompt, at, endedAt, steps, context, output, said }]
export const timelineFrom = (lines, cwd) => {
	const state = { turns: [], pending: new Map() };

	foldLines(state, lines, cwd);

	return state.turns;
};

// A whole transcript is read once, then only what it has grown by, a slice at a time: one can run to hundreds of
// megabytes, mostly screenshots, and a session's are read again every few seconds while it works
const WHOLE_SLICE_BYTES = 8 * 1024 * 1024;
const NEWLINE = 0x0a;
const decoder = new TextDecoder();
const wholes = new Map();

const parseLines = lines =>
	lines.flatMap(line => {
		if (!line) return [];

		try {
			return [JSON.parse(line)];
		} catch {
			return [];
		}
	});

const catchUp = async (read, file, cwd) => {
	// Up to the last whole line: the rest is still being written, or cut at the slice's end, perhaps mid-character
	for (let size = WHOLE_SLICE_BYTES; read.offset < file.size;) {
		const bytes = new Uint8Array(await file.slice(read.offset, read.offset + size).arrayBuffer());
		const through = bytes.lastIndexOf(NEWLINE) + 1;

		if (!through && read.offset + size >= file.size) return;
		// One line longer than the slice
		if (!through) size *= 2;
		else {
			size = WHOLE_SLICE_BYTES;
			read.offset += through;
			foldLines(read.state, parseLines(decoder.decode(bytes.subarray(0, through)).split('\n')), cwd);
		}
	}
};

const wholeTurns = async (id, file, cwd) => {
	let read = wholes.get(id);

	if (read?.name !== file.name || read.offset > file.size)
		wholes.set(id, (read = { name: file.name, offset: 0, state: { turns: [], pending: new Map() }, reading: null }));

	// One reader at a time: two would fold the same lines in twice
	const reading = (read.reading ?? Promise.resolve()).then(() => catchUp(read, file, cwd));

	read.reading = reading.catch(() => {});
	await reading;

	// The newest turn is still filled in as the transcript grows: what's handed out is a copy, left as it was
	const { turns } = read.state;
	const last = turns.at(-1);

	return last ? [...turns.slice(0, -1), { ...last, steps: last.steps.map(step => ({ ...step })) }] : [];
};

// The files a step changed: an edit tool's one, or those a command changed (commandEdits)
export const editedFiles = step => (step.edits ? (step.files ?? [step.file]).filter(Boolean) : []);

// The turns with each command that changed files marked as an edit, as an edit tool's step is; the transcript says
// what a command ran, not what it changed
export const withCommandEdits = (turns, sessionId) => {
	const edits = commandEditsOf(sessionId);

	if (!edits) return turns;

	return turns.map(turn =>
		turn.steps.some(step => edits[step.id])
			? {
					...turn,
					steps: turn.steps.map(step => {
						const files = edits[step.id]?.files;

						return files ? { ...step, edits: true, files, file: files[0] } : step;
					}),
				}
			: turn,
	);
};

// Every turn in the part of the transcript read, oldest first, read again only when it has grown; `whole` for every
// turn it holds, for looking back over a session once
export const sessionTurns = async (id, cwd, { whole = false } = {}) => {
	const file = await transcriptFile(id, cwd);

	if (!file) return [];

	if (whole) return withCommandEdits(await wholeTurns(id, file, cwd), id);

	const key = `${file.name}:${file.size}`;

	if (cache.get(id)?.key !== key) cache.set(id, { key, turns: timelineFrom(await lastLines(file), cwd) });

	return withCommandEdits(cache.get(id).turns, id);
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
