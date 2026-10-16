import { expect, test } from 'bun:test';

import { changeShape, fileKind, fileLabel, importsIn, orderFiles, resolveImport, testSubject } from './reviewOrder';

const file = (path, diff = '@@ -1 +1 @@\n-a = 1\n+a = 2', status = 'modified') => ({ path, diff, status });
const paths = files => files.map(each => each.path);

test('a file is generated, a test, docs, config or source, by its name', () => {
	expect(
		[
			'bun.lock',
			'web/dist/app.js',
			'src/__snapshots__/a.snap',
			'src/a.test.js',
			'tests/test_api.py',
			'pkg/a_test.go',
			'README.md',
			'docs/guide.txt',
			'package.json',
			'.github/workflows/ci.yml',
			'eslint.config.cjs',
			'Dockerfile',
			'src/a.js',
		].map(fileKind),
	).toEqual([
		'generated',
		'generated',
		'generated',
		'test',
		'test',
		'test',
		'docs',
		'docs',
		'config',
		'config',
		'config',
		'config',
		'source',
	]);
});

test("a test's subject: beside it, over its test folder, or the one file anywhere with its name", () => {
	const all = ['src/a.js', 'src/b.ts', 'lib/c.py', 'server/d.js', 'client/d.js'];

	expect(testSubject('src/a.test.js', all)).toBe('src/a.js');
	expect(testSubject('src/__tests__/b.spec.ts', all)).toBe('src/b.ts');
	expect(testSubject('tests/test_c.py', all)).toBe('lib/c.py');
	expect(testSubject('e2e/d.e2e.js', all)).toBeNull();
	expect(testSubject('server/d.test.js', all)).toBe('server/d.js');
});

test('imports are read from JavaScript and Python, and resolved among the changed files', () => {
	const text =
		"import a from './a';\nexport { b } from '../lib/b.js';\nconst c = require('./c');\nimport('./d');\nimport x from 'react';";

	expect(importsIn('src/main.js', text)).toEqual(['./a', '../lib/b.js', './c', './d', 'react']);
	expect(importsIn('pkg/m.py', 'from .util import x\nimport pkg.models\nfrom ..core import y')).toEqual([
		'.util',
		'pkg.models',
		'..core',
	]);

	const set = ['src/a.ts', 'lib/b.js', 'src/c/index.js', 'pkg/util.py', 'pkg/models.py', 'core/__init__.py'];

	expect(resolveImport('src/main.js', './a', set)).toBe('src/a.ts');
	expect(resolveImport('src/main.js', '../lib/b.js', set)).toBe('lib/b.js');
	expect(resolveImport('src/main.js', './c', set)).toBe('src/c/index.js');
	expect(resolveImport('src/main.js', 'react', set)).toBeNull();
	expect(resolveImport('pkg/m.py', '.util', set)).toBe('pkg/util.py');
	expect(resolveImport('pkg/m.py', 'pkg.models', set)).toBe('pkg/models.py');
	expect(resolveImport('pkg/m.py', '..core', set)).toBe('core/__init__.py');
});

test('a change to whitespace alone is told apart from one that changes something', () => {
	expect(changeShape('@@ -1,2 +1,2 @@\n-if (a){\n-  b()\n+if (a) {\n+    b()')).toEqual({
		changed: 4,
		whitespace: true,
	});
	expect(changeShape('@@ -1 +1 @@\n-a = 1\n+a = 2')).toEqual({ changed: 2, whitespace: false });
	expect(changeShape('@@ -1,3 +1,1 @@\n-call(\n-  a,\n-  b);\n+call(a, b);')).toEqual({ changed: 4, whitespace: true });
});

test("reading order: what's used before what uses it, tests after their subjects, then config, docs, moves and generated", () => {
	const files = [
		file('README.md'),
		file('bun.lock', '@@ -1 +1,3 @@\n-a\n+b\n+c\n+d'),
		file('package.json'),
		file('server/api.js'),
		file('server/api.test.js'),
		file('server/db.js'),
		file('server/db.test.js'),
		file('server/old.js', '', 'renamed'),
		file('server/style.js', '@@ -1 +1 @@\n-a  =  1\n+a = 1'),
		file('e2e/flow.e2e.js'),
	];
	const imports = { 'server/api.js': ['server/db.js'] };

	expect(paths(orderFiles(files, 'reading', { imports }))).toEqual([
		'server/db.js',
		'server/db.test.js',
		'server/api.js',
		'server/api.test.js',
		'e2e/flow.e2e.js',
		'package.json',
		'README.md',
		'server/old.js',
		'server/style.js',
		'bun.lock',
	]);
	expect(paths(orderFiles(files, 'size')).slice(0, 1)).toEqual(['README.md']);
	expect(paths(orderFiles(files, 'size')).at(-1)).toBe('bun.lock');
	expect(orderFiles(files, 'alphabetical')).toBe(files);
});

test("a test whose subject isn't read with the code still has a place", () => {
	const files = [file('a.js', '@@ -1 +1 @@\n-x =1\n+x = 1'), file('a.test.js'), file('b.js')];

	expect(paths(orderFiles(files))).toEqual(['b.js', 'a.test.js', 'a.js']);
});

test("a file's label says what it is to the change", () => {
	expect(fileLabel({ kind: 'test', subject: 'src/a.js' })).toBe('tests a.js');
	expect(fileLabel({ kind: 'generated' })).toBe('generated');
	expect(fileLabel({ kind: 'source', moved: true })).toBe('moved, unchanged');
	expect(fileLabel({ kind: 'source', whitespace: true })).toBe('whitespace only');
	expect(fileLabel({ kind: 'config' })).toBe('config');
	expect(fileLabel({ kind: 'source' })).toBe('');
});
