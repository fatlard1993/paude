import { expect, test } from 'bun:test';

import { attachDiffText } from './attachText';
import { diffLines, parseDiff } from './diff';

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
