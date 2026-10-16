import { pathFilter } from '../shared/globs';
import { attachDiffText, attachFileText, attachLinesText } from '../shared/attachText';
import { diffAnchor, diffLines, parseDiff, sideBySide } from '../shared/diff';
import { ORDERS, describeFiles, fileLabel, folds, orderFiles } from '../shared/reviewOrder';
import relativeTime from '../shared/relativeTime';
import { extensionOf, kindOf, matchNames } from '../shared/projectFiles';
import searchPattern from '../shared/searchPattern';
import { fitCells } from './graphics';
import { highlightLines } from './highlight';
import { renderMarkdown } from './markdown';
import { DEFAULT_PREFS } from './prefs';
import { ACCENT, bold, colored, dim, fit, onBackground, orange, printable, visibleLength, wrap } from './screen';

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
const PROPOSAL_COLOR = 179;
const COMMENT_COLOR = 75;
// Narrower than this, side by side leaves too little of each line
const SPLIT_MIN_COLUMNS = 140;
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

// Any set of diffs (a changed file, a turn, a proposal, two files compared), to move through and mark like a file
export const openDiffSet = (set, source) => ({
	diff: true,
	set,
	source,
	path: set.files.length === 1 ? set.files[0].path : null,
	rows: [],
	layout: null,
	cursor: 0,
	anchor: null,
});

// The set laid out as rows, its files in the order asked for: file and hunk headings, then lines, each knowing its
// file and its place in it. Side by side, a removed run sits beside the added run that replaced it, and a row is both
// its sides. In a set of several, a generated file is folded to one row until it's in `shown`.
const diffRows = (set, layout, { order = 'reading', shown = new Set() } = {}) => {
	const about = describeFiles(set.files);

	let group = null;

	return orderFiles(set.files, order, set).flatMap(file => {
		const { binary, hunks } = parseDiff(file.diff ?? '');
		const what = about.get(file.path);
		const folded = folds(what) && set.files.length > 1 && !shown.has(file.path);
		const heading = file.group && file.group !== group ? [{ kind: 'group', text: file.group }] : [];
		const label = [file.part, fileLabel(what)].filter(Boolean).join(' · ');
		let place = 0;

		group = file.group ?? null;

		return [
			...heading,
			...(set.files.length > 1 || set.title !== file.path || file.part ? [{ kind: 'file', file, label }] : []),
			...(file.note || binary ? [{ kind: 'message', text: file.note ?? 'a binary file changed' }] : []),
			...(folded
				? [{ kind: 'folded', path: file.path, text: `${what.changed} changed lines, folded: enter shows them` }]
				: []),
			...(folded ? [] : hunks).flatMap(hunk => {
				const lines = hunk.lines.map(line => ({ ...line, order: place++ }));
				const heading = { kind: 'hunk', text: `@@ -${hunk.oldStart} +${hunk.newStart} @@ ${hunk.heading}` };

				if (layout !== 'split')
					return [heading, ...lines.map(line => ({ kind: 'line', path: file.path, lines: [line] }))];

				return [
					heading,
					...sideBySide(lines).map(({ left, right, note }) => ({
						kind: note ? 'line' : 'pair',
						path: file.path,
						left: left?.line,
						right: right?.line,
						lines: note ? [note.line] : [...new Set([left?.line, right?.line].filter(Boolean))],
					})),
				];
			}),
		];
	});
};

// Marked rows (or all of them) as each file's lines, in the order the diff has them
const linesByFile = rows => {
	const groups = [];

	for (const row of rows) {
		if (!row.lines) continue;

		const last = groups.at(-1);

		if (last?.path === row.path) last.lines.push(...row.lines);
		else groups.push({ path: row.path, lines: [...row.lines] });
	}

	return groups.map(({ path, lines }) => ({ path, lines: lines.sort((a, b) => a.order - b.order) }));
};

export const entriesOf = browser => {
	const options = browser.prefs.search;

	if (browser.showChanges) {
		const changed = (browser.changes ?? []).map(({ path }) => path);
		const shown = browser.filter ? (matchNames(changed, browser.filter, options) ?? []) : changed;
		const turns = (browser.turns ?? []).filter(
			({ prompt }) => !browser.filter || prompt.toLowerCase().includes(browser.filter.toLowerCase()),
		);

		return [
			...(browser.proposal && !browser.filter ? [{ kind: 'proposal', path: '', name: '', depth: 0 }] : []),
			...shown.map(path => ({ kind: 'file', path, name: path, depth: 0 })),
			...turns.map(turn => ({ kind: 'turn', path: '', name: turn.prompt, turn, depth: 0 })),
		];
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
const NEXT_STOP = ['\x1b[C', '\x1bOC', 'n'];
const PREVIOUS_STOP = ['\x1b[D', '\x1bOD', 'p'];
// A tour's text above the lines it's about, at most this many rows of it
const TOUR_ROWS = 6;
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
		if (entry.kind === 'proposal') return { type: 'readDiffSet', source: { source: 'proposal' } };
		if (entry.kind === 'turn') return { type: 'readDiffSet', source: { source: 'turn', turn: entry.turn.id } };
		if (entry.kind === 'file' && browser.showChanges)
			return { type: 'readDiffSet', source: { source: 'changes', path: entry.path } };
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

// A comment on the marked lines of one file in the diff (or the line the cursor is on), numbered by the texts the diff
// is between, and knowing the diff to open it in again
const commentOnDiff = diff => {
	const groups = linesByFile(markedRows(diff) ?? [diff.rows[diff.cursor]].filter(Boolean));

	if (groups.length !== 1) return { type: 'hint', text: 'Mark lines in one file to comment on them.' };

	const [{ path, lines }] = groups;
	const anchor = diffAnchor(path, lines);
	const blobs = diff.set.files.find(file => file.path === path)?.blobs ?? {};

	if (!anchor) return { type: 'hint', text: 'Move to a changed line, or mark some, to comment on them.' };

	return {
		type: 'startComment',
		quote: diffLines(lines),
		anchor: {
			...anchor,
			blob: blobs[anchor.side],
			...(anchor.old && { old: { ...anchor.old, blob: blobs.old } }),
			diff: diff.source,
		},
	};
};

const diffKey = (browser, key, { canType, canNote }) => {
	const diff = browser.open;
	const last = Math.max(diff.rows.length - 1, 0);
	const marked = markedRows(diff);
	const groups = linesByFile(marked ?? diff.rows);
	const here = diff.rows[diff.cursor]?.path ?? diff.rows[diff.cursor]?.file?.path ?? diff.path;
	const opens = here && diff.set.files.find(file => file.path === here)?.status !== 'deleted';

	if (ESCAPE.includes(key) || BACK.includes(key)) browser.open = null;
	else if ((key === '\r' || key === '\n') && diff.rows[diff.cursor]?.kind === 'folded')
		diff.shown = new Set([...(diff.shown ?? []), diff.rows[diff.cursor].path]);
	else if (key === 'O') {
		const orders = Object.keys(ORDERS);

		browser.prefs.diffOrder = orders[(orders.indexOf(browser.prefs.diffOrder ?? 'reading') + 1) % orders.length];
		diff.anchor = null;

		return { type: 'savePrefs' };
	} else if (key in MOVES) diff.cursor = clamp(diff.cursor + MOVES[key], 0, last);
	else if (key === 'g') diff.cursor = 0;
	else if (key === 'G') diff.cursor = last;
	else if (key === 'v') diff.anchor = diff.anchor === null ? diff.cursor : null;
	else if (key === 's') {
		browser.prefs.diffLayout = diff.layout === 'split' ? 'unified' : 'split';

		return { type: 'savePrefs' };
	} else if (key === 'o' && opens) return { type: 'readFile', path: here };
	else if (key === 'M' && canNote) return commentOnDiff(diff);
	else if (key === 'a' && canType && groups.length)
		return { type: 'attach', text: groups.map(({ path, lines }) => attachDiffText(path, diffLines(lines))).join('') };
	else if (key === 'y' && groups.length)
		return {
			type: 'copy',
			text: groups.map(({ lines }) => diffLines(lines)).join('\n'),
			what: marked ? 'the marked changes' : 'the changes',
		};
	else return { type: 'ignore' };

	return { type: 'redraw' };
};

const lineRange = ({ from, to }) => (from === to ? `line ${from}` : `lines ${from}-${to}`);

// A guided tour of what's open: the diff, the lines marked, or the whole file
const walkOf = file => {
	if (file.diff) return { type: 'walk', subject: { diff: file.source }, heading: file.set.title };

	const marked = markedRange(file);

	return {
		type: 'walk',
		subject: { file: { path: file.path, ...marked } },
		heading: marked ? `${file.path}, ${lineRange(marked)}` : file.path,
	};
};

// The tour's stop marked on its lines, in the file or the diff it's about
export const placeStop = browser => {
	const { open: file } = browser;
	const tour = file?.tour;
	const stop = tour?.stops?.[tour.index - 1];

	if (!stop || !file) return;
	if (!file.diff) {
		if (file.path !== stop.path || !file.lines) return;
		file.anchor = clamp(stop.from - 1, 0, file.lines.length - 1);
		file.cursor = clamp(stop.to - 1, 0, file.lines.length - 1);

		return;
	}

	markInDiff(file, { path: stop.path, [stop.side]: stop });
};

// Lines of a file in the diff marked, on either side of the change or both ({ path, new, old }, each { from, to }),
// as far as its rows show them; true when they do
const markInDiff = (diff, { path, ...sides }) => {
	const on = row =>
		row.path === path &&
		row.lines?.some(line =>
			['new', 'old'].some(side => sides[side] && sides[side].from <= line[side] && line[side] <= sides[side].to),
		);
	const first = diff.rows.findIndex(on);

	if (first === -1) return false;
	diff.anchor = first;
	diff.cursor = Math.max(first, diff.rows.findLastIndex(on));

	return true;
};

// While a tour is open: → and ← (or n and p) step through it, Esc ends it; anything else moves as ever. The tour is
// the open file's or diff's own, so it goes when that does.
const tourKey = (browser, key) => {
	const { tour } = browser.open;

	if (ESCAPE.includes(key)) browser.open.tour = null;
	else if (!tour.stops) return { type: 'ignore' };
	else if (NEXT_STOP.includes(key)) tour.index = Math.min(tour.index + 1, tour.stops.length);
	else if (PREVIOUS_STOP.includes(key)) tour.index = Math.max(tour.index - 1, 0);
	else return null;

	placeStop(browser);

	return { type: 'redraw' };
};

// A comment on the marked lines (or the line the cursor is on) of the file as it was read. Blank lines quote where
// they are instead, since a comment needs something to quote.
const commentOnFile = file => {
	const { from, to } = markedRange(file) ?? { from: file.cursor + 1, to: file.cursor + 1 };
	const quote = file.text
		.replace(/\n$/, '')
		.split('\n')
		.slice(from - 1, to)
		.join('\n');

	return {
		type: 'startComment',
		quote: quote.trim() ? quote : `${file.path} ${lineRange({ from, to })} (blank)`,
		anchor: { path: file.path, from, to },
	};
};

const fileKey = (browser, key, { canType, canNote }) => {
	const file = browser.open;

	if (key === 'z') {
		browser.zoom = !browser.zoom;

		return { type: 'redraw' };
	}

	if (file.tour) {
		const toured = tourKey(browser, key);

		if (toured) return toured;
	}

	if (key === 'w' && (file.diff ? file.set.files.length : file.lines && !showsRendered(browser, file)))
		return walkOf(file);

	if (file.diff) return diffKey(browser, key, { canType, canNote });
	// Edited with the person's own editor, in the side terminal, on the machine the file is on
	if (key === 'e' && canType && !file.error && !file.image) return { type: 'editFile', path: file.path };
	if (key === 'c' && changeOf(browser, file.path))
		return { type: 'readDiffSet', source: { source: 'changes', path: file.path } };

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
	else if (key === 'M' && canNote && !file.outside) return commentOnFile(file);
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

export const browserKey = (browser, key, { canType, canNote = false }) => {
	if (browser.open) return fileKey(browser, key, { canType, canNote });
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
		...(browser.showChanges
			? [
					bold(
						`Changes${browser.changes ? `: ${browser.changes.length} since the last commit` : ''}${browser.turns?.length ? `, ${browser.turns.length} turn${browser.turns.length === 1 ? '' : 's'}` : ''}`,
					),
				]
			: []),
		...(browser.filter !== null
			? [`${orange('/')} ${printable(browser.filter)}${browser.typing ? '█' : ''}   ${optionChips(options)}`]
			: []),
		...(filters ? [dim(filters)] : []),
	];
	const [top, bottom] = windowAround(browser.cursor, entries.length, room - header.length);
	const rows = entries.slice(top, bottom).map((entry, offset) => {
		const indent = '  '.repeat(entry.depth);
		if (entry.kind === 'proposal') {
			const count = browser.proposal.files.length;
			const text = colored(`  ✋ Claude proposes ${count === 1 ? 'a change' : `${count} changes`}`, PROPOSAL_COLOR);

			return top + offset === browser.cursor ? highlight(text, width, CURSOR_BACKGROUND) : text;
		}

		if (entry.kind === 'turn') {
			const detail = dim(`  ${entry.turn.files} · ${relativeTime(Date.parse(entry.turn.at))}`);
			const text = `  ${dim('›')} ${fit(printable(entry.turn.prompt), Math.max(width - visibleLength(detail) - 6, 10))}${detail}`;

			return top + offset === browser.cursor ? highlight(text, width, CURSOR_BACKGROUND) : text;
		}

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

const STATUS_LETTERS = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U' };

const diffLine = (line, numbers) => {
	const body = printable(line.text.replaceAll('\t', '    '));

	if (line.kind === 'added') return `${numbers} ${colored(`+ ${body}`, ADDED_COLOR)}`;
	if (line.kind === 'removed') return `${numbers} ${colored(`- ${body}`, REMOVED_COLOR)}`;
	if (line.kind === 'note') return `${numbers} ${dim(body)}`;

	return `${numbers}   ${body}`;
};

// Whether open comments are on a diff line: `comments` is where each is in the diff ({ [path]: { [id]: { new, old } } }),
// and `only`, the one side of it a side-by-side half shows
const commented = (comments, path, line, only) =>
	Object.values(comments?.[path] ?? {}).some(where =>
		['new', 'old'].some(
			side =>
				(!only || only === side) &&
				line[side] !== undefined &&
				where?.[side] &&
				where[side].from <= line[side] &&
				line[side] <= where[side].to,
		),
	);

// A column beside each line, a bar where comments are on it
const commentBar = on => (on ? colored('▌', COMMENT_COLOR) : ' ');

// One side of a side-by-side row, cut or padded to its half
const diffSide = (line, side, width, bar = ' ') => {
	if (!line) return dim('·'.repeat(Math.max(width, 0)));

	const text = fit(
		`${bar}${diffLine(line, dim(String((side === 'left' ? line.old : line.new) ?? '').padStart(4)))}`,
		width,
	);

	return `${text}${' '.repeat(Math.max(width - visibleLength(text), 0))}`;
};

const diffView = (browser, width, room) => {
	const diff = browser.open;
	const layout = width >= SPLIT_MIN_COLUMNS && browser.prefs.diffLayout !== 'unified' ? 'split' : 'unified';

	const order = browser.prefs.diffOrder ?? 'reading';

	// A comment asked for in a folded file unfolds it, so its lines have rows to mark
	if (diff.focus && !diff.shown?.has(diff.focus.path)) diff.shown = new Set([...(diff.shown ?? []), diff.focus.path]);

	const laidOut = `${layout} ${order} ${[...(diff.shown ?? [])].join(' ')}`;

	if (diff.laidOut !== laidOut) {
		diff.rows = diffRows(diff.set, layout, { order, shown: diff.shown });
		diff.layout = layout;
		diff.laidOut = laidOut;
		diff.cursor = clamp(diff.cursor, 0, Math.max(diff.rows.length - 1, 0));
		diff.anchor = null;
	}
	// Lines asked for (a comment's), marked once the rows are laid out with its file unfolded
	if (diff.focus && diff.rows.length) {
		markInDiff(diff, diff.focus);
		diff.focus = null;
	}

	const header = `${colored(printable(diff.set.title), ACCENT)} ${dim(`${diff.set.files.length === 1 ? '1 file' : `${diff.set.files.length} files`} · ${layout === 'split' ? 'side by side' : 'unified'}`)}`;

	if (!diff.rows.length) return [header, '', dim('nothing differs')];

	const half = Math.floor((width - 3) / 2);
	const marked = markedRows(diff);
	const markedFrom = marked ? Math.min(diff.anchor, diff.cursor) : -1;
	const markedTo = marked ? Math.max(diff.anchor, diff.cursor) : -1;
	const [top, bottom] = windowAround(diff.cursor, diff.rows.length, room - 1);
	const rows = diff.rows.slice(top, bottom).map((row, offset) => {
		const index = top + offset;
		let text;

		if (row.kind === 'file')
			text = `${bold(
				`${colored(STATUS_LETTERS[row.file.status] ?? ' ', STATUS_MARKS[row.file.status]?.[1] ?? 252)} ${printable(row.file.from ? `${row.file.from} → ${row.file.path}` : row.file.path)}`,
			)}${row.label ? `  ${dim(row.label)}` : ''}`;
		else if (row.kind === 'message' || row.kind === 'folded') text = dim(printable(row.text));
		else if (row.kind === 'group') text = bold(colored(printable(row.text), HUNK_COLOR));
		else if (row.kind === 'hunk') text = colored(printable(row.text), HUNK_COLOR);
		else if (row.kind === 'pair') {
			const bar = (line, side) => commentBar(line && commented(diff.comments, row.path, line, side));

			text = `${diffSide(row.left, 'left', half, bar(row.left, 'old'))} ${dim('│')} ${diffSide(row.right, 'right', half, bar(row.right, 'new'))}`;
		} else {
			const [line] = row.lines;

			text = `${commentBar(commented(diff.comments, row.path, line))}${diffLine(line, dim(`${String(line.old ?? '').padStart(4)} ${String(line.new ?? '').padStart(4)}`))}`;
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
		const commentedHere = Object.values(file.comments ?? {}).some(
			where => where && where.from <= index + 1 && index + 1 <= where.to,
		);
		const rule = commentedHere ? colored('▌', COMMENT_COLOR) : dim('│');
		const text = `${inMark ? orange(number) : dim(number)} ${rule} ${file.highlighted?.[index] ?? line}`;

		if (index === file.cursor) return highlight(text, width, CURSOR_BACKGROUND);

		return inMark ? highlight(text, width, MARKED_BACKGROUND) : text;
	});

	return [fileHeader(file, `${file.cursor + 1}/${file.lines.length}`), ...rows];
};

// The tour over what it's about: its overview (with what it leaves out), or the stop it's on
const tourView = (tour, width) => {
	const words = text => wrap(printable(text), width);

	if (!tour.stops) return [bold(printable(tour.heading)), dim('Haiku is reading it...'), ''];

	const stop = tour.stops[tour.index - 1];
	const told = stop
		? [
				bold(
					`${tour.index} of ${tour.stops.length} · ${printable(stop.path)} ${lineRange(stop)}${stop.side === 'old' ? ' (before)' : ''}`,
				),
				...words(stop.text),
			]
		: [
				bold(`${printable(tour.heading)}: ${tour.stops.length} stop${tour.stops.length === 1 ? '' : 's'}`),
				...words(tour.overview),
				...(tour.leftOut?.length ? words(`Not in it: ${tour.leftOut.join(' ')}`).map(dim) : []),
			];

	return [...told.slice(0, TOUR_ROWS), ''];
};

export const browserView = (browser, width, room) => {
	if (browser.open?.tour) {
		const tour = tourView(browser.open.tour, width);

		return [...tour, ...fileView(browser, width, Math.max(room - tour.length, 3))];
	}
	if (browser.open) return fileView(browser, width, room);
	if (browser.search) return searchView(browser, width, room);

	return listView(browser, width, room);
};

export const browserKeys = (browser, canType, keyCap, canNote = false) => {
	const file = browser.open;

	if (file?.tour)
		return [`${keyCap('→')} next stop`, `${keyCap('←')} back`, `${keyCap('↑↓')} move`, `${keyCap('esc')} end the tour`];

	if (file?.diff) {
		const marked = file.anchor !== null;

		return [
			`${keyCap('↑↓')} move`,
			`${keyCap('v')} ${marked ? 'clear marks' : 'mark lines'}`,
			canType && `${keyCap('a')} attach ${marked ? 'marked lines' : 'all'}`,
			canNote && `${keyCap('M')} comment`,
			`${keyCap('y')} copy`,
			`${keyCap('o')} open file`,
			`${keyCap('s')} switch layout`,
			(file.set.files.length > 1 || Object.values(file.set.outlines ?? {}).some(outline => outline.length)) &&
				`${keyCap('O')} ${ORDERS[browser.prefs.diffOrder ?? 'reading'].label.toLowerCase()}`,
			`${keyCap('w')} walk me through`,
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
			canNote && !file.outside && `${keyCap('M')} comment on ${marked ? 'marked lines' : 'line'}`,
			`${keyCap('y')} copy ${marked ? 'marked lines' : 'file'}`,
			canType && `${keyCap('e')} edit`,
			changeOf(browser, file.path) && `${keyCap('c')} changes`,
			file.isMarkdown && `${keyCap('m')} rendered`,
			`${keyCap('w')} walk me through ${marked ? 'marked lines' : 'file'}`,
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
