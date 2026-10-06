import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

const PROMPT_PREVIEW = 160;

// The markup Claude Code records for slash commands and their output, which isn't a prompt; a prompt someone wrote
// can start with < too (pasted HTML)
const MARKUP = /^<(command-|local-command-|bash-|system-reminder|task-notification|user-memory-input)/;
const INTERRUPTED = /^\[Request interrupted/;

// What a person typed, as opposed to tool results (also user messages) and Claude Code's own markup
export const promptText = message => {
	if (message.type !== 'user') return null;

	const { content } = message.message ?? {};
	const text =
		typeof content === 'string'
			? content
			: (content ?? [])
					.filter(block => block.type === 'text')
					.map(block => block.text)
					.join('\n');

	return text.trim() && !MARKUP.test(text.trimStart()) ? text.trim() : null;
};

// Each prompt with the last message of its turn, where a fork taken after that turn ends. A turn that was
// interrupted printed no "done" line, so it's left out, as is one with no reply yet. `last` marks the newest prompt's
// turn, which may still be running.
export const turnsFrom = messages => {
	const turns = [];
	let current = null;

	for (const message of messages) {
		const prompt = promptText(message);

		if (prompt !== null && INTERRUPTED.test(prompt)) {
			if (current) current.interrupted = true;
		} else if (prompt !== null) {
			current = { prompt: prompt.slice(0, PROMPT_PREVIEW), endUuid: null };
			turns.push(current);
		} else if (current && message.type === 'assistant') current.endUuid = message.uuid;
		else if (current?.endUuid) current.endUuid = message.uuid;
	}

	return turns
		.filter(turn => turn.endUuid && !turn.interrupted)
		.map(turn => ({ prompt: turn.prompt, endUuid: turn.endUuid, ...(turn === current && { last: true }) }));
};

export const sessionTurns = async (id, cwd) => turnsFrom(await getSessionMessages(id, { dir: cwd }));
