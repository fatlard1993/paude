import { expect, test } from 'bun:test';

import { parseDiff } from './diff';
import { byFunction, fileRenames, hunksText, renameSweeps, renamesIn } from './reviewGroups';
import { describeFiles, fileLabel, folds, orderFiles } from './reviewOrder';

test('a changed line is a rename when the only differences are words, each swapped everywhere in it', () => {
	expect(renamesIn('const total = sum(items);', 'const total = add(items);')).toEqual({ sum: 'add' });
	expect(renamesIn('getUser(user.id, user)', 'getMember(member.id, member)')).toEqual({
		getUser: 'getMember',
		user: 'member',
	});
	expect(renamesIn('foo(foo)', 'bar(foo)')).toBeNull();
	expect(renamesIn('x = 1', 'x = 2')).toBeNull();
	expect(renamesIn('a(b)', 'a(b, c)')).toBeNull();
	expect(renamesIn('same', 'same')).toBeNull();
});

const renaming = (count, from = 'sum', to = 'add') =>
	`@@ -1,${count} +1,${count} @@\n${Array.from({ length: count }, (_, n) => `-x${n} = ${from}(${n});`).join('\n')}\n${Array.from({ length: count }, (_, n) => `+x${n} = ${to}(${n});`).join('\n')}`;

test("a file's renames, and whether they're all it changes", () => {
	expect(fileRenames(renaming(2))).toEqual({ renames: { sum: 'add' }, only: true, lines: 2 });
	expect(fileRenames(`${renaming(1)}\n@@ -9 +9,2 @@\n keep\n+more()`)).toMatchObject({ only: false, lines: 1 });
	expect(fileRenames('@@ -1 +1 @@\n-x = 1\n+x = 2')).toBeNull();
});

test('a rename swept across files is told once, its files read together and folded', () => {
	const files = [
		{ path: 'src/a.js', status: 'modified', diff: renaming(1) },
		{ path: 'src/core.js', status: 'modified', diff: '@@ -1 +1 @@\n-x = 1\n+x = 2' },
		{ path: 'src/b.js', status: 'modified', diff: renaming(1) },
		{ path: 'src/c.js', status: 'modified', diff: renaming(3, 'old', 'young') },
		{ path: 'src/d.js', status: 'modified', diff: '@@ -1 +1 @@\n-y = old(1);\n+y = young(1);' },
	];

	expect(renameSweeps(files)).toEqual([
		{ renames: { sum: 'add' }, paths: ['src/a.js', 'src/b.js'] },
		{ renames: { old: 'young' }, paths: ['src/c.js', 'src/d.js'] },
	]);

	const about = describeFiles(files);

	expect(fileLabel(about.get('src/a.js'))).toBe('renames sum → add');
	expect(folds(about.get('src/a.js'))).toBe(true);
	expect(folds(about.get('src/core.js'))).toBe(false);

	const ordered = orderFiles(files);

	expect(ordered.map(file => [file.path, file.group ?? ''])).toEqual([
		['src/core.js', ''],
		['src/c.js', 'Renamed old → young in 2 files'],
		['src/d.js', 'Renamed old → young in 2 files'],
		['src/a.js', 'Renamed sum → add in 2 files'],
		['src/b.js', 'Renamed sum → add in 2 files'],
	]);
});

test('one word swapped on one line of one file is an edit, not a rename', () => {
	const about = describeFiles([{ path: 'a.js', status: 'modified', diff: renaming(1) }]);

	expect(about.get('a.js').renamesOnly).toBeUndefined();
});

test('hunks rebuilt as text keep their line numbers', () => {
	const diff = '@@ -10,3 +12,4 @@ function go()\n keep\n-old\n+new\n+more\n same';
	const [hunk] = parseDiff(diff).hunks;

	expect(parseDiff(hunksText([hunk])).hunks[0]).toEqual(hunk);
});

test("function by function: a changed signature first, then where it's used, then what's in no function", () => {
	const lib = {
		path: 'lib.js',
		status: 'modified',
		diff: [
			'@@ -1,3 +1,3 @@',
			'-export const add = (a, b) => a + b;',
			'+export const add = (a, b, c = 0) => a + b + c;',
			' ',
			' export const half = n => n / 2;',
			'@@ -10,2 +10,2 @@',
			' export const twice = n => {',
			'-\treturn n * 2;',
			'+\treturn n + n;',
		].join('\n'),
	};
	const app = {
		path: 'app.js',
		status: 'modified',
		diff: [
			'@@ -1,2 +1,3 @@',
			" import { add } from './lib';",
			'-run(add(1, 2));',
			'+run(add(1, 2, 3));',
			'+log();',
			'@@ -20,1 +21,1 @@',
			'-start();',
			'+begin();',
		].join('\n'),
	};
	const outlines = {
		'lib.js': [
			{ name: 'add', kind: 'function', line: 1 },
			{ name: 'half', kind: 'function', line: 3 },
			{ name: 'twice', kind: 'function', line: 10 },
		],
		'app.js': [],
	};
	const entries = byFunction([app, lib], outlines, { 'app.js': ['lib.js'] });

	expect(entries.map(entry => [entry.path, entry.group, entry.part])).toEqual([
		['lib.js', 'add in lib.js: its signature changed', 'signature changed'],
		['app.js', 'add in lib.js: its signature changed', 'uses add'],
		['lib.js', 'twice in lib.js', 'changed'],
		['app.js', 'Outside any function', ''],
	]);
	expect(parseDiff(entries[2].diff).hunks[0].newStart).toBe(10);
	expect(parseDiff(entries[3].diff).hunks.map(hunk => hunk.newStart)).toEqual([21]);
	expect(parseDiff(entries[1].diff).hunks.map(hunk => hunk.newStart)).toEqual([1]);
	expect(byFunction([app], { 'app.js': [] })).toBeNull();
	expect(
		orderFiles([app, lib], 'function', { outlines, imports: { 'app.js': ['lib.js'] } }).map(entry => entry.part),
	).toEqual(['signature changed', 'uses add', 'changed', '']);
});

test('a new function is new, not a changed signature; a use in another file needs that file to import it', () => {
	const lib = {
		path: 'lib.js',
		status: 'modified',
		diff: [
			'@@ -1,1 +1,3 @@',
			' export const a = 1;',
			'+export const fresh = () => 2;',
			'+export const b = fresh();',
		].join('\n'),
	};
	const other = { path: 'other.js', status: 'modified', diff: '@@ -1 +1 @@\n-x = 1;\n+const fresh = 3;' };
	const outlines = {
		'lib.js': [
			{ name: 'a', kind: 'value', line: 1 },
			{ name: 'fresh', kind: 'function', line: 2 },
			{ name: 'b', kind: 'value', line: 3 },
		],
		'other.js': [],
	};

	expect(byFunction([lib, other], outlines, {}).map(entry => [entry.path, entry.group, entry.part])).toEqual([
		['lib.js', 'fresh in lib.js: new', 'new'],
		['other.js', 'Outside any function', ''],
	]);
});
