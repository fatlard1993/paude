const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@ ?(.*)$/;

// One file's unified diff as hunks of lines, each line numbered on the side it's on:
// { binary, hunks: [{ heading, oldStart, newStart, lines: [{ kind, text, old, new }] }] }
export const parseDiff = text => {
	const hunks = [];
	let hunk = null;
	let old = 0;
	let next = 0;
	let binary = false;

	for (const line of text.split('\n')) {
		const header = HUNK.exec(line);

		if (header) {
			old = Number(header[1]);
			next = Number(header[2]);
			hunk = { heading: header[3], oldStart: old, newStart: next, lines: [] };
			hunks.push(hunk);
		} else if (!hunk) binary ||= line.startsWith('Binary files ');
		else if (line.startsWith('+')) hunk.lines.push({ kind: 'added', text: line.slice(1), new: next++ });
		else if (line.startsWith('-')) hunk.lines.push({ kind: 'removed', text: line.slice(1), old: old++ });
		else if (line.startsWith(' ')) hunk.lines.push({ kind: 'context', text: line.slice(1), old: old++, new: next++ });
		else if (line.startsWith('\\')) hunk.lines.push({ kind: 'note', text: line.slice(1).trim() });
	}

	return { binary, hunks };
};

// A hunk's lines as side-by-side rows: context on both sides, a run of removed lines beside the added run that
// replaces it, a note across both. Each side keeps its line's index in the hunk, so picking lines means the same
// thing in either layout: [{ left: { line, index } | null, right: { line, index } | null, note }]
export const sideBySide = lines => {
	const rows = [];
	let removed = [];
	let added = [];

	const flush = () => {
		for (let index = 0; index < Math.max(removed.length, added.length); index++)
			rows.push({ left: removed[index] ?? null, right: added[index] ?? null });
		removed = [];
		added = [];
	};

	lines.forEach((line, index) => {
		if (line.kind === 'removed') {
			if (added.length) flush();
			removed.push({ line, index });
		} else if (line.kind === 'added') added.push({ line, index });
		else {
			flush();
			if (line.kind === 'note') rows.push({ left: null, right: null, note: { line, index } });
			else rows.push({ left: { line, index }, right: { line, index } });
		}
	});
	flush();

	return rows;
};

const MARK = { added: '+', removed: '-', context: ' ' };

// Lines of a diff back as diff text, the way an attachment quotes them
export const diffLines = lines =>
	lines
		.filter(({ kind }) => kind !== 'note')
		.map(({ kind, text }) => `${MARK[kind]}${text}`)
		.join('\n');
