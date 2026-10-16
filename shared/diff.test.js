import { expect, test } from 'bun:test';

import { attachDiffText } from './attachText';
import { diffAnchor, diffLines, parseDiff, remapLines, sideBySide } from './diff';

const DIFF = `diff --git a/src/math.js b/src/math.js
index 1111111..2222222 100644
--- a/src/math.js
+++ b/src/math.js
@@ -1,4 +1,5 @@ export const helpers
 export const add = (a, b) => a + b;
-export const sub = (a, b) => a - b;
+export const subtract = (a, b) => a - b;
+export const multiply = (a, b) => a * b;
 
---double dash
@@ -10,2 +11,2 @@
-old
+new
\\ No newline at end of file
`;

test('hunks number each line on the side it belongs to', () => {
	const { binary, hunks } = parseDiff(DIFF);

	expect(binary).toBe(false);
	expect(hunks.map(({ heading, oldStart, newStart }) => ({ heading, oldStart, newStart }))).toEqual([
		{ heading: 'export const helpers', oldStart: 1, newStart: 1 },
		{ heading: '', oldStart: 10, newStart: 11 },
	]);
	expect(hunks[0].lines).toEqual([
		{ kind: 'context', text: 'export const add = (a, b) => a + b;', old: 1, new: 1 },
		{ kind: 'removed', text: 'export const sub = (a, b) => a - b;', old: 2 },
		{ kind: 'added', text: 'export const subtract = (a, b) => a - b;', new: 2 },
		{ kind: 'added', text: 'export const multiply = (a, b) => a * b;', new: 3 },
		{ kind: 'context', text: '', old: 3, new: 4 },
		{ kind: 'removed', text: '--double dash', old: 4 },
	]);
	expect(hunks[1].lines.at(-1)).toEqual({ kind: 'note', text: 'No newline at end of file' });
});

test('binary files have no hunks, and attached lines come back as a diff', () => {
	expect(parseDiff('diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n')).toEqual({
		binary: true,
		hunks: [],
	});
	expect(attachDiffText('src/math.js', diffLines(parseDiff(DIFF).hunks[1].lines))).toBe(
		'src/math.js, changed:\n```diff\n-old\n+new\n```\n',
	);
});

test('side by side, a removed run sits beside the added run that replaced it', () => {
	const shape = rows =>
		rows.map(({ left, right, note }) =>
			note
				? `note:${note.index}`
				: `${left ? `${left.line.kind[0]}${left.index}` : '-'} ${right ? `${right.line.kind[0]}${right.index}` : '-'}`,
		);

	expect(shape(sideBySide(parseDiff(DIFF).hunks[0].lines))).toEqual(['c0 c0', 'r1 a2', '- a3', 'c4 c4', 'r5 -']);
	expect(shape(sideBySide(parseDiff(DIFF).hunks[1].lines))).toEqual(['r0 a1', 'note:2']);
});

test('a comment on picked diff lines is on the lines after the change, or before it for removals alone', () => {
	const { hunks } = parseDiff('@@ -1,3 +1,3 @@\n a\n-b\n+B\n c');
	const [context, removed, added] = hunks[0].lines;

	const [, , , after] = hunks[0].lines;

	expect(diffAnchor('x.js', [context])).toEqual({ path: 'x.js', from: 1, to: 1, side: 'new' });
	expect(diffAnchor('x.js', [context, removed])).toEqual({ path: 'x.js', from: 1, to: 2, side: 'old' });
	expect(diffAnchor('x.js', [removed])).toEqual({ path: 'x.js', from: 2, to: 2, side: 'old' });
	expect(diffAnchor('x.js', [added, after])).toEqual({ path: 'x.js', from: 2, to: 3, side: 'new' });
});

test('a pick of a change and what replaced it keeps both sides, the removed lines leading when it starts on them', () => {
	const { hunks } = parseDiff('@@ -1,4 +1,4 @@\n a\n-b\n+B\n c\n-d\n+D');
	const [context, removed, added, middle, removedLater] = hunks[0].lines;

	expect(diffAnchor('x.js', [removed, added])).toEqual({
		path: 'x.js',
		from: 2,
		to: 2,
		side: 'new',
		old: { from: 2, to: 2, leads: true },
	});
	expect(diffAnchor('x.js', [context, removed, added])).toEqual({
		path: 'x.js',
		from: 1,
		to: 2,
		side: 'new',
		old: { from: 1, to: 2, leads: true },
	});
	// Starting on an added line, the removed lines further down don't lead
	expect(diffAnchor('x.js', [added, middle, removedLater])).toEqual({
		path: 'x.js',
		from: 2,
		to: 3,
		side: 'new',
		old: { from: 4, to: 4 },
	});
	expect(diffAnchor('x.js', [])).toBeNull();
});

test('lines carried through a change move with what was added or removed above them, and are lost when touched', () => {
	// two lines inserted after 2, line 5 changed, lines 9-10 removed
	const diff = '@@ -2,0 +3,2 @@\n+a\n+b\n@@ -5 +7 @@\n-x\n+y\n@@ -9,2 +10,0 @@\n-p\n-q\n';

	expect(remapLines(diff, { from: 1, to: 2 })).toEqual({ from: 1, to: 2 });
	expect(remapLines(diff, { from: 3, to: 4 })).toEqual({ from: 5, to: 6 });
	expect(remapLines(diff, { from: 5, to: 5 })).toBeNull();
	expect(remapLines(diff, { from: 2, to: 3 })).toBeNull();
	expect(remapLines(diff, { from: 6, to: 8 })).toEqual({ from: 8, to: 10 });
	expect(remapLines(diff, { from: 9, to: 9 })).toBeNull();
	expect(remapLines(diff, { from: 11, to: 12 })).toEqual({ from: 11, to: 12 });
	expect(remapLines('', { from: 4, to: 7 })).toEqual({ from: 4, to: 7 });
});
