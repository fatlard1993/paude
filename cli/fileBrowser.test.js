import { expect, test } from 'bun:test';

import { browserKey, browserView, createBrowser, entriesOf, openDiffSet, openFile } from './fileBrowser';

const paths = ['README.md', 'src/app.js', 'src/lib/util.js', 'docs/guide.md'];
const names = browser => entriesOf(browser).map(({ kind, name }) => `${kind === 'folder' ? '+' : ''}${name}`);
const press = (browser, keys, canType = true) => keys.map(key => browserKey(browser, key, { canType })).at(-1);

test('folders come first and open in place', () => {
	const browser = createBrowser(paths);

	expect(names(browser)).toEqual(['+docs', '+src', 'README.md']);

	press(browser, ['j', '\r']);
	expect(names(browser)).toEqual(['+docs', '+src', '+lib', 'app.js', 'README.md']);

	press(browser, ['j', 'j', 'h']);
	expect(entriesOf(browser)[browser.cursor].path).toBe('src');
});

test('a filter lists matching files by full path, and esc clears it', () => {
	const browser = createBrowser(paths);

	press(browser, ['/', 'u', 't', 'l', '\r']);
	expect(names(browser)).toEqual(['src/lib/util.js']);
	expect(press(browser, ['\r'])).toEqual({ type: 'readFile', path: 'src/lib/util.js' });

	press(browser, ['\x1b']);
	expect(browser.filter).toBeNull();
});

test('attaching sends the file, or just the marked lines', () => {
	const browser = createBrowser(paths);

	browser.open = { path: 'src/app.js', lines: ['one', 'two', 'three', 'four'], cursor: 0, anchor: null };
	expect(press(browser, ['a'])).toEqual({ type: 'attach', text: '@src/app.js ' });

	expect(press(browser, ['j', 'v', 'j', 'a'])).toEqual({
		type: 'attach',
		text: 'src/app.js lines 2-3:\n```\ntwo\nthree\n```\n',
	});
	expect(press(browser, ['a'], false)).toEqual({ type: 'ignore' });

	press(browser, ['\x1b']);
	expect(browser.open).toBeNull();
});

test('a file that could not be shown can be left or attached, and other keys do nothing', () => {
	const browser = createBrowser(paths);

	browser.open = { path: 'logo.png', error: 'Not a text file' };
	expect(press(browser, ['j', 'v', 'G'])).toEqual({ type: 'ignore' });
	expect(press(browser, ['a'])).toEqual({ type: 'attach', text: '@logo.png ' });

	press(browser, ['\x1b']);
	expect(browser.open).toBeNull();
});

test('content search: type a query, tab to the file filters, toggle options, enter searches, a hit opens', () => {
	const browser = createBrowser(paths);

	press(browser, ['?', 'a', 'd', 'd']);
	expect(browser.search.query).toBe('add');

	expect(press(browser, ['\t', '*', '.', 'j', 's'])).toEqual({ type: 'savePrefs' });
	expect(browser.prefs.search.include).toBe('*.js');

	expect(press(browser, ['\x1bw'])).toEqual({ type: 'savePrefs' });
	expect(browser.prefs.search.wholeWord).toBe(true);

	expect(press(browser, ['\r'])).toEqual({ type: 'search' });

	Object.assign(browser.search, { typing: false, results: [{ path: 'src/app.js', line: 3, text: 'add()' }] });
	expect(press(browser, ['\r'])).toEqual({ type: 'readFile', path: 'src/app.js', line: 3 });

	press(browser, ['\x1b']);
	expect(browser.search).toBeNull();
});

test('markdown switches between rendered and source, remembered through the prefs', () => {
	const browser = createBrowser(paths);

	browser.open = openFile('README.md', '# Title\n\nSome *text*.\n');
	expect(browserView(browser, 60, 20).join('\n')).toContain('rendered');

	expect(press(browser, ['m'])).toEqual({ type: 'savePrefs' });
	expect(browser.prefs.markdownView).toBe('source');
	expect(browserView(browser, 60, 20).join('\n')).toContain('# Title');

	browser.prefs.markdownView = 'rendered';
	browser.open = openFile('README.md', '# Title\n\nSome *text*.\n', 3);
	expect(browserView(browser, 60, 20).join('\n')).toContain('3/3');
});

test('the reader strips control characters and copies marked lines or the whole file', () => {
	const browser = createBrowser(paths);

	browser.open = openFile('src/app.js', 'const a = 1;\x1b]52;c;evil\x07\nconst b = 2;\nconst c = 3;\n', 2);
	expect(browser.open.cursor).toBe(1);
	expect(browser.open.lines[0]).not.toContain('\x1b');
	expect(browser.open.highlighted).not.toBeNull();

	expect(press(browser, ['y'])).toMatchObject({ type: 'copy', what: 'the file' });
	expect(press(browser, ['v', 'j', 'y'])).toEqual({
		type: 'copy',
		text: 'const b = 2;\nconst c = 3;',
		what: 'lines 2-3',
	});
});

// What the reader shows, colors taken out
const plain = line => line.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');

const SET = {
	title: 'make it two',
	files: [
		{ path: 'a.js', status: 'modified', diff: '@@ -1,2 +1,2 @@\n keep\n-one\n+two\n' },
		{ path: 'b.js', status: 'added', diff: '@@ -0,0 +1 @@\n+new\n' },
	],
};

test('a set of diffs lays out side by side when wide, unified when not, with each file headed', () => {
	const browser = createBrowser(paths);

	browser.open = openDiffSet(SET, { source: 'turn', turn: 't1' });

	const wide = browserView(browser, 150, 20).map(plain);

	expect(wide[0]).toContain('make it two');
	expect(wide[0]).toContain('side by side');
	expect(wide.some(line => line.includes('- one') && line.includes('+ two'))).toBe(true);

	const narrow = browserView(browser, 100, 20).map(plain);

	expect(narrow[0]).toContain('unified');
	expect(narrow.filter(line => /M a\.js|A b\.js/.test(line))).toHaveLength(2);
	expect(narrow.some(line => line.includes('- one') && line.includes('+ two'))).toBe(false);
});

test('marking across a side-by-side pair attaches its lines in diff order, per file', () => {
	const browser = createBrowser(paths);

	browser.open = openDiffSet(SET, { source: 'turn', turn: 't1' });
	browserView(browser, 150, 20);

	// rows: a.js heading, hunk, keep, one|two, b.js heading, hunk, new
	press(browser, ['j', 'j', 'j', 'v']);

	expect(press(browser, ['j', 'j', 'j', 'a'])).toEqual({
		type: 'attach',
		text: 'a.js, changed:\n```diff\n-one\n+two\n```\nb.js, changed:\n```diff\n+new\n```\n',
	});
	expect(press(browser, ['s'])).toEqual({ type: 'savePrefs' });
	expect(browser.prefs.diffLayout).toBe('unified');
});
