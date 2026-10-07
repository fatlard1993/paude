import { expect, test } from 'bun:test';

import findFilePaths, { pathResolver } from './filePaths';

const resolve = pathResolver([
	'README.md',
	'server/remotes.js',
	'server/router/sessions.js',
	'client/Terminal/TerminalView.js',
	'client/index.js',
	'server/index.js',
]);

const paths = text => findFilePaths(text, resolve).map(({ path, line, lastLine }) => [path, line, lastLine]);

test('finds the files Claude names, with the lines it points at', () => {
	expect(paths('● Update(server/remotes.js)')).toEqual([['server/remotes.js', null, null]]);
	expect(paths('See client/Terminal/TerminalView.js:295 and server/remotes.js:12-40.')).toEqual([
		['client/Terminal/TerminalView.js', 295, 295],
		['server/remotes.js', 12, 40],
	]);
	expect(paths('in `./server/router/sessions.js:88:5`, then README.md#L3-L9')).toEqual([
		['server/router/sessions.js', 88, 88],
		['README.md', 3, 9],
	]);
});

test('an absolute path or one from ~ is found by the project path it ends with', () => {
	expect(paths('/home/chase/Projects/paude/server/remotes.js:7 ~/Projects/paude/README.md')).toEqual([
		['server/remotes.js', 7, 7],
		['README.md', null, null],
	]);
	expect(paths('/usr/lib/node/elsewhere.js')).toEqual([]);
});

test('a bare name is a file only when no other file shares it', () => {
	expect(paths('TerminalView.js:10 and index.js')).toEqual([['client/Terminal/TerminalView.js', 10, 10]]);
});

test('words, URLs and missing files are left alone', () => {
	expect(paths('remotes and https://example.com/server/remotes.js and lib/missing.js e.g.')).toEqual([]);
});

test('knows where in the row each path is', () => {
	const [found] = findFilePaths('  ⎿ (server/remotes.js:12).', resolve);

	expect(found).toMatchObject({ from: 5, to: 25 });
});
