import { pathFilter } from '../shared/globs';
import { attachDiffText, attachFileText, attachLinesText } from '../shared/attachText';
import { diffLines, parseDiff } from '../shared/diff';
import { extensionOf, kindOf, matchNames } from '../shared/projectFiles';
import searchPattern from '../shared/searchPattern';
import { fitCells } from './graphics';
import { highlightLines } from './highlight';
import { renderMarkdown } from './markdown';
import { DEFAULT_PREFS } from './prefs';
import { ACCENT, bold, colored, dim, onBackground, orange, printable } from './screen';

const PAGE = 10;
const CURSOR_BACKGROUND = 238;
const MARKED_BACKGROUND = 236;
const FOLDER_COLOR = 180;
const FILE_COLORS = {
	js: 185,
	mjs: 185,
	cjs: 185,
	jsx: 81,
	tsx: 81,
	ts: 68,
	py: 68,
	md: 110,
	css: 74,
	scss: 168,
	html: 166,
	json: 186,
	sh: 113,
	zsh: 113,
	rs: 180,
	go: 38,
	yml: 167,
	yaml: 167,
	png: 140,
	jpg: 140,
	svg: 140,
	gif: 140,
	lock: 244,
};
// VS Code's Alt+C, Alt+W and Alt+R
const OPTION_KEYS = { c: 'caseSensitive', w: 'wholeWord', r: 'regex' };
// The letters VS Code marks changed files with, in its colors
const STATUS_MARKS = {
	modified: ['M', 179],
	added: ['A', 114],
	deleted: ['D', 167],
	renamed: ['R', 75],
	untracked: ['U', 114],
};
const ADDED_COLOR = 114;
const REMOVED_COLOR = 167;
const HUNK_COLOR = 75;
const SEARCH_FIELDS = ['query', 'include', 'exclude'];

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

// `prefs` is the remembered { markdownView, search } object; the browser changes it and asks for it to be saved
export const createBrowser = (paths, prefs = structuredClone(DEFAULT_PREFS)) => ({
	paths,
	prefs,
	expanded: new Set(),
	cursor: 0,
	filter: null,
	typing: false,
	search: null,
	open: null,
	zoom: false,
	// What changed since the last commit, as the server lists it; null outside git
	changes: null,
	showChanges: false,
});

const changeOf = (browser, path) => browser.changes?.find(change => change.path === path) ?? null;

// Opened at a line (a search hit), markdown shows its source, where that line is
export const openFile = (path, text, line) => {
	const lines = text
		.replace(/\n$/, '')
		.split('\n')
		.map(source => printable(source.replaceAll('\t', '    ')));
	const isMarkdown = kindOf(path) === 'markdown';

	return {
		path,
		text,
		lines,
		highlighted: highlightLines(lines.join('\n'), path, isMarkdown ? 'markdown' : undefined),
		isMarkdown,
		view: line ? 'source' : null,
		cursor: clamp((line ?? 1) - 1, 0, Math.max(lines.length - 1, 0)),
		anchor: null,
		scroll: 0,
	};
};

// One changed file's diff, its hunks laid out as rows to move through and mark like a file's lines
export const openDiff = (path, text, status) => {
	const { binary, hunks } = parseDiff(text);

	return {
		path,
		diff: true,
		status,
		binary,
		rows: hunks.flatMap(hunk => [
			{ kind: 'hunk', text: `@@ -${hunk.oldStart} +${hunk.newStart} @@ ${hunk.heading}` },
			...hunk.lines,
		]),
		cursor: 0,
		anchor: null,
	};
};

export const entriesOf = browser => {
	const options = browser.prefs.search;

	if (browser.showChanges) {
		const changed = (browser.changes ?? []).map(({ path }) => path);
		const shown = browser.filter ? (matchNames(changed, browser.filter, options) ?? []) : changed;

		return shown.map(path => ({ kind: 'file', path, name: path, depth: 0 }));
	}

	const paths = browser.paths.filter(pathFilter(options));

	if (browser.filter) {
		return (matchNames(browser.paths, browser.filter, options) ?? []).map(path => ({
			kind: 'file',
			path,
			name: path,
			depth: 0,
		}));
	}

	const entries = [];
	const walk = (prefix, depth) => {
		const folders = new Set();
		const files = [];

		for (const path of paths) {
			if (!path.startsWith(prefix)) continue;

			const rest = path.slice(prefix.length);
			const slash = rest.indexOf('/');

			if (slash === -1) files.push(path);
			else folders.add(rest.slice(0, slash));
		}

		for (const name of [...folders].sort((a, b) => a.localeCompare(b))) {
			const path = `${prefix}${name}`;

			entries.push({ kind: 'folder', path, name, depth });
			if (browser.expanded.has(path)) walk(`${path}/`, depth + 1);
		}

		for (const path of files.sort((a, b) => a.localeCompare(b)))
			entries.push({ kind: 'file', path, name: path.slice(prefix.length), depth });
	};

	walk('', 0);

	return entries;
};

const windowAround = (cursor, count, room) => {
	const top = clamp(cursor - Math.floor(room / 2), 0, Math.max(count - room, 0));

	return [top, Math.min(top + room, count)];
};

const MOVES = {
	'\x1b[A': -1,
	'\x1bOA': -1,
	k: -1,
	'\x1b[B': 1,
	'\x1bOB': 1,
	j: 1,
	'\x1b[5~': -PAGE,
	'\x1b[6~': PAGE,
};
const FORWARD = ['\r', '\n', 'l', '\x1b[C', '\x1bOC'];
const BACK = ['h', '\x1b[D', '\x1bOD'];
const ESCAPE = ['\x1b', 'q'];
const ERASE = ['\x7f', '\b'];

// Alt+letter arrives as ESC and the letter
const toggledOption = key => key.length === 2 && key[0] === '\x1b' && OPTION_KEYS[key[1].toLowerCase()];

const toggleOption = (browser, option) => {
	browser.prefs.search[option] = !browser.prefs.search[option];

	return { type: 'savePrefs' };
};

const listKey = (browser, key, canType) => {
	const entries = entriesOf(browser);
	const entry = entries[browser.cursor];

	if (browser.typing) {
		const option = toggledOption(key);

		if (option) return toggleOption(browser, option);
		if (key === '\r' || key === '\n') browser.typing = false;
		else if (key === '\x1b') Object.assign(browser, { typing: false, filter: null });
		else if (ERASE.includes(key)) browser.filter = browser.filter.slice(0, -1);
		else browser.filter += printable(key);
		browser.cursor = 0;

		return { type: 'redraw' };
	}

	if (key in MOVES) {
		browser.cursor = clamp(browser.cursor + MOVES[key], 0, Math.max(entries.length - 1, 0));

		return { type: 'redraw' };
	}

	if (key === '/') {
		Object.assign(browser, { typing: true, filter: browser.filter ?? '', cursor: 0 });

		return { type: 'redraw' };
	}

	if (key === '?') {
		browser.search = { query: '', field: 'query', typing: true, results: null, error: null, cursor: 0 };

		return { type: 'redraw' };
	}

	if (key === 'c' && browser.changes !== null) {
		if (!browser.showChanges) return { type: 'loadChanges' };

		Object.assign(browser, { showChanges: false, filter: null, cursor: 0 });

		return { type: 'redraw' };
	}

	if (ESCAPE.includes(key)) {
		if (browser.filter !== null || browser.showChanges) {
			Object.assign(browser, {
				filter: null,
				showChanges: browser.filter === null ? false : browser.showChanges,
				cursor: 0,
			});

			return { type: 'redraw' };
		}

		return { type: 'leave' };
	}

	if (!entry) return { type: 'ignore' };

	if (FORWARD.includes(key)) {
		if (entry.kind === 'file' && browser.showChanges) return { type: 'readDiff', path: entry.path };
		if (entry.kind === 'file') return { type: 'readFile', path: entry.path };
		if (browser.expanded.has(entry.path) && key !== 'l' && !key.startsWith('\x1b')) browser.expanded.delete(entry.path);
		else browser.expanded.add(entry.path);

		return { type: 'redraw' };
	}

	if (BACK.includes(key)) {
		if (entry.kind === 'folder' && browser.expanded.has(entry.path)) browser.expanded.delete(entry.path);
		else {
			const parent = entry.path.split('/').slice(0, -1).join('/');
			const index = entries.findIndex(other => other.kind === 'folder' && other.path === parent);

			if (index !== -1) browser.cursor = index;
		}

		return { type: 'redraw' };
	}

	if (key === 'a' && canType && entry.kind === 'file') return { type: 'attach', text: attachFileText(entry.path) };

	return { type: 'ignore' };
};

const searchKey = (browser, key) => {
	const { search } = browser;

	if (search.typing) {
		const option = toggledOption(key);
		const field = search.field === 'query' ? null : search.field;
		const value = field ? browser.prefs.search[field] : search.query;
		const set = next => {
			if (field) browser.prefs.search[field] = next;
			else search.query = next;
		};

		search.error = null;

		if (option) return toggleOption(browser, option);
		if (key === '\t') search.field = SEARCH_FIELDS[(SEARCH_FIELDS.indexOf(search.field) + 1) % SEARCH_FIELDS.length];
		else if (key === '\r' || key === '\n') {
			if (search.query.trim().length >= 2) return { type: 'search' };
			search.error = 'Type at least two characters.';
		} else if (key === '\x1b') {
			if (search.results) search.typing = false;
			else browser.search = null;
		} else if (ERASE.includes(key)) set(value.slice(0, -1));
		else set(value + printable(key));

		return { type: field ? 'savePrefs' : 'redraw' };
	}

	const hits = search.results ?? [];

	if (key in MOVES) search.cursor = clamp(search.cursor + MOVES[key], 0, Math.max(hits.length - 1, 0));
	else if (key === '?' || key === '/') search.typing = true;
	else if (ESCAPE.includes(key)) browser.search = null;
	else if (FORWARD.includes(key) && hits[search.cursor]) {
		const hit = hits[search.cursor];

		return { type: 'readFile', path: hit.path, line: hit.line };
	} else return { type: 'ignore' };

	return { type: 'redraw' };
};

const attachLines = (file, from, to) => attachLinesText(file.path, from, to, file.lines.slice(from - 1, to).join('\n'));

const markedRange = file =>
	file.anchor === null
		? null
		: { from: Math.min(file.anchor, file.cursor) + 1, to: Math.max(file.anchor, file.cursor) + 1 };

const showsRendered = (browser, file) => file.isMarkdown && (file.view ?? browser.prefs.markdownView) === 'rendered';

const markedRows = diff =>
	diff.anchor === null
		? null
		: diff.rows.slice(Math.min(diff.anchor, diff.cursor), Math.max(diff.anchor, diff.cursor) + 1);

const diffKey = (browser, key, canType) => {
	const diff = browser.open;
	const last = Math.max(diff.rows.length - 1, 0);
	const marked = markedRows(diff);
	const lines = (marked ?? diff.rows).filter(row => row.kind !== 'hunk');

	if (ESCAPE.includes(key) || BACK.includes(key)) browser.open = null;
	else if (key in MOVES) diff.cursor = clamp(diff.cursor + MOVES[key], 0, last);
	else if (key === 'g') diff.cursor = 0;
	else if (key === 'G') diff.cursor = last;
	else if (key === 'v') diff.anchor = diff.anchor === null ? diff.cursor : null;
	else if (key === 'o' && diff.status !== 'deleted') return { type: 'readFile', path: diff.path };
	else if (key === 'a' && canType && lines.length)
		return { type: 'attach', text: attachDiffText(diff.path, diffLines(lines)) };
	else if (key === 'y' && lines.length)
		return { type: 'copy', text: diffLines(lines), what: marked ? 'the marked changes' : 'the changes' };
	else return { type: 'ignore' };

	return { type: 'redraw' };
};

const fileKey = (browser, key, canType) => {
	const file = browser.open;

	if (key === 'z') {
		browser.zoom = !browser.zoom;

		return { type: 'redraw' };
	}

	if (file.diff) return diffKey(browser, key, canType);
	// Edited with the person's own editor, in the side terminal, on the machine the file is on
	if (key === 'e' && canType && !file.error && !file.image) return { type: 'editFile', path: file.path };
	if (key === 'c' && changeOf(browser, file.path)) return { type: 'readDiff', path: file.path };

	// An image, or a file that couldn't be shown (binary, too big, gone), can still be left, or handed to Claude to
	// read itself
	if (file.error || file.image) {
		if (ESCAPE.includes(key) || BACK.includes(key)) browser.open = null;
		else if (key === 'a' && canType) return { type: 'attach', text: attachFileText(file.path) };
		else return { type: 'ignore' };

		return { type: 'redraw' };
	}

	if (ESCAPE.includes(key) || BACK.includes(key)) {
		browser.open = null;

		return { type: 'redraw' };
	}

	if (key === 'm' && file.isMarkdown) {
		file.view = showsRendered(browser, file) ? 'source' : 'rendered';
		browser.prefs.markdownView = file.view;
		file.anchor = null;

		return { type: 'savePrefs' };
	}

	// Rendered markdown scrolls; there are no source lines to mark in it
	if (showsRendered(browser, file)) {
		const last = Math.max((file.rendered?.lines.length ?? 1) - 1, 0);

		if (key in MOVES) file.scroll = clamp(file.scroll + MOVES[key], 0, last);
		else if (key === 'g') file.scroll = 0;
		else if (key === 'G') file.scroll = last;
		else if (key === 'a' && canType) return { type: 'attach', text: attachFileText(file.path) };
		else if (key === 'y') return { type: 'copy', text: file.text, what: 'the file' };
		else return { type: 'ignore' };

		return { type: 'redraw' };
	}

	const last = Math.max(file.lines.length - 1, 0);
	const marked = markedRange(file);

	if (key in MOVES) file.cursor = clamp(file.cursor + MOVES[key], 0, last);
	else if (key === 'g') file.cursor = 0;
	else if (key === 'G') file.cursor = last;
	else if (key === 'v') file.anchor = file.anchor === null ? file.cursor : null;
	else if (key === 'a' && canType)
		return { type: 'attach', text: marked ? attachLines(file, marked.from, marked.to) : attachFileText(file.path) };
	else if (key === 'y') {
		if (!marked) return { type: 'copy', text: file.text, what: 'the file' };

		return {
			type: 'copy',
			text: file.lines.slice(marked.from - 1, marked.to).join('\n'),
			what: marked.from === marked.to ? `line ${marked.from}` : `lines ${marked.from}-${marked.to}`,
		};
	} else return { type: 'ignore' };

	return { type: 'redraw' };
};

export const browserKey = (browser, key, { canType }) => {
	if (browser.open) return fileKey(browser, key, canType);
	if (browser.search) return searchKey(browser, key);

	return listKey(browser, key, canType);
};

const highlight = (text, width, color) => onBackground(text, width, color);

const optionChips = options =>
	[
		['Aa', 'caseSensitive'],
		['ab', 'wholeWord'],
		['.*', 'regex'],
	]
		.map(([label, key]) => (options[key] ? `\x1b[1;38;5;16;48;5;${ACCENT}m ${label} \x1b[0m` : dim(` ${label} `)))
		.join(' ');

const markMatches = (text, query, options) => {
	const pattern = query && searchPattern(query, options, 'g');

	if (!pattern) return text;

	return text.replace(pattern, match => (match ? `\x1b[1;38;5;${ACCENT}m${match}\x1b[22;39m` : match));
};

const listView = (browser, width, room) => {
	const entries = entriesOf(browser);
	const options = browser.prefs.search;
	const filters = [
		options.include && `include ${printable(options.include)}`,
		options.exclude && `exclude ${printable(options.exclude)}`,
	]
		.filter(Boolean)
		.join(' · ');
	const header = [
		...(browser.showChanges ? [bold(`Changes since the last commit (${browser.changes?.length ?? 0})`)] : []),
		...(browser.filter !== null
			? [`${orange('/')} ${printable(browser.filter)}${browser.typing ? '█' : ''}   ${optionChips(options)}`]
			: []),
		...(filters ? [dim(filters)] : []),
	];
	const [top, bottom] = windowAround(browser.cursor, entries.length, room - header.length);
	const rows = entries.slice(top, bottom).map((entry, offset) => {
		const indent = '  '.repeat(entry.depth);
		const label =
			entry.kind === 'folder'
				? colored(`${browser.expanded.has(entry.path) ? '▾' : '▸'} ${printable(entry.name)}/`, FOLDER_COLOR)
				: `  ${colored(printable(entry.name), FILE_COLORS[extensionOf(entry.path)] ?? 252)}`;
		const change = entry.kind === 'file' && changeOf(browser, entry.path);
		const changedInside =
			entry.kind === 'folder' &&
			!browser.expanded.has(entry.path) &&
			browser.changes?.some(({ path }) => path.startsWith(`${entry.path}/`));
		let mark = change ? ` ${colored(...STATUS_MARKS[change.status])}` : '';

		if (changedInside) mark = ` ${colored('•', STATUS_MARKS.modified[1])}`;
		const text = `${indent}${label}${mark}`;

		return top + offset === browser.cursor ? highlight(text, width, CURSOR_BACKGROUND) : text;
	});
	const invalid = browser.filter && (options.wholeWord || options.regex) && !searchPattern(browser.filter, options);
	let empty = browser.filter ? 'no file names match' : 'no files';

	if (browser.showChanges && !browser.filter) empty = 'nothing has changed since the last commit';

	if (invalid) empty = 'that regular expression is not valid';

	return [...header, ...(rows.length ? rows : [dim(`  ${empty}`)])];
};

const searchView = (browser, width, room) => {
	const { search } = browser;
	const options = browser.prefs.search;
	const field = (name, label, value) => {
		const active = search.typing && search.field === name;

		return `${active ? orange(label) : dim(label)} ${printable(value)}${active ? '█' : ''}`;
	};
	const header = [
		`${field('query', '?', search.query)}   ${optionChips(options)}`,
		`${field('include', 'include', options.include)}   ${field('exclude', 'exclude', options.exclude)}`,
	];

	if (search.error) return [...header, '', orange(search.error)];
	if (search.running) return [...header, '', dim('searching...')];
	if (!search.results)
		return [...header, '', dim('enter searches · tab moves between fields · alt+c/w/r toggle the options')];
	if (!search.results.length) return [...header, '', dim('nothing found')];

	const [top, bottom] = windowAround(search.cursor, search.results.length, room - header.length - 1);

	return [
		...header,
		dim(`${search.results.length} matches`),
		...search.results.slice(top, bottom).map((hit, offset) => {
			const place = `${colored(printable(hit.path), FILE_COLORS[extensionOf(hit.path)] ?? 252)}${dim(`:${hit.line}`)}`;
			const text = `${place}  ${markMatches(printable(hit.text.trim()), search.lastQuery, options)}`;

			return top + offset === search.cursor ? highlight(text, width, CURSOR_BACKGROUND) : text;
		}),
	];
};

const fileHeader = (file, detail) => `${colored(printable(file.path), ACCENT)} ${dim(detail)}`;

const diffView = (browser, width, room) => {
	const diff = browser.open;
	const change = changeOf(browser, diff.path);
	const header = fileHeader(diff, `changes${change ? ` · ${change.status}` : ''}`);

	if (diff.binary) return [header, '', dim('a binary file changed')];
	if (!diff.rows.length) return [header, '', dim('no line changes')];

	const marked = markedRows(diff);
	const markedFrom = marked ? Math.min(diff.anchor, diff.cursor) : -1;
	const markedTo = marked ? Math.max(diff.anchor, diff.cursor) : -1;
	const [top, bottom] = windowAround(diff.cursor, diff.rows.length, room - 1);
	const rows = diff.rows.slice(top, bottom).map((row, offset) => {
		const index = top + offset;
		let text;

		if (row.kind === 'hunk') text = colored(printable(row.text), HUNK_COLOR);
		else {
			const numbers = dim(`${String(row.old ?? '').padStart(4)} ${String(row.new ?? '').padStart(4)}`);
			const body = printable(row.text.replaceAll('\t', '    '));

			if (row.kind === 'added') text = `${numbers} ${colored(`+ ${body}`, ADDED_COLOR)}`;
			else if (row.kind === 'removed') text = `${numbers} ${colored(`- ${body}`, REMOVED_COLOR)}`;
			else if (row.kind === 'note') text = `${numbers} ${dim(body)}`;
			else text = `${numbers}   ${body}`;
		}

		if (index === diff.cursor) return highlight(text, width, CURSOR_BACKGROUND);

		return index >= markedFrom && index <= markedTo ? highlight(text, width, MARKED_BACKGROUND) : text;
	});

	return [header, ...rows];
};

const fileView = (browser, width, room) => {
	const file = browser.open;

	if (file.diff) return diffView(browser, width, room);

	if (file.error) return [orange(printable(file.path)), '', dim(printable(file.error))];

	// The terminal draws the image over these rows; they're left empty for it
	if (file.image) {
		file.image.cells = fitCells(file.image, width, Math.max(room - 1, 1));

		return [
			fileHeader(file, `${file.image.width}×${file.image.height}`),
			...Array.from({ length: file.image.cells.rows }, () => ''),
		];
	}

	if (showsRendered(browser, file)) {
		if (file.rendered?.width !== width) file.rendered = { width, lines: renderMarkdown(file.text, width) };

		const { lines } = file.rendered;
		const top = clamp(file.scroll, 0, Math.max(lines.length - (room - 1), 0));

		file.scroll = top;

		return [
			fileHeader(file, `rendered · ${Math.min(top + room - 1, lines.length)}/${lines.length}`),
			...lines.slice(top, top + room - 1),
		];
	}

	const marked = markedRange(file);
	const gutter = String(file.lines.length).length;
	const [top, bottom] = windowAround(file.cursor, file.lines.length, room - 1);
	const rows = file.lines.slice(top, bottom).map((line, offset) => {
		const index = top + offset;
		const inMark = marked && index + 1 >= marked.from && index + 1 <= marked.to;
		const number = String(index + 1).padStart(gutter);
		const text = `${inMark ? orange(number) : dim(number)} ${dim('│')} ${file.highlighted?.[index] ?? line}`;

		if (index === file.cursor) return highlight(text, width, CURSOR_BACKGROUND);

		return inMark ? highlight(text, width, MARKED_BACKGROUND) : text;
	});

	return [fileHeader(file, `${file.cursor + 1}/${file.lines.length}`), ...rows];
};

export const browserView = (browser, width, room) => {
	if (browser.open) return fileView(browser, width, room);
	if (browser.search) return searchView(browser, width, room);

	return listView(browser, width, room);
};

export const browserKeys = (browser, canType, keyCap) => {
	const file = browser.open;

	if (file?.diff) {
		const marked = file.anchor !== null;

		return [
			`${keyCap('↑↓')} move`,
			`${keyCap('v')} ${marked ? 'clear marks' : 'mark lines'}`,
			canType && `${keyCap('a')} attach ${marked ? 'marked lines' : 'changes'}`,
			`${keyCap('y')} copy`,
			file.status !== 'deleted' && `${keyCap('o')} open file`,
			`${keyCap('z')} full screen`,
			`${keyCap('esc')} back`,
		].filter(Boolean);
	}

	if (file?.error || file?.image)
		return [canType && `${keyCap('a')} attach file`, `${keyCap('z')} full screen`, `${keyCap('esc')} back`].filter(
			Boolean,
		);

	if (file && showsRendered(browser, file))
		return [
			`${keyCap('↑↓')} scroll`,
			`${keyCap('m')} source`,
			canType && `${keyCap('a')} attach file`,
			`${keyCap('y')} copy`,
			`${keyCap('z')} full screen`,
			`${keyCap('esc')} back`,
		].filter(Boolean);

	if (file) {
		const marked = file.anchor !== null;

		return [
			`${keyCap('↑↓')} move`,
			`${keyCap('v')} ${marked ? 'clear marks' : 'mark lines'}`,
			canType && `${keyCap('a')} attach ${marked ? 'marked lines' : 'file'}`,
			`${keyCap('y')} copy ${marked ? 'marked lines' : 'file'}`,
			canType && `${keyCap('e')} edit`,
			changeOf(browser, file.path) && `${keyCap('c')} changes`,
			file.isMarkdown && `${keyCap('m')} rendered`,
			`${keyCap('z')} full screen`,
			`${keyCap('esc')} back`,
		].filter(Boolean);
	}

	if (browser.search?.typing)
		return [
			`${keyCap('enter')} search`,
			`${keyCap('tab')} next field`,
			`${keyCap('alt+c/w/r')} options`,
			`${keyCap('esc')} back`,
		];

	if (browser.search)
		return [`${keyCap('↑↓')} move`, `${keyCap('enter')} open`, `${keyCap('?')} edit search`, `${keyCap('esc')} back`];

	if (browser.typing)
		return [`${keyCap('enter')} keep filter`, `${keyCap('alt+c/w/r')} options`, `${keyCap('esc')} clear`];

	return [
		`${keyCap('↑↓')} move`,
		`${keyCap('enter')} open`,
		`${keyCap('/')} find file`,
		`${keyCap('?')} search contents`,
		browser.changes !== null && `${keyCap('c')} ${browser.showChanges ? 'all files' : 'changes'}`,
		canType && `${keyCap('a')} attach file`,
		`${keyCap('esc')} ${browser.showChanges ? 'all files' : 'back'}`,
	].filter(Boolean);
};
