import { expect, test } from 'bun:test';

import { attachLinesText, extensionOf, kindOf, matchNames } from './projectFiles';

const paths = ['src/math.js', 'src/math.test.js', 'src/upper.js', 'README.md', 'docs/logo.svg', 'Dockerfile'];

test('kinds come from the extension, and a dotless name is its own', () => {
	expect(['src/math.js', 'README.md', 'docs/logo.svg', 'Dockerfile'].map(kindOf)).toEqual([
		'text',
		'markdown',
		'image',
		'text',
	]);
	expect(extensionOf('Dockerfile')).toBe('dockerfile');
});

test('names match loosely by default, exactly for whole word and regex, inside the file filters', () => {
	expect(matchNames(paths, 'mth')).toEqual(['src/math.js', 'src/math.test.js']);
	expect(matchNames(paths, 'MTH', { caseSensitive: true })).toEqual([]);
	expect(matchNames(paths, 'math', { wholeWord: true })).toEqual(['src/math.js', 'src/math.test.js']);
	expect(matchNames(paths, '^src/.*\\.js$', { regex: true })).toEqual([
		'src/math.js',
		'src/upper.js',
		'src/math.test.js',
	]);
	expect(matchNames(paths, '(', { regex: true })).toBeNull();
	expect(matchNames(paths, '', { exclude: '*.test.js, docs' })).toEqual([
		'src/math.js',
		'src/upper.js',
		'README.md',
		'Dockerfile',
	]);
});

test('attached lines say where they came from', () => {
	expect(attachLinesText('a.js', 2, 3, 'b\nc')).toBe('a.js lines 2-3:\n```\nb\nc\n```\n');
	expect(attachLinesText('a.js', 2, 2, 'b')).toBe('a.js line 2:\n```\nb\n```\n');
});
