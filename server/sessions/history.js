import { getSessionMessages } from '@anthropic-ai/claude-agent-sdk';

const PROMPT_PREVIEW = 160;

// What a person typed, as opposed to tool results (also user messages) and the markup Claude Code records for
// slash commands and their output
const promptText = message => {
	if (message.type !== 'user') return null;

	const { content } = message.message ?? {};
	const text =
		typeof content === 'string'
			? content
			: (content ?? [])
					.filter(block => block.type === 'text')
					.map(block => block.text)
					.join('\n');

	return text.trim() && !text.trimStart().startsWith('<') ? text.trim() : null;
};

// Each completed prompt with the last message of its turn, where a fork taken after that turn ends
export const turnsFrom = messages => {
	const turns = [];
	let current = null;

	for (const message of messages) {
		const prompt = promptText(message);

		if (prompt !== null) {
			current = { prompt: prompt.slice(0, PROMPT_PREVIEW), endUuid: null };
			turns.push(current);
		} else if (current && message.type === 'assistant') current.endUuid = message.uuid;
		else if (current && current.endUuid) current.endUuid = message.uuid;
	}

	return turns.filter(turn => turn.endUuid);
};

export const sessionTurns = async (id, cwd) => turnsFrom(await getSessionMessages(id, { dir: cwd }));
