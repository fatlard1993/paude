import { readGrown, transcriptFile } from './sessions/transcript';

// What a session has running in the background that Claude will be woken by: a command run in the background or an
// agent sent off asynchronously, from its launch until Claude Code queues its task notification. No hook marks either
// end (the launching tool returns at once), so the transcript is read for them, as it grows.
// { [session id]: { name, offset, out: Map(task id → { what, at, kind }), launching: Map(tool use id → what) } }
const reads = new Map();
// The last seen for each running session, for what has to answer at once (a session's summary)
const known = new Map();

const TASK_ID = /<task-id>([^<]+)<\/task-id>/g;
const PREVIEW = 200;

const textOf = content =>
	typeof content === 'string'
		? content
		: (Array.isArray(content) ? content : [])
				.map(block => (typeof block?.text === 'string' ? block.text : ''))
				.join('');

// A task notification as Claude Code queues it for the session, or delivers it as the person's turn: not a line that
// only quotes one, as a command's output can
const notified = line => {
	const text =
		(line.type === 'queue-operation' && line.operation === 'enqueue' && line.content) ||
		(line.type === 'user' && textOf(line.message?.content));

	return typeof text === 'string' && text.trimStart().startsWith('<task-notification>')
		? [...text.matchAll(TASK_ID)].map(match => match[1])
		: [];
};

const parse = raw => {
	try {
		return JSON.parse(raw);
	} catch {
		return null;
	}
};

export const foldBackground = (read, lines) => {
	for (const raw of lines) {
		if (raw.includes('task-notification')) {
			const line = parse(raw);

			for (const id of line ? notified(line) : []) read.out.delete(id);
		}
		// What it was launched to do, from the launching tool's input
		if (raw.includes('"run_in_background":true')) {
			const line = parse(raw);

			for (const block of line?.type === 'assistant' && Array.isArray(line.message?.content)
				? line.message.content
				: [])
				if (block.type === 'tool_use' && block.input?.run_in_background)
					read.launching.set(
						block.id,
						String(block.input.description || block.input.command || block.input.prompt || '').slice(0, PREVIEW),
					);
		}
		if (raw.includes('"backgroundTaskId"') || raw.includes('"async_launched"')) {
			const line = parse(raw);
			const result = line?.type === 'user' && line.toolUseResult;
			const agent = result?.status === 'async_launched' && result.agentId;
			const id = result?.backgroundTaskId || agent;

			if (!id) continue;

			const toolUseId = (Array.isArray(line.message?.content) ? line.message.content : []).find(
				block => block.type === 'tool_result',
			)?.tool_use_id;

			read.out.set(id, {
				what: read.launching.get(toolUseId) || String(result.description || '').slice(0, PREVIEW),
				at: Date.parse(line.timestamp) || 0,
				kind: agent ? 'agent' : 'command',
			});
			read.launching.delete(toolUseId);
		}
	}
};

// Its work out now: [{ what, at, kind }], oldest first. Only what was launched since its Claude started counts: one
// that went with an earlier Claude was never reported done.
export const backgroundOf = async (session, now = Date.now()) => {
	const file = await transcriptFile(session.id, session.cwd);

	if (!file) return [];

	let read = reads.get(session.id);

	if (!read || read.name !== file.name || file.size < read.offset) {
		read = { name: file.name, offset: 0, out: new Map(), launching: new Map() };
		reads.set(session.id, read);
	}
	await readGrown(file, read, lines => foldBackground(read, lines));

	const out = [...read.out.values()].filter(({ at }) => at >= session.startedAt && at <= now + 60_000);

	known.set(session.id, out);

	return out;
};

// As last read, for what can't wait for a read; [] for one not read yet
export const backgroundKnown = id => known.get(id) ?? [];

export const forgetBackground = id => {
	reads.delete(id);
	known.delete(id);
};
