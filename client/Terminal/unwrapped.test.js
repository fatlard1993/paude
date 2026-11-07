import { expect, test } from 'bun:test';

import { unwrapped } from './unwrapped';

test("a copy of Claude's screen joins the rows it wrapped a line over, each where its next word wouldn't have fit, and takes the indent its marker gives off the lines under it", () => {
	const screen = [
		'⏺ The quick brown fox jumps over the   ',
		'  lazy dog and keeps on running far    ',
		'  away.',
		'',
		'  A second paragraph, short.',
		'  - a list item that is long enough to',
		'    wrap onto a second row here',
		'  - another',
	].join('\n');

	expect(unwrapped(screen, 40)).toBe(
		[
			'⏺ The quick brown fox jumps over the lazy dog and keeps on running far away.',
			'',
			'A second paragraph, short.',
			'- a list item that is long enough to wrap onto a second row here',
			'- another',
		].join('\n'),
	);
});

test("a tool result's rows join the same way under its own marker, and a row that fits is a line of its own", () => {
	const screen = [
		'  ⎿  Found 3 files matching the pattern in',
		'     the folder',
		'     src/a.js',
		'     src/b.js',
	].join('\n');

	expect(unwrapped(screen, 44)).toBe(
		['  ⎿  Found 3 files matching the pattern in the folder', 'src/a.js', 'src/b.js'].join('\n'),
	);
});

test('rows that start something of their own stay rows, however full the one before: markers, borders, lists, quotes', () => {
	const full = `${'word '.repeat(7)}end`;
	const screen = [`⏺ ${full}`, '⏺ next', `  ${full}`, '  - item', `│ ${full}`, '│ box', '  > quoted', '  1. first'];

	expect(full).toHaveLength(38);
	expect(unwrapped(screen.join('\n'), 40)).toBe(
		[`⏺ ${full}`, '⏺ next', full, '- item', `│ ${full}`, '│ box', '> quoted', '1. first'].join('\n'),
	);
});

test('without a marker the lines are left where they are, less the spaces at their ends', () => {
	expect(unwrapped('one   \ntwo\n\nthree', 80)).toBe('one\ntwo\n\nthree');
});
