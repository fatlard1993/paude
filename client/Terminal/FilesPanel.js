import { Component, Notify, styled } from '@vanilla-bean/components';

import { listFiles, readFile, searchFiles } from '../api';
import { canType } from '../identity';

const MAX_MATCHES = 200;
const SEARCH_DELAY_MS = 300;

const Panel = styled(
	Component,
	({ colors }) => `
		display: flex;
		flex-direction: column;
		height: 100%;

		.bar {
			display: flex;
			gap: 6px;
			padding: 8px;
			align-items: center;
		}

		.bar input {
			flex: 1;
		}

		button {
			padding: 4px 10px;
			border: none;
			border-radius: 4px;
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			font: inherit;
			cursor: pointer;
		}

		button.active {
			background: ${colors.alpha(colors.white, 0.25)};
		}

		.panes {
			flex: 1;
			min-height: 0;
			display: flex;
		}

		.list {
			width: 40%;
			min-width: 200px;
			overflow: auto;
			padding: 0 8px 8px;
			font-size: 0.9em;
		}

		.list .entry {
			padding: 2px 4px;
			border-radius: 3px;
			cursor: pointer;
			white-space: nowrap;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.list .entry:hover, .list .entry.current {
			background: ${colors.alpha(colors.white, 0.12)};
		}

		.list .folder {
			color: ${colors.light(colors.blue)};
		}

		.list .hit-text {
			color: ${colors.light(colors.gray)};
			margin-left: 6px;
		}

		.viewer {
			flex: 1;
			min-width: 0;
			display: flex;
			flex-direction: column;
			border-left: 1px solid ${colors.alpha(colors.white, 0.1)};
		}

		.viewer .head {
			display: flex;
			gap: 6px;
			align-items: center;
			padding: 0 8px 8px;
			flex-wrap: wrap;
		}

		.viewer .path {
			flex: 1;
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.code {
			flex: 1;
			overflow: auto;
			font-family: 'FontWithASyntaxHighlighter', ui-monospace, monospace;
			font-size: 0.85em;
			line-height: 1.45;
			white-space: pre;
			tab-size: 4;
		}

		.code .line {
			display: flex;
		}

		.code .line.selected {
			background: ${colors.alpha(colors.yellow, 0.18)};
		}

		.code .number {
			flex-shrink: 0;
			width: 4.5em;
			padding-right: 1em;
			text-align: right;
			color: ${colors.gray};
			cursor: pointer;
			user-select: none;
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

			.viewer {
				border-left: none;
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

const button = (label, onClick) => {
	const node = element('button', '', label);

	node.addEventListener('click', onClick);

	return node;
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

// Browsing, searching and reading a session's project, and attaching a file or some of its lines to Claude's prompt
export default class FilesPanel extends Panel {
	build() {
		this.paths = [];
		this.expanded = new Set();
		this.mode = 'names';
		this.selection = null;

		const bar = element('div', 'bar');

		this.query = element('input');
		this.query.placeholder = 'Find a file';
		this.query.addEventListener('input', () => this.renderList());
		this.modeButtons = {
			names: button('Names', () => this.setMode('names')),
			contents: button('Contents', () => this.setMode('contents')),
		};
		bar.append(
			this.query,
			this.modeButtons.names,
			this.modeButtons.contents,
			button('✕', () => this.options.close()),
		);

		this.panes = element('div', 'panes');
		this.list = element('div', 'list');
		this.viewer = element('div', 'viewer');
		this.panes.append(this.list, this.viewer);
		this.elem.append(bar, this.panes);
		this.setMode('names');
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

		this.renderList();
	}

	renderList() {
		const query = this.query.value.trim();

		clearTimeout(this.searchTimer);

		if (!query) return this.list.replaceChildren(...this.treeEntries(buildTree(this.paths), 0));

		if (this.mode === 'contents') {
			this.searchTimer = setTimeout(() => this.searchContents(query), SEARCH_DELAY_MS);

			return;
		}

		const matches = this.paths
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

		const { body: hits, response } = await searchFiles(this.options.sessionId, query);

		if (this.query.value.trim() !== query || this.mode !== 'contents') return;
		if (!response?.ok || !hits.length)
			return this.list.replaceChildren(element('div', 'empty', response?.ok ? 'Nothing found.' : 'Search failed.'));

		this.list.replaceChildren(
			...hits.map(hit => {
				const entry = this.fileEntry(`${hit.path}:${hit.line}`, hit.path, hit.line);

				entry.append(element('span', 'hit-text', hit.text.trim()));

				return entry;
			}),
		);
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
			const entry = indent(element('div', 'entry folder', `${open ? '▾' : '▸'} ${name}`));

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
		const entry = element('div', `entry${path === this.current ? ' current' : ''}`, label);

		entry.title = path;
		entry.addEventListener('click', () => this.open(path, line));

		return entry;
	}

	async open(path, line) {
		const { body, response } = await readFile(this.options.sessionId, path);

		this.current = path;
		this.selection = line ? { from: line, to: line } : null;
		this.panes.classList.add('reading');

		if (!response?.ok) {
			this.viewer.replaceChildren(
				this.viewerHead(path),
				element('div', 'empty', typeof body === 'string' ? body : 'Could not open it.'),
			);

			return;
		}

		this.lines = body.replace(/\n$/, '').split('\n');
		this.renderViewer();
		this.list.querySelectorAll('.entry').forEach(entry => entry.classList.toggle('current', entry.title === path));

		if (line) this.code.querySelector(`[data-line="${line}"]`)?.scrollIntoView({ block: 'center' });
	}

	viewerHead(path) {
		const head = element('div', 'head');
		const back = button('←', () => this.panes.classList.remove('reading'));

		back.className = 'back';
		head.append(back, element('div', 'path', path));

		if (canType()) {
			head.append(button('Attach file', () => this.attachFile()));

			if (this.selection) {
				const { from, to } = this.selection;

				head.append(
					button(from === to ? `Attach line ${from}` : `Attach lines ${from}-${to}`, () => this.attachLines()),
				);
			}
		}

		if (this.selection) head.append(button('Copy', () => this.copyLines()));

		return head;
	}

	// Click a line number to pick it; Shift+click another to pick the range between
	renderViewer() {
		const { from, to } = this.selection ?? {};

		this.code = element('div', 'code');
		this.lines.forEach((text, index) => {
			const number = index + 1;
			const row = element('div', `line${number >= from && number <= to ? ' selected' : ''}`);
			const gutter = element('span', 'number', String(number));

			row.dataset.line = String(number);
			gutter.addEventListener('click', event => {
				const anchor = event.shiftKey && this.selection ? this.selection.anchor : number;

				this.selection = { anchor, from: Math.min(anchor, number), to: Math.max(anchor, number) };
				this.renderViewer();
			});
			row.append(gutter, element('span', '', text || ' '));
			this.code.append(row);
		});

		const scroll = this.viewer.querySelector('.code')?.scrollTop ?? 0;

		this.viewer.replaceChildren(this.viewerHead(this.current), this.code);
		this.code.scrollTop = scroll;
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
