import { Notify } from '@vanilla-bean/components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

import { pathFilter } from '../../shared/globs';
import { attachDiffText, attachFileText, attachLinesText } from '../../shared/attachText';
import relativeTime from '../../shared/relativeTime';
import { diffAnchor, diffLines } from '../../shared/diff';
import { ORDERS, describeFiles, orderFiles } from '../../shared/reviewOrder';
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
	tourOf,
} from '../api';
import { AskingCard } from '../Asking';
import { openMenu } from '../menu';
import { canNote, canType } from '../identity';
import { forget, recall, remember } from '../storage';
import confirmDialog from '../confirmDialog';
import { button, closeButton, dragHandle, element } from '../dom';
import { opensInViewer, viewImage } from '../imageViewer';
import { artifactUrl } from './ArtifactsPanel';
import renderDiffSet from './DiffView';
import stepThrough from './tour';
import Panel, { LINE_HEIGHT } from './FilesPanel.styles';
import FileManager from './FileManager';
import { codeEditor, createState, openSearchPanel } from './codeEditor';
import { copyWithNotice } from './copySelection';

const MAX_MATCHES = 200;
const TOUCH = window.matchMedia('(pointer: coarse)');
const SEARCH_DELAY_MS = 300;
const OPTIONS_KEY = 'paude.searchOptions';
const MARKDOWN_KEY = 'paude.markdownView';
const LIST_WIDTH_KEY = 'paude.filesListWidth';
const MIN_LIST_WIDTH = 140;
const MIN_VIEWER_WIDTH = 200;
const DIFF_LAYOUT_KEY = 'paude.diffLayout';
const DIFF_ORDER_KEY = 'paude.diffOrder';
// Narrower than this, side by side leaves too little of each line
const SPLIT_MIN_WIDTH = 700;
const WRAP_KEY = 'paude.editorWrap';
const DRAFT_PREFIX = 'paude.draft.';
const DRAFT_DELAY_MS = 400;
const DRAFT_KEPT_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_HISTORY = 50;
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

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

// Folders come from the files in them; `folders` adds ones with nothing in them yet
const buildTree = (paths, folders = []) => {
	const root = { folders: new Map(), files: [] };

	for (const path of [...paths, ...folders.map(folder => `${folder}/`)]) {
		const parts = path.split('/');
		let node = root;

		for (const folder of parts.slice(0, -1)) {
			if (!node.folders.has(folder)) node.folders.set(folder, { folders: new Map(), files: [] });
			node = node.folders.get(folder);
		}

		if (parts.at(-1)) node.files.push(path);
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

// Back and forward from the keyboard: Alt+Left and Alt+Right, or Ctrl+- and Ctrl+Shift+- on a Mac, as VS Code has them.
// Not while typing, where Alt+Left moves the caret. -1, 1, or 0 for neither.
const travelKey = event => {
	if (event.defaultPrevented || event.target.closest('input, textarea, .cm-editor')) return 0;
	if (event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
		if (event.key === 'ArrowLeft') return -1;
		if (event.key === 'ArrowRight') return 1;
	}
	if (MAC && event.ctrlKey && !event.metaKey && !event.altKey && event.code === 'Minus') return event.shiftKey ? 1 : -1;

	return 0;
};

// Drafts from sessions long finished aren't kept forever
const pruneDrafts = () => {
	try {
		for (const key of Object.keys(localStorage).filter(found => found.startsWith(DRAFT_PREFIX))) {
			const at = JSON.parse(localStorage.getItem(key) || 'null')?.at ?? 0;

			if (Date.now() - at > DRAFT_KEPT_MS) localStorage.removeItem(key);
		}
	} catch {
		// Storage refused: nothing kept to prune
	}
};

export default class FilesPanel extends Panel {
	build() {
		document.addEventListener('selectionchange', () => this.offerNameActions());
		this.paths = [];
		this.changes = null;
		this.expanded = new Set();
		// Git lists files, never an empty folder, so the folders made here stay in the tree until the page reloads
		this.madeFolders = new Set();
		this.manager = new FileManager(this);
		this.past = [];
		this.future = [];
		pruneDrafts();
		this.mode = 'names';
		this.selection = null;
		this.searchOptions = savedOptions();
		this.markdownView = recall(MARKDOWN_KEY) === 'source' ? 'source' : 'rendered';
		this.tour = null;
		this.tourCard = new AskingCard({ addClass: 'tour-strip' });

		const bar = element('div', 'bar');
		const search = element('div', 'search');

		this.query = element('input');
		this.query.addEventListener('input', () => {
			// As in VS Code's Ctrl+P, a # first looks for a function, class or type instead
			if (this.mode === 'names' && this.query.value.startsWith('#')) {
				this.query.value = this.query.value.slice(1);
				this.setMode('symbols');
			} else this.renderList();
		});
		this.toggles = {
			caseSensitive: button('Aa', () => this.toggleOption('caseSensitive'), {
				title: 'Match case',
				className: 'toggle variant-flat',
			}),
			wholeWord: button('ab', () => this.toggleOption('wholeWord'), {
				title: 'Match whole word',
				className: 'toggle variant-flat',
			}),
			regex: button('.*', () => this.toggleOption('regex'), {
				title: 'Use regular expression',
				className: 'toggle variant-flat',
			}),
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
		const newButton = iconButton('plus', 'New file or folder', () =>
			openMenu(newButton, [
				{ label: 'New file...', onPress: () => this.manager.create() },
				{ label: 'New folder...', onPress: () => this.manager.create({ folder: true }) },
				{ label: 'Upload files...', onPress: () => this.manager.pickUploads(this.here ?? '') },
				{ label: 'Upload a folder...', onPress: () => this.manager.pickUploads(this.here ?? '', { folder: true }) },
			]),
		);

		newButton.style.display = canType() ? '' : 'none';
		bar.append(
			search,
			this.modeButtons.names,
			this.modeButtons.contents,
			this.modeButtons.symbols,
			this.modeButtons.changes,
			newButton,
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
		this.manager.decorateList(this.list);
		this.viewer = element('div', 'viewer');
		this.panes.append(this.list, this.splitter(), this.viewer);
		// Full screen, the splitter or the window can carry the viewer across the width side by side needs
		new ResizeObserver(() => {
			if (this.view === 'diff' && this.diffSet && this.renderedLayout !== this.diffLayout) this.renderViewer();
		}).observe(this.viewer);
		this.replaceRow = this.replaceControls();
		this.elem.append(bar, this.filters, this.replaceRow, this.panes);
		this.elem.tabIndex = -1;

		this.elem.addEventListener('keydown', event => {
			const step = travelKey(event);

			if (!step) return;
			event.preventDefault();
			if (step < 0) this.back();
			else this.forward();
		});
		// A mouse's own back and forward buttons step through what was read, not away from the session
		for (const type of ['mousedown', 'mouseup'])
			this.elem.addEventListener(type, event => {
				if (event.button !== 3 && event.button !== 4) return;
				event.preventDefault();
				if (type === 'mouseup') this[event.button === 3 ? 'back' : 'forward']();
			});

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
		if (!query)
			return this.list.replaceChildren(
				...this.comparingNotice(),
				...this.treeEntries(buildTree(paths, [...this.madeFolders]), 0),
			);

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

	treeEntries(node, depth, parent = '') {
		const indent = entry => {
			entry.style.paddingLeft = `${4 + depth * 14}px`;

			return entry;
		};
		const folders = [...node.folders].sort(([a], [b]) => a.localeCompare(b));
		const entries = [];

		for (const [name, child] of folders) {
			const key = parent + name;
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
			this.manager.decorate(entry, key);
			entry.addEventListener('click', event => {
				if (!this.manager.pressed(event, key)) this.toggleFolder(key);
			});
			entries.push(entry, ...(open ? this.treeEntries(child, depth + 1, `${key}/`) : []));
		}

		for (const path of node.files) entries.push(indent(this.fileEntry(path.split('/').at(-1), path)));

		return entries;
	}

	// Open or close a folder in the tree; new files are made where the list was last looked into
	toggleFolder(path, open = !this.expanded.has(path)) {
		if (open) this.expanded.add(path);
		else this.expanded.delete(path);
		this.here = open ? path : path.split('/').slice(0, -1).join('/');
		this.renderList();
	}

	// The folders down to a path opened in the tree, and a folder's own with `folder`
	reveal(path, { folder = false, render = false } = {}) {
		const parts = path.split('/');

		for (let depth = 1; depth < parts.length + (folder ? 1 : 0); depth += 1)
			this.expanded.add(parts.slice(0, depth).join('/'));
		if (render) this.renderList();
	}

	// Files and folders moved: whatever the panel remembers by their old paths follows them, an edit in progress too
	followMoves(moves) {
		const follow = path => {
			for (const { from, to } of moves) {
				if (path === from) return to;
				if (path?.startsWith(`${from}/`)) return to + path.slice(from.length);
			}

			return path;
		};

		this.expanded = new Set([...this.expanded].map(follow));
		for (const location of [...this.past, ...this.future]) if (!location.outside) location.path = follow(location.path);
		this.madeFolders = new Set([...this.madeFolders].map(follow));
		this.here = follow(this.here);
		if (this.current && !this.outside && follow(this.current) !== this.current) {
			this.current = follow(this.current);
			this.renderViewer();
		}
	}

	// Files and folders deleted: the open file closes if it was one of them
	forget(paths) {
		const gone = path => paths.some(deleted => path === deleted || path?.startsWith(`${deleted}/`));

		this.madeFolders = new Set([...this.madeFolders].filter(path => !gone(path)));
		if (gone(this.here)) this.here = '';
		if (!this.current || this.outside || !gone(this.current)) return;

		this.current = null;
		this.view = null;
		this.editing = null;
		this.panes.classList.remove('reading');
		this.viewer.replaceChildren(element('div', 'empty', 'Pick a file to read it.'));
	}

	// Search the contents of one folder
	findIn(folder) {
		this.searchOptions.include = folder;
		this.include.value = folder;
		this.saveOptions();
		this.filters.classList.add('shown');
		this.setMode('contents');
		this.query.focus();
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
		// A row for the file itself, not one of its lines or its changes, is one to manage
		const managed = !diff && line === undefined;

		if (managed) this.manager.decorate(entry, path);
		entry.addEventListener('click', event => {
			if (this.comparing && !diff) {
				const first = this.comparing;

				this.comparing = null;
				this.openDiffSet({ source: 'files', a: first, b: path });
			} else if (diff) this.openDiff(path);
			else if (!managed || !this.manager.pressed(event, path)) this.open(path, line);
		});

		return entry;
	}

	// An edit not yet saved is lost by leaving it, so leaving asks first
	async leaveEditing() {
		if (!this.editing || this.editing.text === this.text) {
			if (this.editing) this.forgetDraft();
			this.editing = null;

			return true;
		}

		const leave = await confirmDialog({
			header: 'Leave your edit unsaved?',
			body: `Your changes to ${this.current} haven't been saved.`,
			cancelLabel: 'Keep editing',
			confirmLabel: 'Discard them',
		});

		if (leave) {
			this.forgetDraft();
			this.editing = null;
		}

		return leave;
	}

	openDiff(path) {
		return this.openDiffSet({ source: 'changes', path });
	}

	// Any kind of diff: a changed file, a turn, a proposal, or two files compared
	async openDiffSet(source) {
		if (!(await this.leaveEditing())) return;
		this.leaving(null);

		const single = source.path ?? source.b ?? null;

		this.leaveTour(subject => JSON.stringify(subject.diff) === JSON.stringify(source));
		this.current = single;
		this.outside = false;
		this.view = 'diff';
		this.kind = single ? kindOf(single) : 'text';
		this.diffSource = source;
		this.diffSet = null;
		this.diffShown = new Set();
		this.diffSelection = null;
		this.failure = null;
		this.panes.classList.add('reading');
		this.markCurrent(single);
		if (this.mode === 'changes') this.renderList();

		const { body, response } = await getDiffSet(this.options.sessionId, source);

		if (this.diffSource !== source) return;

		if (response?.ok) {
			this.diffSet = body;
			await this.loadDiffComments();
			if (this.diffSource !== source) return;
		} else this.failure = typeof body === 'string' ? body : 'Could not show the changes.';
		this.renderViewer();
	}

	// Where the open comments on the diff's files are on each side of it: { [path]: { [comment id]: { new, old } } }
	async loadDiffComments() {
		const set = this.diffSet;
		const files = [...new Map((set?.files ?? []).map(file => [file.path, file])).values()].filter(
			file => (file.blobs?.old || file.blobs?.new) && this.options.commentsOn?.(file.path, { inDiff: true }).length,
		);
		const found = await Promise.all(
			files.map(async ({ path, blobs }) => {
				const { body, response } = await getGit(this.options.sessionId, 'anchors', { path, ...blobs });

				return [path, response?.ok ? body : {}];
			}),
		);

		if (this.diffSet === set) this.diffComments = Object.fromEntries(found);
	}

	// The open comments on a line of the diff, on its side of the change
	diffCommentsAt(path, side, number) {
		const where = this.diffComments?.[path];

		if (!where) return [];

		return this.options.commentsOn(path, { inDiff: true }).filter(comment => {
			const lines = where[comment.id]?.[side];

			return lines && lines.from <= number && number <= lines.to;
		});
	}

	markCurrent(path) {
		this.list
			.querySelectorAll('.entry')
			.forEach(entry => entry.classList.toggle('current', entry.dataset.path === path));
	}

	// `outside`: a file the session made outside the project (its scratchpad, /tmp), read through its artifacts: shown,
	// but not edited, blamed or listed
	fileUrl() {
		return this.outside
			? artifactUrl(this.options.sessionId, this.current)
			: rawFileUrl(this.options.sessionId, this.current);
	}

	async open(path, line, lastLine = line, { outside = false, returning = false } = {}) {
		if (!(await this.leaveEditing())) return;
		if (!returning) this.leaving(path, line);

		this.leaveTour(subject => !outside && subject.file?.path === path);
		this.current = path;
		this.here = outside ? this.here : path.split('/').slice(0, -1).join('/');
		this.outside = outside;
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

		const { body, response } = outside
			? await fetch(this.fileUrl()).then(
					async read => ({ response: read, body: await read.text() }),
					() => ({ body: null }),
				)
			: await readFile(this.options.sessionId, path);

		if (this.current !== path) return;

		if (!response?.ok) {
			this.failure = typeof body === 'string' ? body : 'Could not open it.';
			this.renderViewer();

			return;
		}

		this.failure = null;
		this.hash = response.headers.get('x-content-hash');
		this.text = body;
		this.draft = outside ? null : this.draftOf(path, body);
		this.lines = body.replace(/\n$/, '').split('\n');
		this.commentLines = null;
		await this.loadCommentLines();
		if (this.current !== path) return;
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
			const row = element('button', 'history-item variant-flat');

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

		back.classList.add('back');
		const path = element('div', 'path', this.current);

		path.title = this.current;
		head.append(back, ...this.travelButtons(), fileIcon(this.current), path);
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
		if (this.lines && this.showingSource && !this.outside) {
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
		if (this.lines && !this.outside)
			head.append(button('Compare...', () => this.startComparing(), { title: 'Compare it with another file' }));
		if (this.lines && this.showingSource && !this.outside) head.append(this.walkButton(walk => this.walkMenu(walk)));

		if (canType()) {
			if (this.lines && this.showingSource && !this.outside)
				head.append(button('Edit', () => this.startEditing(), { icon: 'pen' }));
			head.append(button('Attach file', () => this.attachFile()));

			if (this.selection && this.lines && this.showingSource) {
				const { from, to } = this.selection;

				head.append(
					button(from === to ? `Attach line ${from}` : `Attach lines ${from}-${to}`, () => this.attachLines()),
				);
			}
		}

		if (this.selection && this.lines && this.showingSource) {
			if (canNote() && !this.outside) head.append(button('Comment', () => this.commentOnLines(), { icon: 'comment' }));
			head.append(button('Copy', () => this.copyLines()));
		}
		// What made outside the project may be a page: opened as it is (in a sandbox), beside its source here
		if ((this.kind !== 'text' && this.kind !== 'markdown') || this.outside) {
			const link = element('a', '', 'Open');

			link.href = this.fileUrl();
			link.target = '_blank';
			link.rel = 'noopener';
			if (this.kind === 'image') opensInViewer(link, { src: link.href, name: this.current });
			head.append(link);
		}

		return head;
	}

	// How a set of several files is ordered: reading order unless another was picked
	get diffOrder() {
		const picked = recall(DIFF_ORDER_KEY);

		return Object.hasOwn(ORDERS, picked) ? picked : 'reading';
	}

	orderButton() {
		const order = button(ORDERS[this.diffOrder].label, () =>
			openMenu(
				order,
				Object.entries(ORDERS).map(([key, { label, detail }]) => ({
					label: key === this.diffOrder ? `✓ ${label}` : label,
					detail,
					onPress: () => {
						remember(DIFF_ORDER_KEY, key);
						this.diffSelection = null;
						this.renderViewer();
					},
				})),
			),
		);

		order.title = 'The order the files are read in';

		return order;
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

		back.classList.add('back');
		title.title = set?.title ?? '';
		head.append(back, ...this.travelButtons(), ...(single ? [fileIcon(single.path)] : []), title);

		if (set?.files.length > 1 || Object.values(set?.outlines ?? {}).some(outline => outline.length))
			head.append(this.orderButton());
		if (wide)
			head.append(
				button(this.diffLayout === 'split' ? 'Unified' : 'Side by side', () => {
					remember(DIFF_LAYOUT_KEY, this.diffLayout === 'split' ? 'unified' : 'split');
					this.renderViewer();
				}),
			);

		if (single && single.status !== 'deleted' && this.paths.includes(single.path))
			head.append(button('Open file', () => this.open(single.path)));
		if (set?.files.length) {
			const source = this.diffSource;

			head.append(this.walkButton(() => this.startTour({ diff: source }, set.title || 'this change')));
		}

		if (canNote() && this.diffSelection)
			head.append(button('Comment', () => this.commentOnPickedLines(), { icon: 'comment' }));

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
			iconButton('magnifying-glass', 'Find and replace (Ctrl+F, Ctrl+H)', () => openSearchPanel(this.editorView)),
			button('Save', () => this.save(), { title: 'Save (Ctrl+S)', className: 'primary' }),
			button('Cancel', () => this.cancelEditing()),
		);

		return head;
	}

	renderViewer() {
		const scroll = this.body?.scrollTop ?? 0;

		this.dropEditor();

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

		this.viewer.replaceChildren(
			this.viewerHead(),
			...(this.tour ? [this.tourCard.elem] : []),
			...(this.conflict ? [this.conflictNotice()] : []),
			...(this.draft && !this.editing && this.view === 'file' ? [this.draftNotice()] : []),
			this.body,
		);
		this.body.scrollTop = scroll;
	}

	diff() {
		if (this.diffSet === null) return element('div', 'empty', 'Loading the changes...');

		this.renderedLayout = this.diffLayout;

		const { container, files } = renderDiffSet({
			set: { ...this.diffSet, files: orderFiles(this.diffSet.files, this.diffOrder, this.diffSet) },
			about: describeFiles(this.diffSet.files),
			shown: this.diffShown,
			onShow: path => {
				this.diffShown.add(path);
				this.renderViewer();
			},
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
			commentsAt: (path, side, number) => this.diffCommentsAt(path, side, number),
			onComment: commentId => this.options.showComment(commentId),
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

	// A comment on the lines picked, numbered by the texts the diff is between, and knowing the diff to open it in again
	commentOnPickedLines() {
		const { file, from, to } = this.diffSelection;
		const { path, lines, blobs } = this.diffFiles[file];
		const picked = lines.slice(from, to + 1);
		const anchor = diffAnchor(path, picked);

		if (!anchor) return;
		this.options.comment({
			quote: diffLines(picked),
			anchor: {
				...anchor,
				blob: blobs[anchor.side],
				...(anchor.old && { old: { ...anchor.old, blob: blobs.old } }),
				diff: this.diffSource,
			},
		});
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

	// Compare: the list picks the file to compare this one (the open one, unless another is given) with
	startComparing(path = this.current) {
		this.comparing = path;
		this.setMode('names');
		this.panes.classList.remove('reading');
	}

	// The edit's own state (its text, cursors and undo history) outlives the editor drawn for it, so drawing the viewer
	// again, for a conflict say, keeps all of it
	editor() {
		const view = codeEditor(this.editing.state);
		const holder = element('div', 'code-editor');

		holder.append(view.dom);
		this.editorView = view;
		requestAnimationFrame(() => {
			view.scrollDOM.scrollTop = this.editing?.scroll ?? 0;
			view.focus();
		});

		return holder;
	}

	// Leaving the editor drawn: where it was scrolled to is kept with the edit
	dropEditor() {
		if (!this.editorView) return;

		if (this.editing) this.editing.scroll = this.editorView.scrollDOM.scrollTop;
		this.editorView.destroy();
		this.editorView = null;
	}

	refreshHead() {
		this.viewer.querySelector('.head')?.replaceWith(this.viewerHead());
	}

	// An edit begins from the file as read, or from a draft kept from before (over the version it was begun on, so a
	// newer one is a conflict when saving rather than lost)
	startEditing({ text = this.text, hash = this.hash } = {}) {
		this.draft = null;
		this.editing = {
			text,
			hash,
			state: createState(text, {
				path: this.current,
				language: languageOf(this.current),
				wrap: recall(WRAP_KEY) === 'on',
				onSave: () => this.save(),
				onWrap: on => remember(WRAP_KEY, on ? 'on' : 'off'),
				onUpdate: update => {
					this.editing.state = update.state;
					if (!update.docChanged) return;

					const wasDirty = this.editing.text !== this.text;

					this.editing.text = update.state.doc.toString();
					if (wasDirty !== (this.editing.text !== this.text)) this.refreshHead();
					this.keepDraft();
				},
			}),
		};
		this.selection = null;
		this.renderViewer();
		if (text !== this.text) this.keepDraft();
	}

	async cancelEditing() {
		if (await this.leaveEditing()) {
			this.conflict = null;
			this.renderViewer();
		}
	}

	async save(hash = this.editing.hash) {
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
		this.forgetDraft();
		this.editing = null;
		this.conflict = null;
		new Notify({ type: 'success', content: 'Saved', timeout: 1500 });
		await this.refreshChanges();
		this.renderList();
		this.renderViewer();
	}

	draftKey(path) {
		return `${DRAFT_PREFIX}${this.options.sessionId}:${path}`;
	}

	// An edit not yet saved is kept in this browser as it's typed, so a reload or a lost connection doesn't lose it.
	// One that matches the file now is no draft at all.
	draftOf(path, text) {
		let draft = null;

		try {
			draft = JSON.parse(recall(this.draftKey(path)) || 'null');
		} catch {
			// Unreadable: as good as none
		}

		if (draft && typeof draft.text === 'string' && draft.text !== text) return draft;
		forget(this.draftKey(path));

		return null;
	}

	keepDraft() {
		const path = this.current;

		clearTimeout(this.draftTimer);
		this.draftTimer = setTimeout(() => {
			if (!this.editing || this.current !== path) return;
			if (this.editing.text === this.text) return forget(this.draftKey(path));

			remember(
				this.draftKey(path),
				JSON.stringify({ text: this.editing.text, hash: this.editing.hash, at: Date.now() }),
			);
		}, DRAFT_DELAY_MS);
	}

	forgetDraft() {
		clearTimeout(this.draftTimer);
		if (this.current) forget(this.draftKey(this.current));
		this.draft = null;
	}

	draftNotice() {
		const changed = this.draft.hash !== this.hash;
		const notice = element(
			'div',
			'conflict',
			`An edit of this file you didn't save (${relativeTime(this.draft.at)})${changed ? ', and the file has changed since' : ''}.`,
		);

		notice.append(
			button('Restore it', () => this.startEditing({ text: this.draft.text, hash: this.draft.hash }), {
				className: 'primary',
			}),
			button('Discard it', () => {
				this.forgetDraft();
				this.renderViewer();
			}),
		);

		return notice;
	}

	// Where the reader is: the file, its picked lines and how far down, for Back and Forward to return to
	location() {
		if (this.view !== 'file' || !this.current) return null;

		return {
			path: this.current,
			outside: this.outside,
			selection: this.selection && { ...this.selection },
			scroll: this.body?.scrollTop ?? 0,
		};
	}

	// Somewhere new is about to open: where the reader was goes on the way back, and the way forward is gone
	leaving(path, line) {
		const here = this.location();

		if (!here || (here.path === path && !line)) return;

		this.past.push(here);
		if (this.past.length > MAX_HISTORY) this.past.shift();
		this.future = [];
	}

	async travel(from, to) {
		const target = from.pop();

		if (!target) return;

		const here = this.location();
		const { selection } = target;

		await this.open(target.path, selection?.from, selection?.to, { outside: target.outside, returning: true });
		if (this.current !== target.path) return from.push(target);
		if (here) to.push(here);
		if (this.body) this.body.scrollTop = target.scroll;
		this.refreshHead();
	}

	back() {
		return this.travel(this.past, this.future);
	}

	forward() {
		return this.travel(this.future, this.past);
	}

	travelButtons() {
		const key = MAC ? 'Ctrl+-' : 'Alt+Left';
		const forwardKey = MAC ? 'Ctrl+Shift+-' : 'Alt+Right';

		return [
			...(this.past.length ? [iconButton('chevron-left', `Back (${key})`, () => this.back())] : []),
			...(this.future.length ? [iconButton('chevron-right', `Forward (${forwardKey})`, () => this.forward())] : []),
		];
	}

	// From the keyboard anywhere on the page: the names (Ctrl+P), contents (Ctrl+Shift+F) or symbols to look through,
	// or the open file's outline (Ctrl+Shift+O)
	quickOpen(mode) {
		if (mode === 'outline') {
			if (this.current && this.view === 'file' && !this.outside) return this.showOutline();
			mode = 'symbols';
		}

		const selected = window.getSelection().toString().trim();

		if (mode === 'contents' && selected && !selected.includes('\n')) this.query.value = selected;
		this.setMode(mode);
		this.panes.classList.remove('reading');
		this.query.focus();
		this.query.select();
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
				this.forgetDraft();
				this.editing = null;
				this.conflict = null;
				this.renderViewer();
			}),
		);

		return notice;
	}

	media() {
		const holder = element('div', 'media');
		const url = this.fileUrl();
		const tag = { image: 'img', video: 'video', audio: 'audio', pdf: 'iframe' }[this.kind];
		const node = element(tag);

		node.src = url;
		if (this.kind === 'video' || this.kind === 'audio') node.controls = true;
		if (this.kind === 'image') {
			node.alt = this.current;
			node.classList.add('enlarges');
			node.addEventListener('click', () => viewImage({ src: url, name: this.current }));
		}
		node.addEventListener('error', () => holder.replaceChildren(element('div', 'empty', 'Could not show this file.')));
		holder.append(node);

		return holder;
	}

	// Someone else's markdown shown on paude's own page: the HTML is sanitized, and its relative images and links
	// point back into the project
	renderedMarkdown() {
		const container = element('div', 'markdown vbc-elements');

		// No forms, inputs or inline styles: a README could otherwise paint a convincing password prompt over the page
		container.innerHTML = DOMPurify.sanitize(marked.parse(this.text), {
			FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option'],
			FORBID_ATTR: ['style'],
		});

		for (const image of container.querySelectorAll('img[src]')) {
			const path = projectPathFrom(this.current, image.getAttribute('src'));

			if (path !== null && !this.outside) image.src = rawFileUrl(this.options.sessionId, path);
			image.classList.add('enlarges');
			image.addEventListener('click', event => {
				if (image.closest('a')) return;

				event.preventDefault();
				viewImage({ src: image.src, name: image.alt || path || image.src });
			});
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
		wrapper.append(...(this.blame ? [this.blameColumn()] : []), ...this.commentMarks(), gutter, pre);

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

	walkButton(onPress) {
		const walk = button('Walk me through', () => onPress(walk), {
			icon: 'route',
			title: 'A guided tour: Haiku explains it, stop by stop',
		});

		return walk;
	}

	// The file, the lines picked, or one of its functions or classes
	async walkMenu(anchor) {
		const path = this.current;
		const { body: symbols } = await getSymbols(this.options.sessionId, { file: path });
		const { from, to } = this.selection ?? {};

		openMenu(anchor, [
			{ label: 'This file', detail: path, onPress: () => this.startTour({ file: { path } }, path) },
			...(this.selection
				? [
						{
							label: from === to ? `Line ${from}` : `Lines ${from}-${to}`,
							detail: 'the lines picked',
							onPress: () => this.startTour({ file: { path, from, to } }, `${path}, lines ${from}-${to}`),
						},
					]
				: []),
			...(Array.isArray(symbols) && symbols.length
				? [
						{ heading: 'A function, class or type' },
						...symbols.map(({ name, kind, line }) => ({
							label: name,
							detail: `${kind}, line ${line}`,
							onPress: () => this.startTour({ file: { path, focus: { name, line } } }, `${name} in ${path}`),
						})),
					]
				: []),
		]);
	}

	// A tour of code (a file, some of its lines, a function, a diff), shown above what it's about: each stop takes the
	// reader to its lines
	async startTour(subject, heading) {
		const into = this.tourCard.elem;
		const close = () => {
			this.tour = null;
			this.renderViewer();
		};
		const answers = element('div', 'answers');

		this.tour = { subject };
		answers.append(button('Close', close));
		into.replaceChildren(
			element('div', 'title', heading),
			element('div', 'question', 'Haiku is reading it...'),
			answers,
		);
		this.renderViewer();

		const { body, response } = await tourOf(this.options.sessionId, subject);

		if (this.tour?.subject !== subject) return;
		if (!response?.ok) {
			close();

			return new Notify({ type: 'warning', content: typeof body === 'string' ? body : "Couldn't walk you through it" });
		}

		stepThrough({
			into,
			heading: `${heading}: ${body.stops.length} stop${body.stops.length === 1 ? '' : 's'}`,
			overview: body.overview,
			stops: body.stops,
			leftOut: body.leftOut,
			stopTitle: (stop, index) =>
				`${index} of ${body.stops.length} · ${subject.diff ? `${stop.path} ` : ''}${stop.from === stop.to ? `line ${stop.from}` : `lines ${stop.from}-${stop.to}`}${stop.side === 'old' ? ' (before)' : ''}`,
			place: stop => {
				if (stop) this.goToStop(stop, subject);
			},
			close,
		});
	}

	// Another file or diff opened: a tour of something else ends, so its bar doesn't stay with Next going nowhere
	leaveTour(stillOn) {
		if (this.tour && !stillOn(this.tour.subject)) this.tour = null;
	}

	async goToStop(stop, subject) {
		if (!subject.diff) {
			if (this.view !== 'file' || this.current !== stop.path) await this.open(stop.path, stop.from, stop.to);
			else this.selection = { anchor: stop.from, from: stop.from, to: stop.to };
			this.renderViewer();
			this.body.scrollTop = (stop.from - 1) * LINE_HEIGHT - this.body.clientHeight / 3;

			return;
		}

		// A file read function by function is in several parts: the stop is in the one holding its lines
		// A stop before the change is on removed lines, numbered as they were; any other, on lines as they are now
		const numberOf = line => {
			if (stop.side === 'new') return line.new;

			return line.kind === 'removed' ? line.old : undefined;
		};
		const file = (this.diffFiles ?? []).findIndex(
			({ path, lines }) => path === stop.path && lines.some(line => numberOf(line) === stop.from),
		);
		const lines = file === -1 ? [] : this.diffFiles[file].lines;
		const first = lines.findIndex(line => numberOf(line) === stop.from);
		const last = lines.findLastIndex(line => numberOf(line) === stop.to);

		this.diffSelection = first === -1 ? null : { file, anchor: first, from: first, to: Math.max(first, last) };
		this.renderViewer();
		this.body.querySelector('.picked')?.scrollIntoView({ block: 'center' });
	}

	// Comments came or went: the marks beside an open file follow, unless it's being edited
	async commentsChanged() {
		if (this.view === 'diff' && this.diffSet) {
			await this.loadDiffComments();

			return this.view === 'diff' && this.renderViewer();
		}
		if (!this.current || !this.lines || this.view === 'diff' || this.editing) return;

		await this.loadCommentLines();
		this.renderViewer();
	}

	// Where the open file's comments are in it now, carried through what changed since each was written; a comment
	// whose lines changed has none
	async loadCommentLines() {
		const path = this.current;

		if (!this.options.commentsOn?.(path).length) return (this.commentLines = null);

		const { body, response } = await getGit(this.options.sessionId, 'anchors', { path });

		if (this.current === path) this.commentLines = response?.ok ? body : null;
	}

	// A comment's lines, opened where they are now: in the diff it was written in, or the file. Lines before a change
	// are only in a diff of it.
	async openComment({ id, anchor }) {
		if (anchor.diff && (await this.openInDiff(id, anchor))) return;
		if (anchor.side === 'old')
			return new Notify({
				type: 'warning',
				content: anchor.diff
					? 'The change it is on is not in that diff any more.'
					: 'It is on lines before a change, which no diff here shows.',
			});

		const { body, response } = await getGit(this.options.sessionId, 'anchors', { path: anchor.path });
		const now = response?.ok && id in body ? body[id] : anchor;

		if (now === null)
			new Notify({ type: 'warning', content: 'Its lines have changed since; this is where they were.' });
		await this.open(anchor.path, (now ?? anchor).from, (now ?? anchor).to);
	}

	// The comment's lines picked in its diff, where they are in it now; false when the diff or its lines are gone
	async openInDiff(id, anchor) {
		await this.openDiffSet(anchor.diff);

		const where = this.diffComments?.[anchor.path]?.[id];

		if (this.view !== 'diff' || !(where?.new || where?.old)) return false;

		const on = line =>
			['new', 'old'].some(side => where[side] && where[side].from <= line[side] && line[side] <= where[side].to);
		const file = this.diffFiles.findIndex(found => found.path === anchor.path && found.lines.some(on));

		if (file === -1) return false;

		const { lines } = this.diffFiles[file];
		const from = lines.findIndex(on);

		this.diffSelection = { file, anchor: from, from, to: lines.findLastIndex(on) };
		this.renderViewer();
		this.body.querySelector('.picked')?.scrollIntoView({ block: 'center' });

		return true;
	}

	commentOnLines() {
		const { from, to } = this.selection;

		this.options.comment({ quote: this.selectedText(), anchor: { path: this.current, from, to } });
	}

	// A mark beside the lines each open comment is on, which opens it
	commentMarks() {
		return (this.options.commentsOn?.(this.current) ?? []).flatMap(comment => {
			const now = this.commentLines && comment.id in this.commentLines ? this.commentLines[comment.id] : comment.anchor;

			if (!now) return [];

			// Not a button: the panel's button look would cover the line number it sits beside
			const mark = Object.assign(element('div', 'comment-mark'), { role: 'button', tabIndex: 0 });
			const { from, to } = now;

			mark.style.top = `${(from - 1) * LINE_HEIGHT}px`;
			mark.style.height = `${(Math.min(to, this.lines.length) - from + 1) * LINE_HEIGHT}px`;
			mark.title = `${comment.author}: ${comment.text}`;
			mark.addEventListener('click', () => this.options.showComment(comment.id));
			mark.addEventListener('keydown', event => {
				if (event.key !== 'Enter' && event.key !== ' ') return;
				event.preventDefault();
				this.options.showComment(comment.id);
			});

			return mark;
		});
	}

	copyLines() {
		return copyWithNotice(this.selectedText(), 'Copied');
	}
}
