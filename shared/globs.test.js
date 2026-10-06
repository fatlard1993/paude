import { expect, test } from 'bun:test';

import { globMatcher, pathFilter } from './globs';

test('globs match the way VS Code reads them', () => {
	const js = globMatcher('*.js');

	expect(js('index.js')).toBe(true);
	expect(js('src/deep/app.js')).toBe(true);
	expect(js('src/app.ts')).toBe(false);

	const src = globMatcher('src');

	expect(src('src/app.js')).toBe(true);
	expect(src('lib/src/app.js')).toBe(true);
	expect(src('srcs/app.js')).toBe(false);

	const rooted = globMatcher('client/**/*.{js,css}');

	expect(rooted('client/Terminal/View.js')).toBe(true);
	expect(rooted('client/a.css')).toBe(true);
	expect(rooted('server/client/a.js')).toBe(false);
	expect(globMatcher('**/a,b.js')('x/a,b.js')).toBe(false);
	expect(globMatcher('**/{a,b}.js')('x/b.js')).toBe(true);
	expect(globMatcher(' , ')).toBeNull();
});

test('a path passes when included (or nothing is) and not excluded', () => {
	const passes = pathFilter({ include: '*.js, *.md', exclude: '**/*.test.js' });

	expect(passes('README.md')).toBe(true);
	expect(passes('server/files.js')).toBe(true);
	expect(passes('server/files.test.js')).toBe(false);
	expect(passes('bun.lock')).toBe(false);
	expect(pathFilter()('anything')).toBe(true);
});
