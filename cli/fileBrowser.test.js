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

test('w asks for a tour of the file or the marked lines; → marks each stop, and esc ends the tour first', () => {
	const browser = createBrowser(paths);

	browser.open = openFile('src/app.js', 'one\ntwo\nthree\nfour\nfive\n');
	expect(press(browser, ['w'])).toEqual({
		type: 'walk',
		subject: { file: { path: 'src/app.js' } },
		heading: 'src/app.js',
	});
	expect(press(browser, ['j', 'v', 'j', 'w'])).toEqual({
		type: 'walk',
		subject: { file: { path: 'src/app.js', from: 2, to: 3 } },
		heading: 'src/app.js, lines 2-3',
	});

	browser.open.tour = {
		heading: 'src/app.js',
		overview: 'It counts.',
		leftOut: ['No stop is on lines 9-20.'],
		index: 0,
		stops: [
			{ path: 'src/app.js', side: 'new', from: 1, to: 2, text: 'The start.' },
			{ path: 'src/app.js', side: 'new', from: 4, to: 5, text: 'The end.' },
		],
	};
	expect(browserView(browser, 60, 20).join('\n')).toContain('Not in it: No stop is on lines 9-20.');

	press(browser, ['\x1b[C', '\x1b[C']);
	expect(browserView(browser, 60, 20).join('\n')).toContain('The end.');
	expect([browser.open.anchor, browser.open.cursor]).toEqual([3, 4]);

	press(browser, ['\x1b[D']);
	expect([browser.open.anchor, browser.open.cursor]).toEqual([0, 1]);

	press(browser, ['\x1b']);
	expect(browser.open.tour).toBeNull();
	expect(browser.open).not.toBeNull();
});

test('a tour goes with what it is about, so the next file opened has none', () => {
	const browser = createBrowser(paths);

	browser.open = openFile('src/app.js', 'one\ntwo\nthree\n');
	browser.open.tour = {
		heading: 'src/app.js',
		overview: 'It counts.',
		index: 0,
		stops: [{ path: 'src/app.js', side: 'new', from: 1, to: 2, text: 'The start.' }],
	};
	press(browser, ['h']);
	expect(browser.open).toBeNull();

	browser.open = openFile('src/lib/util.js', 'zzz\n');
	expect(browserView(browser, 80, 20).join('\n')).not.toContain('It counts.');
	expect(press(browser, ['q'])).toEqual({ type: 'redraw' });
	expect(browser.open).toBeNull();
});

test("a diff's tour marks each stop's rows, before or after the change", () => {
	const browser = createBrowser(paths);

	browser.open = openDiffSet(
		{
			title: 'a turn',
			files: [{ path: 'a.js', status: 'modified', diff: '@@ -1,3 +1,3 @@\n keep\n-old\n+new\n same' }],
		},
		{ source: 'turn', turn: 't1' },
	);
	browserView(browser, 80, 20);
	expect(press(browser, ['w'])).toEqual({
		type: 'walk',
		subject: { diff: { source: 'turn', turn: 't1' } },
		heading: 'a turn',
	});

	browser.open.tour = {
		heading: 'a turn',
		overview: 'It renames.',
		index: 0,
		stops: [
			{ path: 'a.js', side: 'old', from: 2, to: 2, text: 'Out goes old.' },
			{ path: 'a.js', side: 'new', from: 2, to: 3, text: 'In comes new.' },
		],
	};
	const marked = () => browser.open.rows.slice(browser.open.anchor, browser.open.cursor + 1).flatMap(row => row.lines);

	press(browser, ['n']);
	expect(marked().map(line => line.text)).toEqual(['old']);
	press(browser, ['n']);
	expect(marked().map(line => line.text)).toEqual(['new', 'same']);
});

test("a diff of several files reads in reading order, says what each is, folds what's generated, and O changes the order", () => {
	const browser = createBrowser(paths);
	const change = '@@ -1 +1 @@\n-a = 1\n+a = 2';

	browser.open = openDiffSet(
		{
			title: 'a branch',
			files: [
				{ path: 'bun.lock', status: 'modified', diff: '@@ -1 +1,2 @@\n-x\n+y\n+z' },
				{ path: 'src/app.js', status: 'modified', diff: change },
				{ path: 'src/app.test.js', status: 'modified', diff: change },
				{ path: 'src/util.js', status: 'modified', diff: change },
			],
			imports: { 'src/app.js': ['src/util.js'] },
		},
		{ source: 'compare' },
	);

	const files = () => browser.open.rows.filter(row => row.kind === 'file').map(row => [row.file.path, row.label]);
	const shown = () => browserView(browser, 80, 40).join('\n');

	expect(shown()).toContain('3 changed lines, folded');
	expect(files()).toEqual([
		['src/util.js', ''],
		['src/app.js', ''],
		['src/app.test.js', 'tests app.js'],
		['bun.lock', 'generated'],
	]);

	browser.open.cursor = browser.open.rows.findIndex(row => row.kind === 'folded');
	press(browser, ['\r']);
	expect(shown()).not.toContain('folded');

	expect(press(browser, ['O'])).toEqual({ type: 'savePrefs' });
	expect(browser.prefs.diffOrder).toBe('size');
	shown();
	expect(files()[0][0]).toBe('src/app.js');
	// By function, with no outline to go on, reads in reading order
	press(browser, ['O']);
	expect(browser.prefs.diffOrder).toBe('function');
	shown();
	expect(files().map(([path]) => path)).toEqual(['src/util.js', 'src/app.js', 'src/app.test.js', 'bun.lock']);
	press(browser, ['O']);
	shown();
	expect(files().map(([path]) => path)).toEqual(['bun.lock', 'src/app.js', 'src/app.test.js', 'src/util.js']);
});

test('M comments on the marked lines of a file, or of one file in a diff, with where they are and what they were read in', () => {
	const browser = createBrowser(paths);
	const note = (keys, canNote = true) => keys.map(key => browserKey(browser, key, { canType: true, canNote })).at(-1);

	browser.open = openFile('src/app.js', 'one\ntwo\nthree\n');
	expect(note(['j', 'v', 'j', 'M'])).toEqual({
		type: 'startComment',
		quote: 'two\nthree',
		anchor: { path: 'src/app.js', from: 2, to: 3 },
	});
	// Only for someone who may comment
	expect(note(['M'], false)).toEqual({ type: 'ignore' });
	// Blank lines quote where they are, as a comment needs a quote to be kept
	browser.open = openFile('src/app.js', 'one\n\n  \nfour\n');
	expect(note(['j', 'v', 'j', 'M'])).toEqual({
		type: 'startComment',
		quote: 'src/app.js lines 2-3 (blank)',
		anchor: { path: 'src/app.js', from: 2, to: 3 },
	});

	const blobs = { old: 'a'.repeat(40), new: 'b'.repeat(40) };

	browser.open = openDiffSet(
		{ title: 'a turn', files: [{ ...SET.files[0], blobs }, SET.files[1]] },
		{ source: 'turn', turn: 't1' },
	);
	browserView(browser, 100, 20);
	// unified rows: a.js heading, hunk, keep, -one, +two: from the removed line into what replaced it
	expect(note(['j', 'j', 'j', 'v', 'j', 'M'])).toEqual({
		type: 'startComment',
		quote: '-one\n+two',
		anchor: {
			path: 'a.js',
			from: 2,
			to: 2,
			side: 'new',
			blob: blobs.new,
			old: { from: 2, to: 2, leads: true, blob: blobs.old },
			diff: { source: 'turn', turn: 't1' },
		},
	});
	// Marked across two files, it says to mark lines in one
	expect(note(['v', 'v', 'j', 'j', 'j', 'M']).type).toBe('hint');
});

test('open comments show as a bar beside their lines, and a comment opened in its diff marks its lines', () => {
	const browser = createBrowser(paths);
	const bar = String.fromCharCode(0x258c);

	browser.open = Object.assign(openFile('src/app.js', 'one\ntwo\nthree\n'), { comments: { c1: { from: 2, to: 2 } } });

	const file = browserView(browser, 80, 20).map(plain);

	expect(file.filter(line => line.includes(bar)).map(line => line.trim())).toEqual([`2 ${bar} two`]);

	browser.open = Object.assign(openDiffSet(SET, { source: 'turn', turn: 't1' }), {
		comments: { 'a.js': { c1: { old: { from: 2, to: 2 }, new: null } } },
		focus: { path: 'a.js', old: { from: 2, to: 2 } },
	});

	const diff = browserView(browser, 100, 20).map(plain);

	expect(diff.filter(line => line.startsWith(bar)).map(line => line.trim())).toEqual([`${bar}   2      - one`]);
	expect(browser.open.rows.slice(browser.open.anchor, browser.open.cursor + 1).flatMap(row => row.lines)).toEqual([
		{ kind: 'removed', text: 'one', old: 2, order: 1 },
	]);
	expect(browser.open.focus).toBeNull();
});

test('a comment opened in a folded file of a diff unfolds it to mark its lines', () => {
	const browser = createBrowser(paths);

	browser.open = Object.assign(
		openDiffSet(
			{
				title: 'a branch',
				files: [
					{ path: 'bun.lock', status: 'modified', diff: '@@ -1 +1,2 @@\n-x\n+y\n+z' },
					{ path: 'src/app.js', status: 'modified', diff: '@@ -1 +1 @@\n-a = 1\n+a = 2' },
				],
			},
			{ source: 'compare' },
		),
		{ focus: { path: 'bun.lock', new: { from: 2, to: 2 } } },
	);
	browserView(browser, 100, 40);

	expect(browser.open.rows.some(row => row.kind === 'folded')).toBe(false);
	expect(
		browser.open.rows
			.slice(browser.open.anchor, browser.open.cursor + 1)
			.flatMap(row => row.lines)
			.map(line => line.text),
	).toEqual(['z']);
	expect(browser.open.focus).toBeNull();
});
