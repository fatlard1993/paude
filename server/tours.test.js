import { expect, test } from 'bun:test';

import { codeLeftOut, codePrompt, diffLeftOut, diffPrompt, fittingFiles, parseStops, tellOnce } from './tours';

const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

test('a code tour shows its lines numbered, and names a function or class to stay within', () => {
	const prompt = codePrompt({ path: 'a.js', lines: ['const a = 1;', 'run(a);'], from: 10 });

	expect(prompt).toContain('a.js, lines 10-11');
	expect(prompt).toContain('10 | const a = 1;\n11 | run(a);');
	expect(codePrompt({ path: 'a.js', lines: ['x'], from: 1, focus: { name: 'run', line: 4 } })).toContain(
		'run in a.js, which starts at line 4',
	);
});

test('a diff tour numbers each line on its side', () => {
	const prompt = diffPrompt('a commit', [
		{ path: 'a.js', status: 'modified', diff: '@@ -1,2 +1,2 @@\n keep\n-old\n+new' },
	]);

	expect(prompt).toContain('File a.js (modified)\n  1 | keep\n- 2 | old\n+ 2 | new');
});

test('stops stay on lines that are there, turned the right way round; the rest are dropped and counted', () => {
	const valid = new Set(range(1, 20));
	const reply = JSON.stringify({
		overview: 'It loads things.',
		stops: [
			{ from: 3, to: 8, text: 'reads' },
			{ from: 12, to: 10, text: 'backwards' },
			{ from: 18, to: 40, text: 'past the end' },
			{ from: 2, to: 2, text: '' },
		],
	});

	expect(parseStops(`Here: ${reply}`, { valid: () => valid, path: 'a.js' })).toEqual({
		overview: 'It loads things.',
		stops: [
			{ path: 'a.js', side: 'new', from: 3, to: 8, text: 'reads' },
			{ path: 'a.js', side: 'new', from: 10, to: 12, text: 'backwards' },
		],
		dropped: 2,
	});
	expect(parseStops('no idea', { valid: () => valid })).toBeNull();
});

test('a code tour says what it leaves out: lines it read no further than, stops that missed, stretches with no stop', () => {
	const stops = [
		{ from: 1, to: 10 },
		{ from: 31, to: 40 },
	];

	expect(codeLeftOut({ shown: range(1, 40), total: 40, stops, dropped: 0 })).toEqual(['No stop is on lines 11-30.']);
	expect(codeLeftOut({ shown: range(1, 40), total: 90, stops: [{ from: 1, to: 40 }], dropped: 1 })).toEqual([
		'It read only lines 1-40 of 90.',
		"1 stop pointing at lines that aren't there was left out.",
	]);
	// A function's tour reads its whole file, so the rest of the file isn't missing from it
	expect(codeLeftOut({ shown: range(1, 40), total: 40, stops, dropped: 0, focus: { name: 'f', line: 1 } })).toEqual([]);
});

test('a diff tour names the changes no stop is on', () => {
	const files = [
		{ path: 'a.js', diff: '@@ -1,2 +1,2 @@\n keep\n-old\n+new\n@@ -20,1 +20,2 @@\n same\n+added' },
		{ path: 'b.js', diff: '@@ -5,1 +5,0 @@\n-gone' },
	];

	expect(
		diffLeftOut({ files, skipped: 0, stops: [{ path: 'a.js', side: 'new', from: 2, to: 2 }], dropped: 0 }),
	).toEqual(['No stop is on the change at a.js line 21, b.js line 5.']);
	expect(
		diffLeftOut({
			files,
			skipped: 2,
			stops: [
				{ path: 'a.js', side: 'old', from: 2, to: 2 },
				{ path: 'a.js', side: 'new', from: 21, to: 21 },
				{ path: 'b.js', side: 'old', from: 5, to: 5 },
			],
			dropped: 0,
		}),
	).toEqual(['2 files too big to read are left out.']);
});

test('a file too big for the tour is passed over, and the files after it still go in', () => {
	const file = (path, size) => ({ path, status: 'modified', diff: 'x'.repeat(size) });
	// In reading order, the big one comes first
	const files = [file('src/big.js', 60), file('src/a.js', 20), file('src/b.js', 20)];

	expect(
		fittingFiles({ files }, 50)
			.map(each => each.path)
			.sort(),
	).toEqual(['src/a.js', 'src/b.js']);
});

test('a tour is told once, asked again after it fails or finds nothing, and only the latest are kept', async () => {
	let asked = 0;
	const ask = async prompt => {
		asked += 1;
		if (prompt === 'fails') throw new Error('out of usage');

		return prompt === 'empty' ? '' : `reply ${prompt}`;
	};
	const parse = reply => reply || null;

	expect(await tellOnce('one', parse, ask)).toBe('reply one');
	expect(await tellOnce('one', parse, ask)).toBe('reply one');
	expect(asked).toBe(1);

	await expect(tellOnce('fails', parse, ask)).rejects.toThrow('out of usage');
	await expect(tellOnce('fails', parse, ask)).rejects.toThrow('out of usage');
	expect(asked).toBe(3);

	expect(await tellOnce('empty', parse, ask)).toBeNull();
	await Bun.sleep(0);
	expect(await tellOnce('empty', parse, ask)).toBeNull();
	expect(asked).toBe(5);

	for (let index = 0; index < 60; index++) await tellOnce(`many ${index}`, parse, ask);
	asked = 0;
	await tellOnce('many 59', parse, ask);
	await tellOnce('many 0', parse, ask);
	expect(asked).toBe(1);
});
