import { expect, test } from 'bun:test';

import { combinedHistory, foldersOf, languageOf } from './character';

test("a project's language is what most of its code is in, its markup, prose and data counting only alone", () => {
	expect(languageOf(['a.rs', 'b.rs', 'README.md', 'c.md', 'd.md', 'Cargo.toml'])).toBe('rust');
	expect(languageOf(['index.html', 'style.css', 'site.css', 'notes.md'])).toBe('web');
	expect(languageOf(['Makefile', 'LICENSE'])).toBeNull();
	expect(languageOf(['App.TSX', 'main.js', 'tool.py'])).toBe('js');
});

test('a project is built from its top-level folders, biggest first, the rest of what is at the top as one more part', () => {
	const files = [
		'client/a.js',
		'client/b.js',
		'client/c.css',
		'server/a.js',
		'server/b.js',
		'docs/a.md',
		'.github/workflows/test.yml',
		'README.md',
		'package.json',
	];

	expect(foldersOf(files)).toEqual([
		{ name: 'client', files: 3, language: 'js' },
		{ name: 'server', files: 2, language: 'js' },
		{ name: 'docs', files: 1, language: 'docs' },
		{ name: '', files: 3, language: 'data' },
	]);
	expect(foldersOf(files, 1)).toEqual([
		{ name: 'client', files: 3, language: 'js' },
		{ name: '', files: 6, language: 'js' },
	]);
	expect(foldersOf([])).toEqual([]);
});

test("a folder of repositories has one history: since the first began, all their commits, the latest of any, the week's and day's added up", () => {
	expect(
		combinedHistory([
			{ since: 300, commits: 10, last: 900, week: 2, day: 1 },
			null,
			{ since: 100, commits: 5, last: 700, week: 3, day: 0 },
		]),
	).toEqual({ since: 100, commits: 15, last: 900, week: 5, day: 1 });
	expect(combinedHistory([null, null])).toBeNull();
});
