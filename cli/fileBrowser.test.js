import { expect, test } from 'bun:test';

import { browserKey, createBrowser, entriesOf } from './fileBrowser';

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
