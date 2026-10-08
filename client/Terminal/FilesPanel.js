import { Notify } from '@vanilla-bean/components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

import { pathFilter } from '../../shared/globs';
import { attachDiffText, attachFileText, attachLinesText } from '../../shared/attachText';
import relativeTime from '../../shared/relativeTime';
import { diffLines } from '../../shared/diff';
import { extensionOf, kindOf, matchNames } from '../../shared/projectFiles';
import searchPattern from '../../shared/searchPattern';
import {
	getChanges,
	getDiffSet,
	getGit,
	getSymbols,
	replaceInFiles,
	getTurnChanges,
	listFiles,
	rawFileUrl,
	readFile,
	saveFile,
	searchFiles,
} from '../api';
import { canType } from '../identity';
import { recall, remember } from '../storage';
import confirmDialog from '../confirmDialog';
import { button, closeButton, dragHandle, element } from '../dom';
import renderDiffSet from './DiffView';
import Panel, { LINE_HEIGHT } from './FilesPanel.styles';

const MAX_MATCHES = 200;
const TOUCH = window.matchMedia('(pointer: coarse)');
const SEARCH_DELAY_MS = 300;
const OPTIONS_KEY = 'paude.searchOptions';
const MARKDOWN_KEY = 'paude.markdownView';
const LIST_WIDTH_KEY = 'paude.filesListWidth';
const MIN_LIST_WIDTH = 140;
const MIN_VIEWER_WIDTH = 200;
const DIFF_LAYOUT_KEY = 'paude.diffLayout';
// Narrower than this, side by side leaves too little of each line
const SPLIT_MIN_WIDTH = 700;

const iconButton = (name, title, onPress) => button('', onPress, { icon: name, title, className: 'icon-only' });

const BRAND_ICONS = {
	js: 'js',
	mjs: 'js',
	cjs: 'js',
	jsx: 'react',
	tsx: 'react',
	py: 'python',
	md: 'markdown',
	mdx: 'markdown',
	css: 'css3',
	scss: 'sass',
	html: 'html5',
	htm: 'html5',
	rs: 'rust',
	go: 'golang',
	java: 'java',
	php: 'php',
	vue: 'vuejs',
	dockerfile: 'docker',
	gitignore: 'git-alt',
	gitattributes: 'git-alt',
};

const SOLID_ICONS = {
	ts: 'file-code',
	json: 'file-code',
	xml: 'file-code',
	c: 'file-code',
	h: 'file-code',
	cpp: 'file-code',
	rb: 'file-code',
	kt: 'file-code',
	swift: 'file-code',
	sh: 'terminal',
	zsh: 'terminal',
	bash: 'terminal',
	sql: 'database',
	db: 'database',
	sqlite: 'database',
	lock: 'lock',
	yml: 'gear',
	yaml: 'gear',
	toml: 'gear',
	ini: 'gear',
	conf: 'gear',
	cfg: 'gear',
	env: 'gear',
	csv: 'file-csv',
	pdf: 'file-pdf',
	zip: 'file-zipper',
	gz: 'file-zipper',
	tar: 'file-zipper',
	tgz: 'file-zipper',
	txt: 'file-lines',
	log: 'file-lines',
	doc: 'file-word',
	docx: 'file-word',
	xls: 'file-excel',
	xlsx: 'file-excel',
	ppt: 'file-powerpoint',
	pptx: 'file-powerpoint',
};

const ICON_COLORS = {
	js: '#f1e05a',
	mjs: '#f1e05a',
	cjs: '#f1e05a',
	jsx: '#61dafb',
	tsx: '#61dafb',
	ts: '#3178c6',
	py: '#4b8bbe',
	md: '#7fb2e8',
	mdx: '#7fb2e8',
	css: '#5a9bd5',
	scss: '#cd6799',
	html: '#e44d26',
	htm: '#e44d26',
	rs: '#dea584',
	go: '#00add8',
	java: '#e76f00',
	php: '#8892bf',
	vue: '#41b883',
	rb: '#cc342d',
	kt: '#a97bff',
	swift: '#f05138',
	c: '#a8b9cc',
	h: '#a8b9cc',
	cpp: '#f34b7d',
	json: '#cbcb41',
	xml: '#e37933',
	sh: '#89e051',
	zsh: '#89e051',
	bash: '#89e051',
	sql: '#e38c00',
	db: '#e38c00',
	sqlite: '#e38c00',
	csv: '#89e051',
	pdf: '#f40f02',
	zip: '#d4a72c',
	gz: '#d4a72c',
	tar: '#d4a72c',
	tgz: '#d4a72c',
	dockerfile: '#2496ed',
	gitignore: '#f05033',
	gitattributes: '#f05033',
	yml: '#cb171e',
	yaml: '#cb171e',
	toml: '#9c4221',
	doc: '#2b579a',
	docx: '#2b579a',
	xls: '#217346',
	xlsx: '#217346',
	ppt: '#d24726',
	pptx: '#d24726',
};
const KIND_COLORS = { image: '#a074c4', video: '#e06c75', audio: '#56b6c2' };
const FOLDER_COLOR = '#dcb67a';
const PLAIN_COLOR = '#9da5b4';

const icon = (className, color) => {
	const node = element('i', className);

	node.style.color = color;

	return node;
};

const fileIcon = path => {
	const extension = extensionOf(path);
	const kind = kindOf(path);
	const color = ICON_COLORS[extension] ?? KIND_COLORS[kind] ?? PLAIN_COLOR;

	if (path.split('/').at(-1) === 'package.json') return icon('fa-brands fa-npm', '#cb3837');
	if (BRAND_ICONS[extension]) return icon(`fa-brands fa-${BRAND_ICONS[extension]}`, color);
	if (kind === 'image') return icon('fa-solid fa-file-image', color);
	if (kind === 'video') return icon('fa-solid fa-file-video', color);
	if (kind === 'audio') return icon('fa-solid fa-file-audio', color);

	return icon(`fa-solid fa-${SOLID_ICONS[extension] ?? 'file'}`, color);
};

// The syntax font's palettes cover JavaScript-like code, JSON, HTML and CSS; anything else reads better plain
const LANGUAGES = {
	json: 'json',
	html: 'html',
	htm: 'html',
	xml: 'html',
	svg: 'html',
	vue: 'html',
	css: 'css',
	scss: 'css',
	less: 'css',
};
const CODE_LIKE = new Set([
	'js',
	'mjs',
	'cjs',
	'jsx',
	'ts',
	'tsx',
	'c',
	'h',
	'cpp',
	'java',
	'go',
	'rs',
	'php',
	'py',
	'rb',
	'kt',
	'swift',
	'sh',
	'zsh',
	'bash',
]);

const languageOf = path => {
	const extension = extensionOf(path);

	return LANGUAGES[extension] ?? (CODE_LIKE.has(extension) ? 'javascript' : null);
};

const buildTree = paths => {
	const root = { folders: new Map(), files: [] };

	for (const path of paths) {
		const parts = path.split('/');
		let node = root;

		for (const folder of parts.slice(0, -1)) {
			if (!node.folders.has(folder)) node.folders.set(folder, { folders: new Map(), files: [] });
			node = node.folders.get(folder);
		}

		node.files.push(path);
	}

	return root;
};

// How the tree and the changes list mark a changed file, as VS Code does
const STATUS_MARKS = {
	modified: { letter: 'M', title: 'Modified' },
	added: { letter: 'A', title: 'Added' },
	deleted: { letter: 'D', title: 'Deleted' },
	renamed: { letter: 'R', title: 'Renamed' },
	untracked: { letter: 'U', title: 'Untracked' },
};

const statusMark = status => {
	const mark = element('span', `status ${status}`, STATUS_MARKS[status].letter);

	mark.title = STATUS_MARKS[status].title;

	return mark;
};

const savedOptions = () => {
	try {
		return {
			caseSensitive: false,
			wholeWord: false,
			regex: false,
			include: '',
			exclude: '',
			...JSON.parse(recall(OPTIONS_KEY)),
		};
	} catch {
		return { caseSensitive: false, wholeWord: false, regex: false, include: '', exclude: '' };
	}
};

// A link or image in a markdown file, relative to that file, as a project path; null for anything elsewhere
const projectPathFrom = (file, reference) => {
	if (!reference || /^(?:[a-z][\w+.-]*:|\/\/|#)/i.test(reference)) return null;

	const parts = reference.startsWith('/') ? [] : file.split('/').slice(0, -1);

	for (const part of reference.split(/[?#]/)[0].split('/')) {
		if (part === '..') parts.pop();
		else if (part && part !== '.') parts.push(decodeURIComponent(part));
	}

	return parts.join('/');
};

export default class FilesPanel extends Panel {
	build() {
		document.addEventListener('selectionchange', () => this.offerNameActions());
		this.paths = [];
		this.changes = null;
		this.expanded = new Set();
		this.mode = 'names';
		this.selection = null;
		this.searchOptions = savedOptions();
		this.markdownView = recall(MARKDOWN_KEY) === 'source' ? 'source' : 'rendered';

		const bar = element('div', 'bar');
		const search = element('div', 'search');

		this.query = element('input');
		this.query.addEventListener('input', () => this.renderList());
		this.toggles = {
			caseSensitive: button('Aa', () => this.toggleOption('caseSensitive'), {
				title: 'Match case',
				className: 'toggle',
			}),
			wholeWord: button('ab', () => this.toggleOption('wholeWord'), { title: 'Match whole word', className: 'toggle' }),
			regex: button('.*', () => this.toggleOption('regex'), { title: 'Use regular expression', className: 'toggle' }),
		};
		search.append(this.query, ...Object.values(this.toggles));

		this.modeButtons = {
			names: button('Names', () => this.setMode('names')),
			contents: button('Contents', () => this.setMode('contents')),
			symbols: button('Symbols', () => this.setMode('symbols'), {
				title: 'Where functions, classes and types are defined',
			}),
			changes: button('Changes', () => this.setMode('changes'), { title: 'What changed since the last commit' }),
		};
		this.changeCount = element('span', 'count');
		this.modeButtons.changes.append(this.changeCount);
		this.filtersButton = iconButton('filter', 'Files to include and exclude', () => this.toggleFilters());
		this.fullscreenButton = iconButton('expand', 'Full screen', () => this.toggleFullscreen());
		bar.append(
			search,
			this.modeButtons.names,
			this.modeButtons.contents,
			this.modeButtons.symbols,
			this.modeButtons.changes,
			this.filtersButton,
			this.fullscreenButton,
			closeButton(() => this.options.close()),
		);

		this.filters = element('div', 'filters');
		this.include = this.filterInput('include', 'files to include, e.g. src, *.js');
		this.exclude = this.filterInput('exclude', 'files to exclude, e.g. **/*.test.js');
		this.filters.append(this.include, this.exclude);
		this.filters.classList.toggle('shown', Boolean(this.searchOptions.include || this.searchOptions.exclude));

		this.panes = element('div', 'panes');
		this.list = element('div', 'list');
		this.viewer = element('div', 'viewer');
		this.panes.append(this.list, this.splitter(), this.viewer);
		// Full screen, the splitter or the window can carry the viewer across the width side by side needs
		new ResizeObserver(() => {
			if (this.view === 'diff' && this.diffSet && this.renderedLayout !== this.diffLayout) this.renderViewer();
		}).observe(this.viewer);
		this.replaceRow = this.replaceControls();
		this.elem.append(bar, this.filters, this.replaceRow, this.panes);
		this.elem.tabIndex = -1;

		// Esc steps back out of full screen first, then closes the panel
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;

			event.stopPropagation();
			if (this.comparing) this.stopComparing();
			else if (this.isFullscreen) this.toggleFullscreen(false);
			else this.options.close();
		});

		this.setMode('names');
	}

	splitter() {
		const handle = element('div', 'splitter');
		const setWidth = width => {
			const clamped = Math.round(Math.min(Math.max(width, MIN_LIST_WIDTH), this.panes.clientWidth - MIN_VIEWER_WIDTH));

			this.panes.style.setProperty('--list-width', `${clamped}px`);

			return clamped;
		};

		if (Number(recall(LIST_WIDTH_KEY))) this.panes.style.setProperty('--list-width', `${recall(LIST_WIDTH_KEY)}px`);

		let left;

		dragHandle(handle, {
			onStart: () => {
				left = this.list.getBoundingClientRect().left;
				handle.classList.add('dragging');
			},
			onMove: event => setWidth(event.clientX - left),
			onDone: event => {
				remember(LIST_WIDTH_KEY, String(setWidth(event.clientX - left)));
				handle.classList.remove('dragging');
			},
		});

		return handle;
	}

	filterInput(key, placeholder) {
		const input = element('input');

		input.placeholder = placeholder;
		input.value = this.searchOptions[key];
		input.addEventListener('input', () => {
			this.searchOptions[key] = input.value;
			this.saveOptions();
			this.renderList();
		});

		return input;
	}

	saveOptions() {
		remember(OPTIONS_KEY, JSON.stringify(this.searchOptions));
	}

	toggleOption(key) {
		this.searchOptions[key] = !this.searchOptions[key];
		this.saveOptions();
		this.renderToggles();
		this.renderList();
	}

	toggleFilters() {
		this.filters.classList.toggle('shown');
		this.renderToggles();
	}

	renderToggles() {
		for (const [key, node] of Object.entries(this.toggles)) {
			node.classList.toggle('active', Boolean(this.searchOptions[key]));
		}

		this.filtersButton.classList.toggle(
			'active',
			this.filters.classList.contains('shown') || Boolean(this.searchOptions.include || this.searchOptions.exclude),
		);
	}

	toggleFullscreen(on = !this.isFullscreen) {
		this.isFullscreen = on;
		this.options.setFullscreen(on);
		this.fullscreenButton.firstChild.className = `fa-solid fa-${on ? 'compress' : 'expand'}`;
		this.fullscreenButton.title = on ? 'Leave full screen' : 'Full screen';
	}

	async refresh() {
		const [{ body, response }] = await Promise.all([listFiles(this.options.sessionId), this.refreshChanges()]);

		if (!response?.ok) {
			this.list.replaceChildren(
				element(
					'div',
					'empty',
					response?.status === 403 ? 'Your invite does not include files.' : 'Could not list files.',
				),
			);

			return;
		}

		this.paths = body;
		this.renderList();
		if (!this.view) this.viewer.replaceChildren(element('div', 'empty', 'Pick a file to read it.'));
	}

	// null outside git, which hides the Changes mode
	// What changed: since the last commit (null outside git), what Claude proposes, and each turn's edits
	async refreshChanges() {
		const id = this.options.sessionId;
		const [changes, turns, proposal] = await Promise.all([
			getChanges(id),
			getTurnChanges(id),
			getDiffSet(id, { source: 'proposal' }),
		]);

		this.changes = changes.response?.ok ? changes.body : null;
		this.turns = turns.response?.ok ? turns.body : [];
		this.proposal = proposal.response?.ok && proposal.body.files.length ? proposal.body : null;
		this.changedPaths = new Map((this.changes ?? []).map(change => [change.path, change]));
		this.modeButtons.changes.style.display = this.changes || this.turns.length || this.proposal ? '' : 'none';
		this.changeCount.textContent = this.changes?.length ? String(this.changes.length) : '';
		this.modeButtons.changes.classList.toggle('proposing', Boolean(this.proposal));
		if (this.modeButtons.changes.style.display === 'none' && this.mode === 'changes') this.mode = 'names';
	}

	// Only an open list showing the changes refreshes; the rest catch up when opened
	changesMayHaveChanged() {
		if (this.elem.classList.contains('open') && this.mode === 'changes')
			this.refreshChanges().then(() => this.mode === 'changes' && this.renderList());
	}

	setMode(mode) {
		this.mode = mode;
		this.replaceRow.classList.toggle('shown', mode === 'contents' && canType());
		this.query.placeholder = {
			names: 'Find a file',
			contents: 'Search file contents',
			symbols: 'Find a function, class or type',
			changes: 'Find a changed file',
		}[mode];

		for (const [key, node] of Object.entries(this.modeButtons)) node.classList.toggle('active', key === mode);

		this.renderToggles();
		this.renderList();
		if (mode === 'changes') this.refreshChanges().then(() => this.mode === 'changes' && this.renderList());
	}

	renderList() {
		const query = this.query.value.trim();
		const wanted = pathFilter(this.searchOptions);
		const paths = this.paths.filter(wanted);

		clearTimeout(this.searchTimer);

		if (this.mode === 'changes') return this.renderChanges(query);
		if (!query && this.mode === 'contents') return this.list.replaceChildren(this.todoOffer());
		if (!query) return this.list.replaceChildren(...this.comparingNotice(), ...this.treeEntries(buildTree(paths), 0));

		if (this.mode === 'contents') {
			this.searchTimer = setTimeout(() => this.searchContents(query), SEARCH_DELAY_MS);

			return;
		}

		if (this.mode === 'symbols') {
			this.searchTimer = setTimeout(async () => {
				const { body } = await getSymbols(this.options.sessionId, { q: query });

				if (this.query.value.trim() === query && this.mode === 'symbols')
					this.showSymbols(body ?? [], body?.length ? null : 'No definitions match.');
			}, SEARCH_DELAY_MS);

			return;
		}

		const matches = matchNames(this.paths, query, this.searchOptions);

		if (matches === null)
			return this.list.replaceChildren(element('div', 'empty', 'That regular expression is not valid.'));

		this.list.replaceChildren(
			...this.comparingNotice(),
			...(matches.length
				? matches.slice(0, MAX_MATCHES).map(path => this.fileEntry(path, path))
				: [element('div', 'empty', 'No file names match.')]),
		);
	}

	renderChanges(query) {
		const changes = this.changes ?? [];
		const shown = query
			? (matchNames(
					changes.map(({ path }) => path),
					query,
					this.searchOptions,
				) ?? [])
			: changes.map(({ path }) => path);
		const turns = query
			? this.turns.filter(({ prompt }) => prompt.toLowerCase().includes(query.toLowerCase()))
			: this.turns;
		const entries = [];

		if (this.proposal && !query) {
			const count = this.proposal.files.length;
			const entry = element('div', 'entry proposal');

			entry.append(
				icon('fa-solid fa-hand', '#e5c07b'),
				element('span', 'label', `Claude proposes ${count === 1 ? 'a change' : `${count} changes`}`),
			);
			entry.addEventListener('click', () => this.openDiffSet({ source: 'proposal' }));
			entries.push(entry);
		}

		if (this.changes) {
			entries.push(element('div', 'section', 'Since the last commit'));
			if (!changes.length) entries.push(element('div', 'empty', 'Nothing yet.'));
			else if (!shown.length) entries.push(element('div', 'empty', 'No changed file names match.'));
			entries.push(...shown.map(path => this.fileEntry(path, path, undefined, { diff: true })));
		}

		if (this.turns.length) {
			entries.push(element('div', 'section', "Claude's turns"));
			entries.push(...turns.map(turn => this.turnEntry(turn)));
		}

		this.list.replaceChildren(...entries);
	}

	turnEntry(turn) {
		const entry = element('div', `entry turn${this.diffSource?.turn === turn.id ? ' current' : ''}`);

		entry.append(
			icon('fa-solid fa-comment', PLAIN_COLOR),
			element('span', 'label', turn.prompt),
			element('span', 'detail', `${turn.files} · ${relativeTime(Date.parse(turn.at))}`),
		);
		entry.title = turn.prompt;
		entry.addEventListener('click', () => this.openDiffSet({ source: 'turn', turn: turn.id }));

		return entry;
	}

	// Under the contents search: what to put in place of every match, across the project
	replaceControls() {
		const row = element('form', 'replace');
		const replacement = element('input');

		replacement.placeholder = 'Replace every match with…';
		row.append(
			replacement,
			button('Replace all', () => {}, { className: 'primary' }),
		);
		row.addEventListener('submit', async event => {
			event.preventDefault();

			const query = this.query.value.trim();

			if (query.length < 2)
				return new Notify({ type: 'warning', content: 'Search for something first.', timeout: 2500 });

			const shown = this.list.querySelectorAll('.entry').length;
			const confirmed = await confirmDialog({
				header: `Replace every match of ${query}?`,
				body: `With "${replacement.value}", in every file it's in: ${shown} match${shown === 1 ? '' : 'es'} are listed, and any beyond the list too. Git's Changes shows what it did.`,
				confirmLabel: 'Replace all',
			});

			if (!confirmed) return;

			const { body, response } = await replaceInFiles(
				this.options.sessionId,
				query,
				this.searchOptions,
				replacement.value,
			);

			if (!response?.ok)
				return new Notify({ type: 'error', content: typeof body === 'string' ? body : 'Could not replace.' });

			new Notify({
				type: 'success',
				content: `Replaced ${body.replacements} in ${body.files} file${body.files === 1 ? '' : 's'}`,
				timeout: 3000,
			});
			this.changesMayHaveChanged();
			this.renderList();
		});

		return row;
	}

	// The project's to-dos (TODO, FIXME, HACK, XXX), on offer when the contents search is empty
	todoOffer() {
		const offer = element('div', 'empty');

		offer.append(
			'Search the files, or ',
			button('list the to-dos', async () => {
				const options = { regex: true, wholeWord: true, caseSensitive: true };
				const { body, response } = await searchFiles(this.options.sessionId, 'TODO|FIXME|HACK|XXX', options);

				if (!response?.ok) return;

				const hits = JSON.parse(body);

				this.list.replaceChildren(
					element('div', 'list-heading', `${hits.length}${hits.length >= 300 ? '+' : ''} to-dos`),
					...(hits.length
						? hits.map(hit => {
								const entry = this.fileEntry(`${hit.path}:${hit.line}`, hit.path, hit.line);

								entry.append(element('span', 'snippet', hit.text.trim()));

								return entry;
							})
						: [element('div', 'empty', 'None. Tidy.')]),
				);
			}),
			' (TODO, FIXME, HACK, XXX).',
		);

		return offer;
	}

	// Symbols as entries: their kind and name, where they are; one opens its file at the line
	showSymbols(symbols, empty, heading) {
		this.list.replaceChildren(
			...(heading ? [element('div', 'list-heading', heading)] : []),
			...(symbols.length
				? symbols.map(symbol => {
						const entry = this.fileEntry(symbol.name, symbol.file, symbol.line);

						entry.prepend(element('span', `symbol-kind ${symbol.kind}`, symbol.kind[0]));
						entry.append(element('span', 'where', `${symbol.file}:${symbol.line}`));

						return entry;
					})
				: [element('div', 'empty', empty)]),
		);
	}

	// Where a name is defined: straight there when there's one place, a list to choose from when there are more
	async goToDefinition(name) {
		const { body } = await getSymbols(this.options.sessionId, { name, from: this.current ?? '' });

		if (!body?.length)
			return new Notify({ type: 'warning', content: `No definition of ${name} found.`, timeout: 2500 });
		if (body.length === 1) return this.open(body[0].file, body[0].line);

		this.showSymbols(body, '', `${body.length} definitions of ${name}`);
	}

	// Everywhere the name is used, as a whole word
	async findReferences(name) {
		const options = { caseSensitive: true, wholeWord: true };
		const { body, response } = await searchFiles(this.options.sessionId, name, options);

		if (!response?.ok) return;

		const hits = JSON.parse(body);

		this.list.replaceChildren(
			element('div', 'list-heading', `${hits.length}${hits.length >= 200 ? '+' : ''} uses of ${name}`),
			...hits.map(hit => {
				const entry = this.fileEntry(`${hit.path}:${hit.line}`, hit.path, hit.line);

				entry.append(this.highlighted(hit.text.trim(), name, options));

				return entry;
			}),
		);
	}

	// The open file's own symbols, in order, in the list beside it
	async showOutline() {
		const path = this.current;
		const { body } = await getSymbols(this.options.sessionId, { file: path });

		if (this.current !== path) return;
		this.showSymbols(body ?? [], 'No functions, classes or types found in it.', `Outline of ${path.split('/').at(-1)}`);
	}

	// A name selected in the code (by a double-click, or a long press on a phone) offers both, beside the file's name
	offerNameActions() {
		if (!this.nameActions?.isConnected) return;

		const selection = window.getSelection();
		const name = selection.toString().trim();
		const inCode = selection.anchorNode && this.body?.querySelector('code')?.contains(selection.anchorNode);

		if (!inCode || !/^[A-Za-z_$][\w$]*$/.test(name)) return this.nameActions.replaceChildren();

		this.nameActions.replaceChildren(
			button('Definition', () => this.goToDefinition(name), { title: `Where ${name} is defined` }),
			button('Uses', () => this.findReferences(name), { title: `Everywhere ${name} is used` }),
		);
	}

	// The name at a point in the code, for Ctrl/Cmd+click
	nameAt(x, y) {
		// The standard one where there is one (Firefox), WebKit's own elsewhere
		// eslint-disable-next-line compat/compat
		const caret = document.caretPositionFromPoint?.(x, y) ?? document.caretRangeFromPoint?.(x, y);
		const node = caret?.offsetNode ?? caret?.startContainer;
		const offset = caret?.offset ?? caret?.startOffset;

		if (!node || node.nodeType !== Node.TEXT_NODE) return null;

		const text = node.textContent;
		let start = offset;
		let end = offset;

		while (start > 0 && /[\w$]/.test(text[start - 1])) start -= 1;
		while (end < text.length && /[\w$]/.test(text[end])) end += 1;

		const name = text.slice(start, end);

		return /^[A-Za-z_$][\w$]*$/.test(name) ? name : null;
	}

	async searchContents(query) {
		this.list.replaceChildren(element('div', 'empty', 'Searching...'));

		const options = { ...this.searchOptions };
		const { body, response } = await searchFiles(this.options.sessionId, query, options);

		if (this.query.value.trim() !== query || this.mode !== 'contents') return;
		if (!response?.ok) return this.list.replaceChildren(element('div', 'empty', body || 'Search failed.'));

		const hits = JSON.parse(body);

		if (!hits.length) return this.list.replaceChildren(element('div', 'empty', 'Nothing found.'));

		this.list.replaceChildren(
			...hits.map(hit => {
				const entry = this.fileEntry(`${hit.path}:${hit.line}`, hit.path, hit.line);

				entry.append(this.highlighted(hit.text.trim(), query, options));

				return entry;
			}),
		);
	}

	highlighted(text, query, options) {
		const node = element('span', 'hit-text');
		const pattern = searchPattern(query, options, 'g');

		if (!pattern) {
			node.textContent = text;

			return node;
		}

		let last = 0;

		for (const match of text.matchAll(pattern)) {
			if (!match[0]) break;
			node.append(text.slice(last, match.index), element('mark', '', match[0]));
			last = match.index + match[0].length;
		}

		node.append(text.slice(last));

		return node;
	}

	treeEntries(node, depth) {
		const indent = entry => {
			entry.style.paddingLeft = `${4 + depth * 14}px`;

			return entry;
		};
		const folders = [...node.folders].sort(([a], [b]) => a.localeCompare(b));
		const entries = [];

		for (const [name, child] of folders) {
			const key = `${depth}:${name}:${child.files[0] ?? ''}`;
			const open = this.expanded.has(key);
			const entry = indent(element('div', 'entry folder'));

			entry.append(
				icon(`fa-solid fa-${open ? 'folder-open' : 'folder'}`, FOLDER_COLOR),
				element('span', 'label', name),
			);
			if (!open && this.changedInside(child)) {
				const dot = element('span', 'status modified', '•');

				dot.title = 'Something in here changed';
				entry.append(dot);
			}
			entry.addEventListener('click', () => {
				if (open) this.expanded.delete(key);
				else this.expanded.add(key);
				this.renderList();
			});
			entries.push(entry, ...(open ? this.treeEntries(child, depth + 1) : []));
		}

		for (const path of node.files) entries.push(indent(this.fileEntry(path.split('/').at(-1), path)));

		return entries;
	}

	changedInside(node) {
		return (
			node.files.some(path => this.changedPaths?.has(path)) ||
			[...node.folders.values()].some(child => this.changedInside(child))
		);
	}

	fileEntry(label, path, line, { diff = false } = {}) {
		const entry = element('div', `entry${path === this.current ? ' current' : ''}`);
		const change = this.changedPaths?.get(path);

		entry.append(fileIcon(path), element('span', 'label', label));
		if (change) entry.append(statusMark(change.status));
		entry.dataset.path = path;
		entry.title = change?.from ? `${path} (from ${change.from})` : path;
		entry.addEventListener('click', () => {
			if (this.comparing && !diff) {
				const first = this.comparing;

				this.comparing = null;
				this.openDiffSet({ source: 'files', a: first, b: path });
			} else if (diff) this.openDiff(path);
			else this.open(path, line);
		});

		return entry;
	}

	// An edit not yet saved is lost by leaving it, so leaving asks first
	async leaveEditing() {
		if (!this.editing || this.editing.text === this.text) {
			this.editing = null;

			return true;
		}

		const leave = await confirmDialog({
			header: 'Leave your edit unsaved?',
			body: `Your changes to ${this.current} haven't been saved.`,
			cancelLabel: 'Keep editing',
			confirmLabel: 'Discard them',
		});

		if (leave) this.editing = null;

		return leave;
	}

	openDiff(path) {
		return this.openDiffSet({ source: 'changes', path });
	}

	// Any kind of diff: a changed file, a turn, a proposal, or two files compared
	async openDiffSet(source) {
		if (!(await this.leaveEditing())) return;

		const single = source.path ?? source.b ?? null;

		this.current = single;
		this.view = 'diff';
		this.kind = single ? kindOf(single) : 'text';
		this.diffSource = source;
		this.diffSet = null;
		this.diffSelection = null;
		this.failure = null;
		this.panes.classList.add('reading');
		this.markCurrent(single);
		if (this.mode === 'changes') this.renderList();

		const { body, response } = await getDiffSet(this.options.sessionId, source);

		if (this.diffSource !== source) return;

		if (response?.ok) this.diffSet = body;
		else this.failure = typeof body === 'string' ? body : 'Could not show the changes.';
		this.renderViewer();
	}

	markCurrent(path) {
		this.list
			.querySelectorAll('.entry')
			.forEach(entry => entry.classList.toggle('current', entry.dataset.path === path));
	}

	async open(path, line, lastLine = line) {
		if (!(await this.leaveEditing())) return;

		this.current = path;
		this.view = 'file';
		this.kind = kindOf(path);
		this.selection = line ? { anchor: line, from: line, to: lastLine } : null;
		this.fileHistory = null;
		this.blame = null;
		this.lines = null;
		this.conflict = null;
		this.panes.classList.add('reading');
		this.markCurrent(path);

		if (['image', 'video', 'audio', 'pdf'].includes(this.kind)) return this.renderViewer();

		const { body, response } = await readFile(this.options.sessionId, path);

		if (this.current !== path) return;

		if (!response?.ok) {
			this.failure = typeof body === 'string' ? body : 'Could not open it.';
			this.renderViewer();

			return;
		}

		this.failure = null;
		this.hash = response.headers.get('x-content-hash');
		this.text = body;
		this.lines = body.replace(/\n$/, '').split('\n');
		this.renderViewer();

		if (line) this.body.scrollTop = (line - 1) * LINE_HEIGHT - this.body.clientHeight / 2;
	}

	async toggleHistory() {
		if (this.fileHistory) {
			this.fileHistory = null;

			return this.renderViewer();
		}

		const path = this.current;
		const { body, response } = await getGit(this.options.sessionId, 'log', { path });

		if (this.current !== path) return;
		if (!response?.ok) return new Notify({ type: 'warning', content: 'No git history here.' });

		this.fileHistory = body;
		this.renderViewer();
	}

	historyList() {
		if (!this.fileHistory.length) return element('div', 'empty', 'Not committed yet.');

		const list = element('div', 'file-history');

		for (const commit of this.fileHistory) {
			const row = element('button', 'history-item');

			row.append(
				element('div', 'subject', commit.subject),
				element('div', 'meta', `${commit.short} · ${commit.author} · ${relativeTime(Date.parse(commit.date))}`),
			);
			row.title = 'Show this commit';
			row.addEventListener('click', () => this.openDiffSet({ source: 'commit', ref: commit.hash }));
			list.append(row);
		}

		return list;
	}

	async toggleBlame() {
		if (this.blame) {
			this.blame = null;

			return this.renderViewer();
		}

		const path = this.current;
		const { body, response } = await getGit(this.options.sessionId, 'blame', { path });

		if (this.current !== path) return;
		if (!response?.ok)
			return new Notify({ type: 'warning', content: typeof body === 'string' ? body : 'No blame for this file.' });

		this.blame = new Map(body.map(line => [line.line, line]));
		this.renderViewer();
	}

	// Beside the line numbers: who last changed each run of lines, the commit's subject on hover, the commit on click
	blameColumn() {
		const column = element('div', 'blame');

		this.lines.forEach((_, index) => {
			const line = this.blame.get(index + 1);
			const startsRun = line && this.blame.get(index)?.hash !== line.hash;
			const cell = element('div', '', startsRun ? `${line.short} ${line.author ?? ''}` : '');

			if (line) {
				cell.title = `${line.summary ?? ''} · ${line.author ?? ''} · ${line.date ? relativeTime(Date.parse(line.date)) : ''}`;
				cell.addEventListener('click', () => this.openDiffSet({ source: 'commit', ref: line.hash }));
			}
			column.append(cell);
		});

		return column;
	}

	get showingSource() {
		return this.kind === 'text' || (this.kind === 'markdown' && this.markdownView === 'source');
	}

	viewerHead() {
		if (this.view === 'diff') return this.diffHead();

		const head = element('div', 'head');
		const back = button('←', () => this.panes.classList.remove('reading'));
		const change = this.changedPaths?.get(this.current);

		back.className = 'back';
		const path = element('div', 'path', this.current);

		path.title = this.current;
		head.append(back, fileIcon(this.current), path);
		if (change) head.append(statusMark(change.status));

		if (this.editing) return this.editingHead(head);

		if (this.kind === 'markdown' && this.lines) {
			head.append(
				button(this.markdownView === 'rendered' ? 'Source' : 'Rendered', () => {
					this.markdownView = this.markdownView === 'rendered' ? 'source' : 'rendered';
					remember(MARKDOWN_KEY, this.markdownView);
					this.renderViewer();
				}),
			);
		}

		if (change) head.append(button('Changes', () => this.openDiff(this.current), { title: 'What changed in it' }));
		if (this.lines && this.showingSource) {
			this.nameActions = element('span', 'name-actions');
			head.append(
				button('Outline', () => this.showOutline(), { title: 'Its functions, classes and types, in the list' }),
				this.nameActions,
				button(this.fileHistory ? 'Text' : 'History', () => this.toggleHistory(), {
					title: 'The commits that changed it',
				}),
				button(this.blame ? 'No blame' : 'Blame', () => this.toggleBlame(), {
					title: 'Who last changed each line, and in which commit',
				}),
			);
		}
		if (this.lines)
			head.append(button('Compare...', () => this.startComparing(), { title: 'Compare it with another file' }));

		if (canType()) {
			if (this.lines && this.showingSource) head.append(button('Edit', () => this.startEditing(), { icon: 'pen' }));
			head.append(button('Attach file', () => this.attachFile()));

			if (this.selection && this.lines && this.showingSource) {
				const { from, to } = this.selection;

				head.append(
					button(from === to ? `Attach line ${from}` : `Attach lines ${from}-${to}`, () => this.attachLines()),
				);
			}
		}

		if (this.selection && this.lines && this.showingSource) head.append(button('Copy', () => this.copyLines()));
		if (this.kind !== 'text' && this.kind !== 'markdown') {
			const link = element('a', '', 'Open');

			link.href = rawFileUrl(this.options.sessionId, this.current);
			link.target = '_blank';
			link.rel = 'noopener';
			head.append(link);
		}

		return head;
	}

	get diffLayout() {
		if (this.viewer.clientWidth && this.viewer.clientWidth < SPLIT_MIN_WIDTH) return 'unified';

		return recall(DIFF_LAYOUT_KEY) === 'unified' ? 'unified' : 'split';
	}

	diffHead() {
		const head = element('div', 'head');
		const back = button('←', () => this.panes.classList.remove('reading'));
		const set = this.diffSet;
		const single = set?.files.length === 1 ? set.files[0] : null;
		const title = element('div', 'path', set?.title ?? '');
		const wide = !this.viewer.clientWidth || this.viewer.clientWidth >= SPLIT_MIN_WIDTH;

		back.className = 'back';
		title.title = set?.title ?? '';
		head.append(back, ...(single ? [fileIcon(single.path)] : []), title);

		if (wide)
			head.append(
				button(this.diffLayout === 'split' ? 'Unified' : 'Side by side', () => {
					remember(DIFF_LAYOUT_KEY, this.diffLayout === 'split' ? 'unified' : 'split');
					this.renderViewer();
				}),
			);

		if (single && single.status !== 'deleted' && this.paths.includes(single.path))
			head.append(button('Open file', () => this.open(single.path)));

		if (canType() && set?.files.length) {
			head.append(button('Attach all', () => this.attachDiffSet()));

			if (this.diffSelection) {
				const count = this.diffSelection.to - this.diffSelection.from + 1;

				head.append(button(`Attach ${count === 1 ? 'line' : `${count} lines`}`, () => this.attachPickedLines()));
			}
		}

		return head;
	}

	editingHead(head) {
		const dirty = this.editing.text !== this.text;

		head.append(
			element('span', 'editing', dirty ? 'Editing, not saved' : 'Editing'),
			button('Save', () => this.save(), { title: 'Save (Ctrl+S)', className: 'primary' }),
			button('Cancel', () => this.cancelEditing()),
		);

		return head;
	}

	renderViewer() {
		const scroll = this.body?.scrollTop ?? 0;

		this.body = element('div', 'body');

		if (this.failure && !['image', 'video', 'audio', 'pdf'].includes(this.kind)) {
			this.body.append(element('div', 'empty', this.failure));
		} else if (this.view === 'diff') {
			this.body.append(this.diff());
		} else if (this.editing) {
			this.body.append(this.editor());
		} else if (this.kind === 'image' || this.kind === 'video' || this.kind === 'audio' || this.kind === 'pdf') {
			this.body.append(this.media());
		} else if (this.fileHistory) {
			this.body.append(this.historyList());
		} else if (this.kind === 'markdown' && this.markdownView === 'rendered') {
			this.body.append(this.renderedMarkdown());
		} else {
			this.body.append(this.source());
		}

		this.viewer.replaceChildren(this.viewerHead(), ...(this.conflict ? [this.conflictNotice()] : []), this.body);
		this.body.scrollTop = scroll;
	}

	diff() {
		if (this.diffSet === null) return element('div', 'empty', 'Loading the changes...');

		this.renderedLayout = this.diffLayout;

		const { container, files } = renderDiffSet({
			set: this.diffSet,
			layout: this.renderedLayout,
			languageOf,
			selection: this.diffSelection,
			onPick: (file, index, event) => {
				const current = this.diffSelection?.file === file ? this.diffSelection : null;
				const extend =
					event.shiftKey || (TOUCH.matches && current && current.from === current.to && current.anchor !== index);
				const anchor = extend && current ? current.anchor : index;

				this.diffSelection = { file, anchor, from: Math.min(anchor, index), to: Math.max(anchor, index) };
				this.renderViewer();
			},
			onAttachLines: canType() ? (file, lines) => this.attachDiffLines(this.diffFiles[file].path, lines) : null,
		});

		this.diffFiles = files;

		return container;
	}

	attachDiffLines(path, lines) {
		this.options.attach(attachDiffText(path, diffLines(lines)));
	}

	attachPickedLines() {
		const { file, from, to } = this.diffSelection;

		this.attachDiffLines(this.diffFiles[file].path, this.diffFiles[file].lines.slice(from, to + 1));
	}

	attachDiffSet() {
		this.options.attach(
			this.diffFiles
				.filter(({ lines }) => lines.length)
				.map(({ path, lines }) => attachDiffText(path, diffLines(lines)))
				.join(''),
		);
	}

	comparingNotice() {
		if (!this.comparing) return [];

		const notice = element('div', 'comparing', `Pick a file to compare with ${this.comparing}`);

		notice.append(button('Cancel', () => this.stopComparing()));

		return [notice];
	}

	stopComparing() {
		this.comparing = null;
		this.renderList();
	}

	// Compare: the list picks the file to compare the open one with
	startComparing() {
		this.comparing = this.current;
		this.setMode('names');
		this.panes.classList.remove('reading');
	}

	// The syntax font colors the text being typed, the same as it does the source view
	editor() {
		const language = languageOf(this.current);
		const area = element('textarea', `editor syntax-highlighting ${language ? `language-${language}` : 'plain'}`);

		area.value = this.editing.text;
		area.spellcheck = false;
		area.addEventListener('input', () => {
			const wasDirty = this.editing.text !== this.text;

			this.editing.text = area.value;
			if (wasDirty !== (this.editing.text !== this.text)) this.refreshHead();
		});
		area.addEventListener('keydown', event => {
			if ((event.ctrlKey || event.metaKey) && event.key === 's') {
				event.preventDefault();
				this.save();
			} else if (event.key === 'Tab' && !event.shiftKey) {
				event.preventDefault();
				area.setRangeText('\t', area.selectionStart, area.selectionEnd, 'end');
				area.dispatchEvent(new Event('input'));
			} else if (event.key === 'Escape') {
				// Esc would close the panel; while editing it does nothing, and the edit stays
				event.stopPropagation();
			}
		});
		requestAnimationFrame(() => area.focus());

		return area;
	}

	refreshHead() {
		this.viewer.querySelector('.head')?.replaceWith(this.viewerHead());
	}

	startEditing() {
		this.editing = { text: this.text };
		this.selection = null;
		this.renderViewer();
	}

	async cancelEditing() {
		if (await this.leaveEditing()) {
			this.conflict = null;
			this.renderViewer();
		}
	}

	async save(hash = this.hash) {
		const { text } = this.editing;
		const { body, response } = await saveFile(this.options.sessionId, this.current, text, hash);

		if (response?.status === 409) {
			this.conflict = { text: body.text, hash: body.hash };
			this.renderViewer();

			return;
		}

		if (!response?.ok) {
			new Notify({ type: 'error', content: typeof body === 'string' ? body : 'Could not save it.' });

			return;
		}

		this.hash = body.hash;
		this.text = text;
		this.lines = text.replace(/\n$/, '').split('\n');
		this.editing = null;
		this.conflict = null;
		new Notify({ type: 'success', content: 'Saved', timeout: 1500 });
		await this.refreshChanges();
		this.renderList();
		this.renderViewer();
	}

	// Someone (Claude, most likely) saved the file after the edit began; neither version is dropped without a choice
	conflictNotice() {
		const notice = element('div', 'conflict', 'This file changed since you opened it.');

		notice.append(
			button('Save mine anyway', () => this.save(this.conflict.hash)),
			button('Load theirs', async () => {
				const discard = await confirmDialog({
					header: 'Drop your edit and load theirs?',
					body: `Your changes to ${this.current} will be lost.`,
					cancelLabel: 'Keep mine',
					confirmLabel: 'Load theirs',
				});

				if (!discard) return;

				this.text = this.conflict.text;
				this.hash = this.conflict.hash;
				this.lines = this.text.replace(/\n$/, '').split('\n');
				this.editing = null;
				this.conflict = null;
				this.renderViewer();
			}),
		);

		return notice;
	}

	media() {
		const holder = element('div', 'media');
		const url = rawFileUrl(this.options.sessionId, this.current);
		const tag = { image: 'img', video: 'video', audio: 'audio', pdf: 'iframe' }[this.kind];
		const node = element(tag);

		node.src = url;
		if (this.kind === 'video' || this.kind === 'audio') node.controls = true;
		if (this.kind === 'image') node.alt = this.current;
		node.addEventListener('error', () => holder.replaceChildren(element('div', 'empty', 'Could not show this file.')));
		holder.append(node);

		return holder;
	}

	// Someone else's markdown shown on paude's own page: the HTML is sanitized, and its relative images and links
	// point back into the project
	renderedMarkdown() {
		const container = element('div', 'markdown');

		// No forms, inputs or inline styles: a README could otherwise paint a convincing password prompt over the page
		container.innerHTML = DOMPurify.sanitize(marked.parse(this.text), {
			FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option'],
			FORBID_ATTR: ['style'],
		});

		for (const image of container.querySelectorAll('img[src]')) {
			const path = projectPathFrom(this.current, image.getAttribute('src'));

			if (path !== null) image.src = rawFileUrl(this.options.sessionId, path);
		}

		for (const link of container.querySelectorAll('a[href]')) {
			const path = projectPathFrom(this.current, link.getAttribute('href'));

			if (path !== null && this.paths.includes(path)) {
				link.addEventListener('click', event => {
					event.preventDefault();
					this.open(path);
				});
			} else if (!link.getAttribute('href').startsWith('#')) {
				link.target = '_blank';
				link.rel = 'noopener noreferrer';
			}
		}

		return container;
	}

	// One code block, so the syntax font sees whole constructs (comments, strings) across lines. Click a line
	// number to pick it; Shift+click another (or, on a touch screen, tap it) to pick the range between.
	source() {
		const wrapper = element('div', 'source');
		const gutter = element('div', 'gutter');
		const language = languageOf(this.current);
		const pre = element('pre');
		const code = element('code', language ? `language-${language}` : 'plain', this.lines.join('\n'));

		gutter.append(...this.lines.map((_, index) => element('div', '', String(index + 1))));
		gutter.addEventListener('click', event => {
			const number = Number(event.target.textContent);

			if (!number || event.target === gutter) return;

			const extend =
				event.shiftKey ||
				(TOUCH.matches &&
					this.selection &&
					this.selection.from === this.selection.to &&
					this.selection.anchor !== number);
			const anchor = extend && this.selection ? this.selection.anchor : number;

			this.selection = { anchor, from: Math.min(anchor, number), to: Math.max(anchor, number) };
			this.renderViewer();
		});

		if (this.selection) {
			const band = element('div', 'band');

			band.style.top = `${(this.selection.from - 1) * LINE_HEIGHT}px`;
			band.style.height = `${(this.selection.to - this.selection.from + 1) * LINE_HEIGHT}px`;
			wrapper.append(band);
		}

		pre.append(code);
		// Ctrl/Cmd+click a name: where it's defined; with Shift, everywhere it's used
		code.addEventListener('click', event => {
			if (!(event.ctrlKey || event.metaKey)) return;

			const name = this.nameAt(event.clientX, event.clientY);

			if (!name) return;
			event.preventDefault();
			if (event.shiftKey) this.findReferences(name);
			else this.goToDefinition(name);
		});
		code.title = 'Ctrl+click a name to go to where it is defined (with Shift, to where it is used)';
		wrapper.append(...(this.blame ? [this.blameColumn()] : []), gutter, pre);

		return wrapper;
	}

	selectedText() {
		const { from, to } = this.selection;

		return this.lines.slice(from - 1, to).join('\n');
	}

	// Claude Code reads an @-mentioned file itself
	attachFile() {
		this.options.attach(attachFileText(this.current));
	}

	attachLines() {
		const { from, to } = this.selection;

		this.options.attach(attachLinesText(this.current, from, to, this.selectedText()));
	}

	async copyLines() {
		try {
			await navigator.clipboard.writeText(this.selectedText());
			new Notify({ type: 'success', content: 'Copied', timeout: 1500 });
		} catch {
			new Notify({ type: 'warning', content: 'The browser would not allow copying here.' });
		}
	}
}
