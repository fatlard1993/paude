import { ACCENT, colored, dim, onBackground, orange, printable } from './screen';

const PAGE = 10;
const CURSOR_BACKGROUND = 238;
const MARKED_BACKGROUND = 236;
const FOLDER_COLOR = 180;
// Roughly the editor colors the web panel uses, in the 256-color palette
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

const extensionOf = path => path.split('/').at(-1).split('.').at(-1).toLowerCase();

export const createBrowser = paths => ({
	paths,
	expanded: new Set(),
	cursor: 0,
	filter: null,
	typing: false,
	open: null,
});

// Every query character in order, as the web panel's name search does
const matches = (path, query) => {
	let position = -1;

	for (const character of query.toLowerCase()) {
		position = path.toLowerCase().indexOf(character, position + 1);
		if (position === -1) return false;
	}

	return true;
};

// The rows the list shows: a filtered list of files, or the tree with its open folders unfolded
export const entriesOf = browser => {
	if (browser.filter) {
		return browser.paths
			.filter(path => matches(path, browser.filter))
			.map(path => ({ kind: 'file', path, name: path, depth: 0 }));
	}

	const entries = [];
	const walk = (prefix, depth) => {
		const folders = new Set();
		const files = [];

		for (const path of browser.paths) {
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

const clamp = (value, low, high) => Math.min(Math.max(value, low), high);

// The window of rows to show so the cursor stays in view, kept near the middle
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

const listKey = (browser, key, canType) => {
	const entries = entriesOf(browser);
	const entry = entries[browser.cursor];

	if (browser.typing) {
		if (key === '\r' || key === '\n') browser.typing = false;
		else if (key === '\x1b') Object.assign(browser, { typing: false, filter: null });
		else if (key === '\x7f' || key === '\b') browser.filter = browser.filter.slice(0, -1);
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

	if (ESCAPE.includes(key)) {
		if (browser.filter) return Object.assign(browser, { filter: null, cursor: 0 }) && { type: 'redraw' };

		return { type: 'leave' };
	}

	if (!entry) return { type: 'ignore' };

	if (FORWARD.includes(key)) {
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

	if (key === 'a' && canType && entry.kind === 'file') return { type: 'attach', text: `@${entry.path} ` };

	return { type: 'ignore' };
};

const fileKey = (browser, key, canType) => {
	const file = browser.open;
	const last = Math.max(file.lines.length - 1, 0);

	if (key in MOVES) file.cursor = clamp(file.cursor + MOVES[key], 0, last);
	else if (key === 'g') file.cursor = 0;
	else if (key === 'G') file.cursor = last;
	else if (key === 'v') file.anchor = file.anchor === null ? file.cursor : null;
	else if (ESCAPE.includes(key) || BACK.includes(key)) browser.open = null;
	else if (key === 'a' && canType) {
		if (file.anchor === null) return { type: 'attach', text: `@${file.path} ` };

		const from = Math.min(file.anchor, file.cursor) + 1;
		const to = Math.max(file.anchor, file.cursor) + 1;
		const range = from === to ? `line ${from}` : `lines ${from}-${to}`;

		return {
			type: 'attach',
			text: `${file.path} ${range}:\n\`\`\`\n${file.lines.slice(from - 1, to).join('\n')}\n\`\`\`\n`,
		};
	} else return { type: 'ignore' };

	return { type: 'redraw' };
};

export const browserKey = (browser, key, { canType }) =>
	browser.open ? fileKey(browser, key, canType) : listKey(browser, key, canType);

const highlight = (text, width, color) => onBackground(text, width, color);

const listView = (browser, width, room) => {
	const entries = entriesOf(browser);
	const header =
		browser.filter !== null ? [`${orange('/')} ${printable(browser.filter)}${browser.typing ? '█' : ''}`] : [];
	const [top, bottom] = windowAround(browser.cursor, entries.length, room - header.length);
	const rows = entries.slice(top, bottom).map((entry, offset) => {
		const indent = '  '.repeat(entry.depth);
		const label =
			entry.kind === 'folder'
				? colored(`${browser.expanded.has(entry.path) ? '▾' : '▸'} ${printable(entry.name)}/`, FOLDER_COLOR)
				: `  ${colored(printable(entry.name), FILE_COLORS[extensionOf(entry.path)] ?? 252)}`;
		const text = `${indent}${label}`;

		return top + offset === browser.cursor ? highlight(text, width, CURSOR_BACKGROUND) : text;
	});

	return [...header, ...(rows.length ? rows : [dim(browser.filter ? '  no file names match' : '  no files')])];
};

const fileView = (browser, width, room) => {
	const file = browser.open;

	if (file.error) return [orange(file.path), '', dim(file.error)];

	const [from, to] =
		file.anchor === null ? [-1, -1] : [Math.min(file.anchor, file.cursor), Math.max(file.anchor, file.cursor)];
	const gutter = String(file.lines.length).length;
	const [top, bottom] = windowAround(file.cursor, file.lines.length, room - 1);
	const rows = file.lines.slice(top, bottom).map((line, offset) => {
		const index = top + offset;
		const marked = index >= from && index <= to;
		const number = String(index + 1).padStart(gutter);
		const text = `${marked ? orange(number) : dim(number)} ${dim('│')} ${printable(line.replaceAll('\t', '    '))}`;

		if (index === file.cursor) return highlight(text, width, CURSOR_BACKGROUND);

		return marked ? highlight(text, width, MARKED_BACKGROUND) : text;
	});

	return [`${colored(printable(file.path), ACCENT)} ${dim(`${file.cursor + 1}/${file.lines.length}`)}`, ...rows];
};

export const browserView = (browser, width, room) =>
	browser.open ? fileView(browser, width, room) : listView(browser, width, room);

export const browserKeys = (browser, canType, keyCap) => {
	if (browser.typing) return [`${keyCap('enter')} keep filter`, `${keyCap('esc')} clear`];

	if (browser.open) {
		const marked = browser.open.anchor !== null;

		return [
			`${keyCap('↑↓')} move`,
			`${keyCap('v')} ${marked ? 'clear marks' : 'mark lines'}`,
			canType && `${keyCap('a')} attach ${marked ? 'marked lines' : 'file'}`,
			`${keyCap('esc')} back`,
		].filter(Boolean);
	}

	return [
		`${keyCap('↑↓')} move`,
		`${keyCap('enter')} open`,
		`${keyCap('/')} filter`,
		canType && `${keyCap('a')} attach file`,
		`${keyCap('esc')} back`,
	].filter(Boolean);
};
