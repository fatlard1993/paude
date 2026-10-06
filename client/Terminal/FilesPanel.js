import { Component, Notify, styled } from '@vanilla-bean/components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

import { pathFilter } from '../../shared/globs';
import { listFiles, rawFileUrl, readFile, searchFiles } from '../api';
import { canType } from '../identity';
import { recall, remember } from './NotesPanel';

const MAX_MATCHES = 200;
const SEARCH_DELAY_MS = 300;
const LINE_HEIGHT = 20;
const OPTIONS_KEY = 'paude.searchOptions';
const MARKDOWN_KEY = 'paude.markdownView';
// What holds text sits on something solid; the panel around it stays glass
const LAYER = 'rgba(16, 16, 19, 0.5)';

const Panel = styled(
	Component,
	({ colors }) => `
		display: flex;
		flex-direction: column;
		height: 100%;
		gap: 8px;
		padding: 8px;

		.bar, .filters, .list, .viewer {
			background: ${LAYER};
			border-radius: 6px;
		}

		.bar {
			display: flex;
			gap: 6px;
			padding: 6px;
			align-items: center;
		}

		.search {
			flex: 1;
			min-width: 0;
			display: flex;
			align-items: center;
			gap: 2px;
			padding-right: 2px;
			border-radius: 4px;
			background: ${colors.alpha(colors.black, 0.6)};
		}

		.search input {
			flex: 1;
			min-width: 0;
			border: none;
			background: transparent;
		}

		.filters {
			display: none;
			flex-direction: column;
			gap: 6px;
			padding: 6px;
		}

		.filters.shown {
			display: flex;
		}

		button {
			padding: 4px 10px;
			border: none;
			border-radius: 4px;
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			font: inherit;
			cursor: pointer;
			white-space: nowrap;
		}

		button.toggle {
			padding: 2px 6px;
			background: transparent;
			font-family: ui-monospace, monospace;
			font-size: 0.85em;
			opacity: 0.6;
		}

		button.active {
			background: ${colors.alpha(colors.blue, 0.45)};
			opacity: 1;
		}

		button.icon-only {
			padding: 4px 8px;
		}

		.panes {
			flex: 1;
			min-height: 0;
			display: flex;
			gap: 8px;
		}

		.list {
			width: 34%;
			min-width: 180px;
			overflow: auto;
			padding: 6px;
			font-size: 0.9em;
		}

		.list .entry {
			display: flex;
			align-items: center;
			gap: 6px;
			padding: 2px 4px;
			border-radius: 3px;
			cursor: pointer;
			white-space: nowrap;
		}

		.list .entry .label {
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.list .entry i, .head i {
			width: 1.1em;
			flex-shrink: 0;
			text-align: center;
		}

		.list .entry:hover, .list .entry.current {
			background: ${colors.alpha(colors.white, 0.12)};
		}

		.list .hit-text {
			color: ${colors.light(colors.gray)};
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.list .hit-text mark {
			background: ${colors.alpha(colors.yellow, 0.35)};
			color: inherit;
		}

		.viewer {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			overflow: hidden;
		}

		.viewer .head {
			display: flex;
			gap: 6px;
			align-items: center;
			padding: 6px;
			flex-wrap: wrap;
			border-bottom: 1px solid ${colors.alpha(colors.white, 0.08)};
		}

		.viewer .path {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.body {
			flex: 1;
			min-height: 0;
			overflow: auto;
		}

		.source {
			position: relative;
			display: flex;
			min-width: fit-content;
			font-size: 13px;
			line-height: ${LINE_HEIGHT}px;
		}

		.gutter {
			flex-shrink: 0;
			padding: 0 12px 0 8px;
			text-align: right;
			color: ${colors.gray};
			font-family: ui-monospace, monospace;
			user-select: none;
			cursor: pointer;
			position: relative;
			z-index: 1;
		}

		.gutter div:hover {
			color: ${colors.white};
		}

		.source pre, .source code {
			margin: 0;
			padding: 0;
			width: auto;
			background: transparent;
			line-height: ${LINE_HEIGHT}px;
			white-space: pre;
			tab-size: 4;
			position: relative;
			z-index: 1;
		}

		.source code.plain {
			font-family: ui-monospace, monospace;
			color: ${colors.white};
		}

		.band {
			position: absolute;
			left: 0;
			right: 0;
			background: ${colors.alpha(colors.yellow, 0.16)};
			pointer-events: none;
		}

		.markdown {
			padding: 8px 16px 16px;
			line-height: 1.5;
			max-width: 900px;
		}

		.markdown img {
			max-width: 100%;
		}

		.markdown pre {
			padding: 8px;
			border-radius: 4px;
			overflow: auto;
		}

		.markdown a {
			color: ${colors.light(colors.blue)};
		}

		.markdown table {
			border-collapse: collapse;
		}

		.markdown th, .markdown td {
			border: 1px solid ${colors.alpha(colors.white, 0.15)};
			padding: 4px 8px;
		}

		.media {
			display: flex;
			align-items: center;
			justify-content: center;
			min-height: 100%;
			padding: 8px;
			box-sizing: border-box;
		}

		.media img, .media video {
			max-width: 100%;
			max-height: 100%;
			object-fit: contain;
			background: repeating-conic-gradient(#2a2a2e 0% 25%, #222226 0% 50%) 50% / 16px 16px;
		}

		.media iframe {
			width: 100%;
			height: 100%;
			min-height: 400px;
			border: none;
			background: white;
		}

		.empty {
			color: ${colors.light(colors.gray)};
			padding: 8px;
		}

		.head .back {
			display: none;
		}

		@media (max-width: 800px) {
			.list {
				width: auto;
				flex: 1;
			}

			.panes.reading .list, .panes:not(.reading) .viewer {
				display: none;
			}

			.head .back {
				display: inline-block;
			}
		}
	`,
);

const element = (tag, className, text) => {
	const node = document.createElement(tag);

	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;

	return node;
};

const button = (label, onClick, { title, className = '' } = {}) => {
	const node = element('button', className, label);

	if (title) node.title = title;
	node.addEventListener('click', onClick);

	return node;
};

const iconButton = (icon, title, onClick) => {
	const node = button('', onClick, { title, className: 'icon-only' });

	node.append(element('i', `fa-solid fa-${icon}`));

	return node;
};

const extensionOf = path => {
	const name = path.split('/').at(-1).toLowerCase();

	return name.includes('.') ? name.split('.').at(-1) : name;
};

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

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'ogv', 'm4v']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus']);
const MARKDOWN = new Set(['md', 'markdown', 'mdx']);

const kindOf = path => {
	const extension = extensionOf(path);

	if (IMAGE.has(extension)) return 'image';
	if (VIDEO.has(extension)) return 'video';
	if (AUDIO.has(extension)) return 'audio';
	if (extension === 'pdf') return 'pdf';
	if (MARKDOWN.has(extension)) return 'markdown';

	return 'text';
};

// Each language in its own color, the way editors show them, so a folder reads at a glance
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

// Every query character in order, closer together and nearer the file name scoring better
const fuzzyScore = (path, query) => {
	const haystack = path.toLowerCase();
	let position = -1;
	let score = 0;

	for (const character of query.toLowerCase()) {
		const found = haystack.indexOf(character, position + 1);

		if (found === -1) return null;

		score += found - position;
		position = found;
	}

	return score - position / haystack.length + (haystack.length - haystack.lastIndexOf('/')) / 100;
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

// Browsing, searching and reading a session's project, and attaching a file or some of its lines to Claude's prompt
export default class FilesPanel extends Panel {
	build() {
		this.paths = [];
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
		};
		this.filtersButton = iconButton('filter', 'Files to include and exclude', () => this.toggleFilters());
		this.fullscreenButton = iconButton('expand', 'Full screen', () => this.toggleFullscreen());
		bar.append(
			search,
			this.modeButtons.names,
			this.modeButtons.contents,
			this.filtersButton,
			this.fullscreenButton,
			iconButton('xmark', 'Close', () => this.options.close()),
		);

		this.filters = element('div', 'filters');
		this.include = this.filterInput('include', 'files to include, e.g. src, *.js');
		this.exclude = this.filterInput('exclude', 'files to exclude, e.g. **/*.test.js');
		this.filters.append(this.include, this.exclude);
		this.filters.classList.toggle('shown', Boolean(this.searchOptions.include || this.searchOptions.exclude));

		this.panes = element('div', 'panes');
		this.list = element('div', 'list');
		this.viewer = element('div', 'viewer');
		this.panes.append(this.list, this.viewer);
		this.elem.append(bar, this.filters, this.panes);

		// Esc steps back out of full screen first, then closes the panel
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;

			event.stopPropagation();
			if (this.isFullscreen) this.toggleFullscreen(false);
			else this.options.close();
		});

		this.setMode('names');
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
		const contents = this.mode === 'contents';

		for (const [key, node] of Object.entries(this.toggles)) {
			node.style.display = contents ? '' : 'none';
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
		const { body, response } = await listFiles(this.options.sessionId);

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
		if (!this.current) this.viewer.replaceChildren(element('div', 'empty', 'Pick a file to read it.'));
	}

	setMode(mode) {
		this.mode = mode;
		this.query.placeholder = mode === 'names' ? 'Find a file' : 'Search file contents';

		for (const [key, node] of Object.entries(this.modeButtons)) node.classList.toggle('active', key === mode);

		this.renderToggles();
		this.renderList();
	}

	renderList() {
		const query = this.query.value.trim();
		const wanted = pathFilter(this.searchOptions);
		const paths = this.paths.filter(wanted);

		clearTimeout(this.searchTimer);

		if (!query) return this.list.replaceChildren(...this.treeEntries(buildTree(paths), 0));

		if (this.mode === 'contents') {
			this.searchTimer = setTimeout(() => this.searchContents(query), SEARCH_DELAY_MS);

			return;
		}

		const matches = paths
			.map(path => ({ path, score: fuzzyScore(path, query) }))
			.filter(({ score }) => score !== null)
			.sort((a, b) => a.score - b.score)
			.slice(0, MAX_MATCHES);

		this.list.replaceChildren(
			...(matches.length
				? matches.map(({ path }) => this.fileEntry(path, path))
				: [element('div', 'empty', 'No file names match.')]),
		);
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

	// The matched text marked within a hit's line, found the way the server matched it
	highlighted(text, query, { caseSensitive, wholeWord, regex }) {
		const node = element('span', 'hit-text');
		let pattern;

		try {
			const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

			pattern = new RegExp(wholeWord ? `\\b(?:${source})\\b` : source, caseSensitive ? 'g' : 'gi');
		} catch {
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

	fileEntry(label, path, line) {
		const entry = element('div', `entry${path === this.current ? ' current' : ''}`);

		entry.append(fileIcon(path), element('span', 'label', label));
		entry.dataset.path = path;
		entry.title = path;
		entry.addEventListener('click', () => this.open(path, line));

		return entry;
	}

	async open(path, line) {
		this.current = path;
		this.kind = kindOf(path);
		this.selection = line ? { anchor: line, from: line, to: line } : null;
		this.lines = null;
		this.panes.classList.add('reading');
		this.list
			.querySelectorAll('.entry')
			.forEach(entry => entry.classList.toggle('current', entry.dataset.path === path));

		if (['image', 'video', 'audio', 'pdf'].includes(this.kind)) return this.renderViewer();

		const { body, response } = await readFile(this.options.sessionId, path);

		if (this.current !== path) return;

		if (!response?.ok) {
			this.failure = typeof body === 'string' ? body : 'Could not open it.';
			this.renderViewer();

			return;
		}

		this.failure = null;
		this.text = body;
		this.lines = body.replace(/\n$/, '').split('\n');
		this.renderViewer();

		if (line) this.body.scrollTop = (line - 1) * LINE_HEIGHT - this.body.clientHeight / 2;
	}

	get showingSource() {
		return this.kind === 'text' || (this.kind === 'markdown' && this.markdownView === 'source');
	}

	viewerHead() {
		const head = element('div', 'head');
		const back = button('←', () => this.panes.classList.remove('reading'));

		back.className = 'back';
		head.append(back, fileIcon(this.current), element('div', 'path', this.current));

		if (this.kind === 'markdown' && this.lines) {
			head.append(
				button(this.markdownView === 'rendered' ? 'Source' : 'Rendered', () => {
					this.markdownView = this.markdownView === 'rendered' ? 'source' : 'rendered';
					remember(MARKDOWN_KEY, this.markdownView);
					this.renderViewer();
				}),
			);
		}

		if (canType()) {
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

	renderViewer() {
		const scroll = this.body?.scrollTop ?? 0;

		this.body = element('div', 'body');

		if (this.failure && !['image', 'video', 'audio', 'pdf'].includes(this.kind)) {
			this.body.append(element('div', 'empty', this.failure));
		} else if (this.kind === 'image' || this.kind === 'video' || this.kind === 'audio' || this.kind === 'pdf') {
			this.body.append(this.media());
		} else if (this.kind === 'markdown' && this.markdownView === 'rendered') {
			this.body.append(this.renderedMarkdown());
		} else {
			this.body.append(this.source());
		}

		this.viewer.replaceChildren(this.viewerHead(), this.body);
		this.body.scrollTop = scroll;
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

		container.innerHTML = DOMPurify.sanitize(marked.parse(this.text));

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
	// number to pick it; Shift+click another to pick the range between.
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

			const anchor = event.shiftKey && this.selection ? this.selection.anchor : number;

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
		wrapper.append(gutter, pre);

		return wrapper;
	}

	selectedText() {
		const { from, to } = this.selection;

		return this.lines.slice(from - 1, to).join('\n');
	}

	// Claude Code reads an @-mentioned file itself
	attachFile() {
		this.options.attach(`@${this.current} `);
	}

	attachLines() {
		const { from, to } = this.selection;
		const range = from === to ? `line ${from}` : `lines ${from}-${to}`;

		this.options.attach(`${this.current} ${range}:\n\`\`\`\n${this.selectedText()}\n\`\`\`\n`);
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
