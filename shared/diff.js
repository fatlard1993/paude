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

const MARK = { added: '+', removed: '-', context: ' ' };

// Lines of a diff back as diff text, the way an attachment quotes them
export const diffLines = lines =>
	lines
		.filter(({ kind }) => kind !== 'note')
		.map(({ kind, text }) => `${MARK[kind]}${text}`)
		.join('\n');
