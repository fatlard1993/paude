// A row that starts something of its own, never the rest of the row before it: one of Claude's markers, a prompt
// box's border, a list item, a quote
const OWN_ROW = /^\s*(?:[⏺⎿│╭╰>•*-]|\d+[.)])(?:\s|$)/;

// Claude Code lays its text out itself, a row for each line it wraps, so what xterm copies of a paragraph has a line
// break and an indent where each row ended: xterm undoes only its own wrapping. A row is joined to the one before when
// that one ended because this one's first word wouldn't fit beside it in `cols` columns, its indent taken off; then
// the indent Claude's marker gives the lines under it comes off them too, so the text reads as it was written
export const unwrapped = (text, cols) => {
	const lines = [];
	let row = '';

	for (const next of text.split('\n').map(each => each.replace(/\s+$/, ''))) {
		const word = /^\s*(\S+)/.exec(next)?.[1];
		const joins = lines.length && row && word && !OWN_ROW.test(next) && row.length + 1 + word.length > cols - 2;

		if (joins) lines[lines.length - 1] += ` ${next.trimStart()}`;
		else lines.push(next);
		row = next;
	}

	const marker = /^(⏺ |\s*⎿\s+)/.exec(lines.find(line => line.trim()) ?? '')?.[1];

	if (!marker) return lines.join('\n');

	const indent = ' '.repeat(marker.length);

	return lines.map((line, index) => (index && line.startsWith(indent) ? line.slice(indent.length) : line)).join('\n');
};
