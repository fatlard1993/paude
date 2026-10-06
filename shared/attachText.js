// What attaching puts in Claude's prompt: an @-mention Claude Code reads itself, or text quoted with where it came from
export const attachFileText = path => `@${path} `;

const quoted = text => `\`\`\`\n${text.replace(/\s+$/, '')}\n\`\`\`\n`;

export const attachLinesText = (path, from, to, text) => {
	const range = from === to ? `line ${from}` : `lines ${from}-${to}`;

	return `${path} ${range}:\n${quoted(text)}`;
};

export const attachOutputText = text => `From my terminal:\n${quoted(text)}`;
