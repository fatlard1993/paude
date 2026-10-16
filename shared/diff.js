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

const span = numbers => ({ from: Math.min(...numbers), to: Math.max(...numbers) });

// Where picked diff lines are, for a comment: the lines as they are after the change, or, when the pick changes only
// removed lines, as they were before it. A pick of removed lines and added ones (a change and what replaced it)
// keeps the removed ones too, as `old`: from the first line it has before the change to the last removed, leading
// when the pick starts there. Null for a pick of notes alone.
export const diffAnchor = (path, lines) => {
	const picked = lines.filter(line => line.kind !== 'note');
	const after = picked.filter(line => line.new !== undefined).map(line => line.new);
	const before = picked.filter(line => line.old !== undefined).map(line => line.old);
	const lastRemoved = picked.findLastIndex(line => line.kind === 'removed');

	if (!picked.length) return null;
	if (!picked.some(line => line.kind === 'added') && lastRemoved !== -1) return { path, ...span(before), side: 'old' };
	if (lastRemoved === -1) return { path, ...span(after), side: 'new' };

	const leads = picked[0].old !== undefined;
	const old = picked
		.slice(leads ? 0 : picked.findIndex(line => line.kind === 'removed'), lastRemoved + 1)
		.filter(line => line.old !== undefined)
		.map(line => line.old);

	return { path, ...span(after), side: 'new', old: { ...span(old), ...(leads && { leads }) } };
};

const ZERO_CONTEXT_HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/gm;

// Lines carried through a change, from a zero-context diff of it (git diff -U0): moved by what was added or removed
// above them, or null when the change touched them, or put something between them
export const remapLines = (diff, { from, to }) => {
	let offset = 0;

	for (const [, oldStart, oldCount = '1', , newCount = '1'] of diff.matchAll(ZERO_CONTEXT_HUNK)) {
		const start = Number(oldStart);
		const removed = Number(oldCount);
		// An insertion sits after its old line; a change covers the lines it replaces
		const [first, last] = removed ? [start, start + removed - 1] : [start + 0.5, start + 0.5];

		if (first > to) break;
		if (last >= from) return null;
		offset += Number(newCount) - removed;
	}

	return { from: from + offset, to: to + offset };
};
