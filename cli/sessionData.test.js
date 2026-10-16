import { expect, test } from 'bun:test';

import { commentMarks } from './sessionData';
import { openFile } from './fileBrowser';

const later = () => {
	let resolve;
	const promise = new Promise(done => {
		resolve = done;
	});

	return { promise, resolve };
};

test("an older answer for a file's comment marks arriving after a newer one is dropped", async () => {
	const answers = [later(), later()];
	let asked = 0;
	const data = { git: () => answers[asked++].promise };
	const marks = commentMarks(data, { openOn: () => [{}] });
	const opened = openFile('a.js', 'one\n');

	const first = marks.load(opened);
	const second = marks.load(opened);

	answers[1].resolve({ c1: { from: 1, to: 1 } });
	await second;
	answers[0].resolve({ c1: null });
	await first;

	expect(opened.comments).toEqual({ c1: { from: 1, to: 1 } });
});

test('several notes at once reload the marks once', async () => {
	let asked = 0;
	const data = {
		git: async () => {
			asked += 1;

			return {};
		},
	};
	const marks = commentMarks(data, { openOn: () => [{}], wait: 5 });
	const opened = openFile('a.js', 'one\n');
	const done = later();

	marks.soon(opened, () => {});
	marks.soon(opened, () => {});
	marks.soon(opened, done.resolve);
	await done.promise;

	expect(asked).toBe(1);
});

const SET = {
	title: 'a turn',
	files: [
		{
			path: 'a.js',
			status: 'modified',
			blobs: { old: 'a'.repeat(40), new: 'b'.repeat(40) },
			diff: '@@ -1 +1 @@\n-one\n+two',
		},
	],
};

test('a resolved comment is asked for by its id, and found where it is now', async () => {
	const queries = [];
	const data = {
		git: async (what, query) => {
			queries.push(query);

			return query.comment ? { c1: { new: { from: 1, to: 1 }, old: null } } : {};
		},
	};
	const marks = commentMarks(data, { openOn: () => [], diffSet: async () => ({ set: SET }) });
	const comment = {
		id: 'c1',
		resolved: true,
		anchor: { path: 'a.js', from: 3, to: 3, side: 'new', diff: { source: 'turn', turn: 't1' } },
	};
	const found = await marks.locate(comment);

	expect(queries.at(-1).comment).toBe('c1');
	expect(found.diff.focus).toEqual({ path: 'a.js', new: { from: 1, to: 1 } });
	expect(found.hint).toBeUndefined();
});

test("a resolved comment the server won't place is shown on its saved lines, saying they may have moved", async () => {
	const data = { git: async () => ({}) };
	const marks = commentMarks(data, { openOn: () => [], diffSet: async () => ({ set: SET }) });
	const inDiff = await marks.locate({
		id: 'c1',
		resolved: true,
		anchor: { path: 'a.js', from: 1, to: 1, side: 'new', diff: { source: 'turn', turn: 't1' } },
	});

	expect(inDiff.diff.focus).toEqual({ path: 'a.js', new: { from: 1, to: 1 } });
	expect(inDiff.hint).toContain('resolved');

	const inFile = await marks.locate({
		id: 'c1',
		resolved: true,
		anchor: { path: 'a.js', from: 4, to: 5, side: 'new' },
	});

	expect(inFile).toEqual({ from: 4, to: 5, hint: expect.stringContaining('resolved') });
});
