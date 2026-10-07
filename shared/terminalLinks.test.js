import { expect, test } from 'bun:test';

import findUrls from './terminalLinks';

// As real Claude Code drew them at 80 columns
const SCREEN = [
	'● See https://github.com/fatlard1993/paude/blob/main/server/sessions/PtySession.',
	'  js?plain=1#L98-L120 and also the docs',
	'  (https://docs.anthropic.com/en/docs/claude-code/overview), plus',
	'  https://example.com/a/b.',
];

test('finds the URLs on a screen, joining one Claude broke across rows, without the sentence around them', () => {
	expect(findUrls(SCREEN, 80).map(({ url }) => url)).toEqual([
		'https://github.com/fatlard1993/paude/blob/main/server/sessions/PtySession.js?plain=1#L98-L120',
		'https://docs.anthropic.com/en/docs/claude-code/overview',
		'https://example.com/a/b',
	]);
});

test('knows which cells each part of a URL covers', () => {
	const [split] = findUrls(SCREEN, 80);

	expect(split.parts).toEqual([
		{ row: 0, from: 6, to: 80 },
		{ row: 1, from: 2, to: 21 },
	]);
});

test('a URL that ends short of the edge is not joined to the next row', () => {
	expect(findUrls(['see https://example.com/page', '  and more'], 80).map(({ url }) => url)).toEqual([
		'https://example.com/page',
	]);
});

test('keeps brackets a URL opened, and drops the ones around it', () => {
	expect(findUrls(['https://en.wikipedia.org/wiki/Bun_(software) and (https://bun.sh)'], 80).map(({ url }) => url)).toEqual([
		'https://en.wikipedia.org/wiki/Bun_(software)',
		'https://bun.sh',
	]);
});

test('a URL inside another one, or in the rest of a broken one, is not a second link', () => {
	const rows = ['open https://example.com/login?next=https://example.com/home'];

	expect(findUrls(rows, 80).map(({ url }) => url)).toEqual(['https://example.com/login?next=https://example.com/home']);
});
