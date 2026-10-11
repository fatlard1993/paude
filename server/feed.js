import { promptText } from './sessions/history';
import { transcriptFile } from './sessions/transcript';
import { describeTool } from './timeline';

// What a session says and does, from a point on, for a client following it without a screen: a chat bridge, a bot,
// a script. The cursor is a byte offset into the transcript, which Claude Code only ever appends to, so a client that
// keeps it picks up exactly where it left off, through restarts on either side.
const MAX_BYTES = 4 * 1024 * 1024;

// Each line in order as entries: a prompt someone sent, something Claude wrote, or a tool Claude used. A subagent's
// own work stays out; its call shows as the tool it is.
export const feedFrom = (lines, cwd) =>
	lines.flatMap(line => {
		if (line.isSidechain) return [];

		const at = line.timestamp ?? null;

		if (line.type === 'user') {
			const prompt = promptText(line);

			return prompt === null ? [] : [{ kind: 'prompt', at, text: prompt }];
		}

		if (line.type !== 'assistant') return [];

		return (line.message?.content ?? []).flatMap(block => {
			if (block.type === 'text' && block.text?.trim()) return [{ kind: 'text', at, text: block.text.trim() }];
			if (block.type === 'tool_use')
				return [{ kind: 'tool', at, name: block.name, ...describeTool(block.name, block.input, cwd) }];

			return [];
		});
	});

const lineEnd = async (file, from) => {
	for (let at = from; at < file.size; at += MAX_BYTES) {
		const newline = new Uint8Array(await file.slice(at, at + MAX_BYTES).arrayBuffer()).indexOf(10);

		if (newline !== -1) return at + newline + 1;
	}

	return from;
};

// Only whole lines are read: one still being written waits for the next call. A long backlog comes in pieces, with
// `more` set until the cursor reaches the end.
export const sessionFeed = async (id, cwd, after) => {
	const file = await transcriptFile(id, cwd);
	const size = file?.size ?? 0;

	// No cursor: from now on
	if (after === undefined || after === null || after === '') return { entries: [], cursor: String(size), more: false };

	const start = Math.min(Math.max(Number.parseInt(after, 10) || 0, 0), size);

	if (!file || start === size) return { entries: [], cursor: String(start), more: false };

	const bytes = new Uint8Array(await file.slice(start, Math.min(size, start + MAX_BYTES)).arrayBuffer());
	const end = bytes.lastIndexOf(10) + 1;

	// One line bigger than a whole read (a tool's enormous output) is passed over, or the cursor could never move
	if (end === 0 && bytes.length === MAX_BYTES)
		return { entries: [], cursor: String(await lineEnd(file, start)), more: true };

	const lines = new TextDecoder()
		.decode(bytes.subarray(0, end))
		.split('\n')
		.flatMap(line => {
			if (!line) return [];

			try {
				return [JSON.parse(line)];
			} catch {
				return [];
			}
		});

	return { entries: feedFrom(lines, cwd), cursor: String(start + end), more: start + end < size };
};
