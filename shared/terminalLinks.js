const URL_START = /https?:\/\//g;
const URL_CHARACTER = /[^\s<>"'`]/;
// Claude breaks a long URL at the last column or the one before, and starts the rest of it on the next line, indented;
// words wrap sooner, so a line that ends a column or more earlier ended its URL too
const EDGE = 1;
// A sentence's punctuation after a URL isn't part of it; a closing bracket is, when the URL opened one
const TRAILING = /[.,;:!?'"]$/;
const CLOSERS = { ')': '(', ']': '[', '}': '{' };

export const trimUrl = url => {
	let end = url.length;

	for (;;) {
		const last = url[end - 1];
		const body = url.slice(0, end - 1);

		if (TRAILING.test(last)) end -= 1;
		else if (CLOSERS[last] && body.split(CLOSERS[last]).length <= body.split(last).length) end -= 1;
		else return url.slice(0, end);
	}
};

const urlLength = (text, from) => {
	let end = from;

	while (end < text.length && URL_CHARACTER.test(text[end])) end += 1;

	return end - from;
};

// The URLs in some rows of a terminal, a URL Claude broke across rows joined back up. `rows` are the rows' text,
// `width` the terminal's columns. Each found: { url, parts: [{ row, from, to }] }, `to` exclusive, string indexes.
const findUrls = (rows, width) => {
	const found = [];

	for (let row = 0; row < rows.length; row++) {
		const text = rows[row];

		for (const start of text.matchAll(URL_START)) {
			const from = start.index;
			const length = urlLength(text, from);
			const parts = [{ row, from, to: from + length }];
			let url = text.slice(from, from + length);
			let at = parts[0];

			// Runs to the edge: carried on, after the indent, on the next row
			while (at.to === rows[at.row].trimEnd().length && at.to >= width - EDGE && at.row + 1 < rows.length) {
				const next = rows[at.row + 1];
				const indent = next.length - next.trimStart().length;
				const more = urlLength(next, indent);

				if (!more || next.slice(indent).startsWith('http')) break;
				at = { row: at.row + 1, from: indent, to: indent + more };
				parts.push(at);
				url += next.slice(indent, indent + more);
			}

			// Inside one already found (a URL in another's query, or the rest of a broken one): part of that one
			if (found.some(({ parts: had }) => had.some(part => part.row === row && from >= part.from && from < part.to)))
				continue;

			const trimmed = trimUrl(url);
			const cut = url.length - trimmed.length;

			if (cut) parts.at(-1).to -= cut;
			if (parts.at(-1).to <= parts.at(-1).from) parts.pop();
			if (trimmed.length > 'https://'.length) found.push({ url: trimmed, parts });
		}
	}

	return found;
};

export default findUrls;
