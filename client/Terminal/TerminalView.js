import { Elem, Notify, View, styled } from '@vanilla-bean/components';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { deleteSession, forkSession, getSession, getTurns, nameSession, setWatching } from '../api';
import confirmDialog, { confirmDeleteSession, nameDialog } from '../confirmDialog';
import { canBrowse, canNote, canType, identity } from '../identity';
import DONE_MARKER from '../../shared/doneMarker';
import withoutPointerReporting from '../../shared/pointerReporting';
import { NOTE_TYPES } from '../../shared/protocol';
import { showNotification } from '../notify';
import { recall, remember, savedName } from '../storage';
import { button, dragHandle } from '../dom';
import attach from './attach';
import KeyBar from './KeyBar';
import selectLinesByTap from './lineSelect';
import xtermOptions, { loadSymbolsFor, redrawWhenSymbolsLoad } from './xtermOptions';
import FilesPanel from './FilesPanel';
import NotesPanel from './NotesPanel';
import SideShell from './SideShell';
import { Body, CommentButton, NARROW, Presence, SelectHint, TopBar } from './TerminalView.styles';

const BACKGROUND = '#1b1b1b';

const ghostButton = (appendTo, { icon, label, title, onPress, className = '' }) => {
	const node = button(label, onPress, { icon, title: title ?? '', className: `ghost ${className}` });

	appendTo.elem.append(node);

	return node;
};

const Screen = styled.Component`
	flex: 1;
	min-height: 0;
	overflow: hidden;
	padding: 0 4px;
	background: ${BACKGROUND};

	.xterm {
		transform-origin: top left;
	}

	&.selecting {
		outline: 2px dashed hsl(29, 55%, 62%);
		outline-offset: -2px;
	}
`;

const ICONS = { web: 'globe', terminal: 'terminal' };
const SOFTWARE_GL = /swiftshader|llvmpipe|softpipe|software/i;

const hardwareWebgl = () => {
	const context = document.createElement('canvas').getContext('webgl2');

	if (!context) return false;

	const info = context.getExtension('WEBGL_debug_renderer_info');
	const renderer = info ? context.getParameter(info.UNMASKED_RENDERER_WEBGL) : context.getParameter(context.RENDERER);

	context.getExtension('WEBGL_lose_context')?.loseContext();

	return !SOFTWARE_GL.test(String(renderer));
};
const NOTES_OPEN_KEY = 'paude.notesOpen';
const NOTES_WIDTH_KEY = 'paude.notesWidth';
const FILES_WIDTH_KEY = 'paude.filesWidth';
const MIN_PANEL_WIDTH = 260;
const SHELL_HEIGHT_KEY = 'paude.shellHeight';
const MIN_PANEL_HEIGHT = 140;
const ROLE_LABELS = { owner: 'owner', drive: 'can type', comment: 'can chat and comment', watch: 'viewing' };

const bufferLines = terminal => {
	const buffer = terminal.buffer.active;
	const lines = [];

	for (let index = 0; index < buffer.length; index++) lines.push(buffer.getLine(index)?.translateToString(true) ?? '');

	return lines;
};

export default class TerminalView extends View {
	constructor(options) {
		super({
			...options,
			onConnected: () => this.open(),
		});
	}

	build() {
		const header = new TopBar({ appendTo: this });

		if (identity()?.owner) {
			ghostButton(header, {
				icon: 'arrow-left',
				title: 'Back',
				onPress: () => (window.location.hash = this.project ? `#/projects/${this.project}` : '#/'),
			});
		} else {
			ghostButton(header, {
				label: 'Leave',
				onPress: async () => {
					await fetch('/api/logout', { method: 'POST' });
					window.location.reload();
				},
			});
		}

		const title = new Elem({ appendTo: header, addClass: 'title' });

		this.stateDot = new Elem({ appendTo: title, addClass: 'state' });
		this.crumb = new Elem({ appendTo: title, addClass: 'crumb', style: { display: 'none' } });
		this.crumb.elem.addEventListener('click', () => (window.location.hash = `#/projects/${this.project}`));
		this.titleLabel = new Elem({ appendTo: title, addClass: 'name' });
		if (identity()?.owner) {
			this.titleLabel.elem.title = 'Rename';
			this.titleLabel.elem.style.cursor = 'pointer';
			this.titleLabel.elem.addEventListener('click', () => this.rename());
		}
		this.presence = new Presence({ appendTo: header });
		new Elem({ appendTo: header, addClass: 'divider' });

		const body = new Body({ appendTo: this });

		if (canBrowse()) {
			this.filesButton = ghostButton(header, {
				icon: 'folder-tree',
				title: 'Project files',
				onPress: () => this.toggleFiles(),
			});
		}
		if (canType()) {
			this.shellButton = ghostButton(header, {
				icon: 'terminal',
				title: 'Side terminal: a shell in this folder that ends when you close it',
				onPress: () => this.toggleShell(),
			});
		}
		this.watchButton = ghostButton(header, {
			icon: 'eye',
			title: 'Watch: count what changes here while you are away',
			onPress: () => this.toggleWatching(),
		});
		this.notesToggle = ghostButton(header, {
			icon: 'comments',
			title: 'Chat and comments',
			onPress: () => this.toggleNotes(),
		});
		this.unread = Object.assign(document.createElement('span'), { className: 'count' });
		this.unread.style.display = 'none';
		this.notesToggle.append(this.unread);
		if (identity()?.owner) {
			ghostButton(header, {
				icon: 'trash-can',
				title: 'Delete this session',
				className: 'danger',
				onPress: () => this.deleteThisSession(),
			});
		}
		const column = new Elem({ appendTo: body, addClass: 'terminal-column' });

		this.screen = new Screen({ appendTo: column });
		this.selectHint = new SelectHint({ appendTo: column, style: { display: 'none' } });
		this.commentButton = new CommentButton({
			appendTo: column,
			textContent: '💬 Comment',
			style: { display: 'none' },
			onPointerPress: event => {
				event.preventDefault();
				this.commentOnSelection();
			},
		});
		if (canNote()) {
			new KeyBar({
				appendTo: column,
				...(canType() && { sendKey: data => this.sendInput(data) }),
				selectLines: () => this.startLineSelect(),
			});
		}

		this.files = new FilesPanel({
			appendTo: body,
			addClass: 'files',
			sessionId: this.options.id,
			close: () => this.toggleFiles(false),
			setFullscreen: on => this.files.elem.classList.toggle('fullscreen', on),
			attach: text => {
				if (this.attachToPrompt(text)) this.toggleFiles(false);
			},
		});
		if (canType()) {
			this.shell = new SideShell({
				appendTo: body,
				addClass: 'shell',
				sessionId: this.options.id,
				close: () => this.toggleShell(false),
				attach: text => this.attachToPrompt(text),
				ended: why => {
					this.toggleShell(false);
					if (why) new Notify({ type: 'warning', content: why });
				},
			});
		}
		this.notes = new NotesPanel({
			appendTo: body,
			addClass: 'notes',
			sessionId: this.options.id,
			send: message => Boolean(this.connection?.send(message)),
			jump: quote => this.jumpTo(quote),
			reveal: () => this.toggleNotes(true),
			announce: arrived => this.announce(arrived),
			showUnread: count => {
				this.unread.textContent = count;
				this.unread.style.display = count ? '' : 'none';
			},
		});

		this.addResizeHandle(this.notes.elem, { variable: '--notes-width', key: NOTES_WIDTH_KEY, edge: 'left' });
		this.addResizeHandle(this.files.elem, { variable: '--files-width', key: FILES_WIDTH_KEY, edge: 'right' });
		if (this.shell) {
			this.addResizeHandle(this.shell.elem, { variable: '--shell-height', key: SHELL_HEIGHT_KEY, edge: 'top' });
		}
		if (recall(NOTES_OPEN_KEY)) this.toggleNotes(true);

		this.loadInfo();
	}

	async loadInfo() {
		const { body, response } = await getSession(this.options.id);

		if (!response?.ok) return;

		this.project = body.project;
		this.showWatching(body.watching);
		this.crumb.elem.textContent = `${body.project} /`;
		this.crumb.elem.style.display = identity()?.owner ? '' : 'none';
		if (!this.titleLabel.elem.textContent) this.titleLabel.elem.textContent = body.title || body.project;
	}

	open() {
		if (this.terminal) return;

		// A cleanup, not onDisconnected: the router destroys the view, and a destroyed view never hears its removal
		this.addCleanup('connections', () => {
			this.connection?.close();
			this.shell?.stop();
			this.resizeObserver?.disconnect();
			this.terminal?.dispose();
		});

		this.terminal = new Terminal({
			...xtermOptions,
			scrollback: 5000,
			disableStdin: !canType(),
			theme: { background: BACKGROUND },
		});
		this.fitter = new FitAddon();
		this.terminal.loadAddon(this.fitter);
		this.decoder = new TextDecoder();
		this.terminal.open(this.screen.elem);
		this.useGpuRenderer();
		redrawWhenSymbolsLoad(this.terminal);
		if (identity()?.owner) this.linkDoneMarkers();
		this.terminal.onData(data => this.sendInput(data));
		this.scrollClaudeWithWheel();
		this.terminal.onSelectionChange(() => {
			this.commentButton.elem.style.display = canNote() && this.terminal.hasSelection() ? '' : 'none';
		});

		this.connection = attach(this.options.id, {
			hello: () => ({
				kind: 'web',
				label: /Mobi|Android/.test(navigator.userAgent) ? 'phone' : 'browser',
				name: savedName(),
				...this.naturalSize(),
			}),
			onOutput: data => {
				const text = this.decoder.decode(data, { stream: true });

				loadSymbolsFor(text);
				this.terminal.write(withoutPointerReporting(text, this.trackPointerMode));
			},
			onMessage: message => this.handleMessage(message),
			onState: state => this.showConnection(state),
		});

		// Our own size only matters to the session while we drive, but the server keeps it so typing can claim it
		this.resizeObserver = new ResizeObserver(() => {
			this.connection.send({ type: 'resize', ...this.naturalSize() });
			this.fitScale();
		});
		this.resizeObserver.observe(this.screen.elem);

		this.terminal.focus();
	}

	// The default renderer builds every cell as page elements, so a large session (scaled to fit, at that) costs a
	// full layout and paint on each of Claude's redraws. WebGL draws the whole grid on the GPU, but only on a real
	// one: software WebGL (llvmpipe and the like) is slower than the DOM renderer it would replace.
	useGpuRenderer() {
		if (!hardwareWebgl()) return;

		try {
			const gpu = new WebglAddon();

			gpu.onContextLoss(() => gpu.dispose());
			this.terminal.loadAddon(gpu);
		} catch {
			// No WebGL here after all; the DOM renderer it was created with stays in use
		}
	}

	sendInput(data) {
		return Boolean(this.connection?.send({ type: 'input', data }));
	}

	naturalSize() {
		const { cols = 80, rows = 24 } = this.fitter?.proposeDimensions() ?? {};

		return { cols: Math.max(cols, 20), rows: Math.max(rows, 8) };
	}

	// The session may be sized for someone else's bigger screen; shrink to fit rather than clip
	fitScale() {
		const { cols, rows } = this.naturalSize();
		const scale = Math.min(1, cols / this.terminal.cols, rows / this.terminal.rows);

		this.terminal.element.style.transform = scale < 1 ? `scale(${scale})` : '';
	}

	showConnection(state) {
		if (state === 'unauthorized') return window.location.reload();

		this.connectionState = state;

		if (state === 'ended') this.titleLabel.elem.textContent = 'Session ended. Open it again to resume.';

		this.renderPresence(this.lastPresence ?? { clients: [] });
	}

	handleMessage(message) {
		if (message.type === 'snapshot') {
			this.terminal.reset();
			this.terminal.resize(message.cols, message.rows);
			this.decoder = new TextDecoder();
			this.pointerModes.clear();
			loadSymbolsFor(message.data);
			this.terminal.write(withoutPointerReporting(message.data, this.trackPointerMode));
			this.fitScale();
		} else if (message.type === 'size') {
			this.terminal.resize(message.cols, message.rows);
			this.fitScale();
		} else if (message.type === 'presence') {
			this.renderPresence(message);
		} else if (message.type === 'notice') {
			new Notify({ type: 'warning', content: message.text });
		} else if (NOTE_TYPES.includes(message.type)) {
			this.notes.receive(message);
		}
	}

	renderPresence(presence) {
		const { busy, waiting, title, clients, you } = presence;

		// Claude waiting, or done, is when a proposal appears or a turn's changes land
		if (this.lastPresence && (waiting !== this.lastPresence.waiting || busy !== this.lastPresence.busy))
			this.files?.changesMayHaveChanged();
		const offline = this.connectionState === 'reconnecting' || this.connectionState === 'ended';

		this.lastPresence = presence;
		this.notes.myName = clients[you]?.name;
		if (title && this.connectionState !== 'ended') this.titleLabel.elem.textContent = title;

		this.presence.empty();
		this.stateDot.elem.className = `state${busy ? ' busy' : ''}${waiting ? ' waiting' : ''}${offline ? ' offline' : ''}`;
		this.stateDot.elem.title = waiting
			? 'Claude needs you: a permission or an answer'
			: ({ reconnecting: 'Reconnecting', ended: 'Ended' }[this.connectionState] ??
				(busy ? 'Claude is working' : 'Claude is ready'));
		if (offline) {
			new Elem({
				appendTo: this.presence,
				addClass: 'status',
				textContent: { reconnecting: 'reconnecting...', ended: 'ended' }[this.connectionState],
			});
		}

		clients.forEach((client, index) => {
			new Elem({
				appendTo: this.presence,
				addClass: ['who', ...(client.sizer ? ['sizer'] : [])],
				append: [
					Object.assign(document.createElement('i'), { className: `fa-solid fa-${ICONS[client.kind] ?? 'user'}` }),
					index === you ? 'you' : client.name,
				],
				attributes: {
					title: [client.label, ROLE_LABELS[client.role], client.sizer && 'sets the terminal size']
						.filter(Boolean)
						.join(', '),
				},
			});
		});
	}

	toggleNotes(open = !this.notes.elem.classList.contains('open')) {
		this.notes.elem.classList.toggle('open', open);
		this.notesToggle.classList.toggle('active', open);
		remember(NOTES_OPEN_KEY, open ? 'yes' : '');
		if (open) this.notes.showTab(this.notes.tab);
	}

	// A side panel's inner edge drags its width; the side terminal's top edge drags its height
	addResizeHandle(panel, { variable, key, edge }) {
		const handle = document.createElement('div');
		const vertical = edge === 'top';
		const setWidth = size => {
			const [min, max] = vertical
				? [MIN_PANEL_HEIGHT, window.innerHeight * 0.85]
				: [MIN_PANEL_WIDTH, window.innerWidth * 0.9];
			const clamped = Math.round(Math.min(Math.max(size, min), max));

			panel.style.setProperty(variable, `${clamped}px`);

			return clamped;
		};

		handle.className = 'resize';
		panel.append(handle);

		if (Number(recall(key))) setWidth(Number(recall(key)));

		let bounds;
		const widthAt = event => {
			if (vertical) return bounds.bottom - event.clientY;

			return edge === 'left' ? bounds.right - event.clientX : event.clientX - bounds.left;
		};

		dragHandle(handle, {
			onStart: () => {
				bounds = panel.getBoundingClientRect();
				panel.classList.add('resizing');
			},
			onMove: event => setWidth(widthAt(event)),
			onDone: event => {
				remember(key, String(setWidth(widthAt(event))));
				panel.classList.remove('resizing');
			},
		});
	}

	toggleFiles(open = !this.files.elem.classList.contains('open')) {
		this.files.elem.classList.toggle('open', open);
		this.filesButton?.classList.toggle('active', open);
		if (open) this.files.refresh();
	}

	toggleShell(open = !this.shell.running) {
		this.shell.elem.classList.toggle('open', open);
		this.shellButton?.classList.toggle('active', open);
		if (open) this.shell.start();
		else this.shell.stop();
	}

	// Pasted rather than typed, so a multi-line attachment lands in Claude's prompt as one paste and nothing is sent
	// until someone presses Enter
	attachToPrompt(text) {
		if (!this.sendInput(`\x1b[200~${text}\x1b[201~`)) {
			new Notify({ type: 'warning', content: 'Not attached: reconnecting. Try again in a moment.' });

			return false;
		}

		this.terminal.focus();
		new Notify({ type: 'success', content: 'Added to the prompt', timeout: 1500 });

		return true;
	}

	get notesOpen() {
		return this.notes.elem.classList.contains('open');
	}

	// Someone else's chat or comment: a toast when the panel isn't showing it, and a desktop notification (if
	// switched on) when this tab isn't in front
	announce({ author, text, tab }) {
		const what = `${author} ${tab === 'comments' ? 'commented' : 'says'}: ${text}`;

		if (document.hidden) {
			showNotification({ title: 'paude', body: what, tag: `paude-${this.options.id}`, url: window.location.href });

			return;
		}

		if (!this.notesOpen || this.notes.tab !== tab) new Notify({ type: 'info', content: what, timeout: 6000 });
	}

	commentOnSelection() {
		const quote = this.terminal.getSelection().trim();

		if (!quote) return;

		this.notes.startComment(quote);
		this.terminal.clearSelection();
	}

	startLineSelect() {
		if (this.endLineSelect) return this.endLineSelect();

		this.endLineSelect = selectLinesByTap({
			terminal: this.terminal,
			screen: this.screen.elem,
			hint: text => this.lineSelectHint(text),
			purpose: 'comment on',
			onEnd: () => {
				this.endLineSelect = null;
			},
		});
	}

	// Claude scrolls its transcript itself, redrawing in place on whichever screen it uses, so the browser's own
	// scrollback has nothing in it. Mouse reporting is withheld from the browser, so the wheel goes to Claude as a
	// wheel whenever Claude has asked for one; left to xterm on the alternate screen, it would become arrow keys,
	// which Claude reads as walking through past prompts.
	scrollClaudeWithWheel() {
		this.pointerModes = new Set();
		this.trackPointerMode = (mode, on) => (on ? this.pointerModes.add(mode) : this.pointerModes.delete(mode));

		this.terminal.attachCustomWheelEventHandler(event => {
			const tracking = ['1000', '1002', '1003'].some(mode => this.pointerModes.has(mode));

			// Not asked for: xterm scrolls its own scrollback, which the alternate screen doesn't have
			if (!tracking) return this.terminal.buffer.active.type !== 'alternate';
			if (!canType() || !event.deltaY) return false;

			const bounds = this.terminal.element.getBoundingClientRect();
			const column = Math.min(
				Math.max(Math.ceil(((event.clientX - bounds.left) / bounds.width) * this.terminal.cols), 1),
				this.terminal.cols,
			);
			const row = Math.min(
				Math.max(Math.ceil(((event.clientY - bounds.top) / bounds.height) * this.terminal.rows), 1),
				this.terminal.rows,
			);
			const button = event.deltaY < 0 ? 64 : 65;
			const report = this.pointerModes.has('1006')
				? `\x1b[<${button};${column};${row}M`
				: `\x1b[M${String.fromCharCode(32 + button, 32 + column, 32 + row)}`;
			// A touchpad sends many small deltas; a notch of a wheel is about 100
			const notches = Math.max(1, Math.round(Math.abs(event.deltaY) / 100));

			this.sendInput(report.repeat(notches));

			return false;
		});
	}

	// Every "done" line Claude prints after a turn becomes a link that starts a new session from that point
	linkDoneMarkers() {
		this.terminal.registerLinkProvider({
			provideLinks: (lineNumber, callback) => {
				const text = this.bufferLine(lineNumber - 1);
				const found = DONE_MARKER.exec(text);

				if (!found) return callback(undefined);

				callback([
					{
						range: {
							start: { x: found.index + 1, y: lineNumber },
							end: { x: found.index + found[0].length, y: lineNumber },
						},
						text: found[0],
						decorations: { pointerCursor: true, underline: true },
						hover: () => this.lineSelectHint('Click to start a new session from here'),
						leave: () => this.lineSelectHint(null),
						activate: () => this.forkFromMarker(lineNumber - 1),
					},
				]);
			},
		});
	}

	bufferLine(index) {
		return this.terminal.buffer.active.getLine(index)?.translateToString(true) ?? '';
	}

	// The screen only shows text, so the marker is matched to a turn by position: the nth marker from the bottom
	// is the nth completed turn from the end, which holds even when older scrollback is gone. The confirmation
	// shows that turn's prompt, so a mismatch is visible before anything is created.
	async forkFromMarker(markerLine) {
		this.lineSelectHint(null);

		let markersBelow = 0;

		for (let index = markerLine + 1; index < this.terminal.buffer.active.length; index++) {
			if (DONE_MARKER.test(this.bufferLine(index))) markersBelow += 1;
		}

		const { body, response } = await getTurns(this.options.id);

		if (!response?.ok) return new Notify({ type: 'error', content: "Could not read this session's history." });

		// A turn still in progress has replies but no marker yet
		const turns = body.busy && body.turns.at(-1)?.last ? body.turns.slice(0, -1) : body.turns;
		const turn = turns[turns.length - 1 - markersBelow];

		if (!turn) return new Notify({ type: 'warning', content: 'Could not match that line to a turn in the history.' });

		const confirmed = await confirmDialog({
			header: 'New session from here?',
			body: `It will hold this conversation up to and including the turn that began: "${turn.prompt}"`,
			confirmLabel: 'Start it',
		});

		if (!confirmed) return;

		const forked = await forkSession(this.options.id, turn.endUuid);

		if (!forked.response?.ok) return new Notify({ type: 'error', content: 'Could not start the new session.' });

		window.location.hash = `#/sessions/${forked.body.id}`;
	}

	showWatching(watching) {
		this.watching = Boolean(watching);
		this.watchButton.classList.toggle('active', this.watching);
		this.watchButton.firstChild.className = `fa-solid fa-${this.watching ? 'eye' : 'eye-slash'}`;
		this.watchButton.title = this.watching
			? 'Watching: what changes here is counted while you are away. Click to stop.'
			: 'Not watching. Click to count what changes here while you are away.';
	}

	async toggleWatching() {
		const { response } = await setWatching(this.options.id, !this.watching);

		if (response?.ok) this.showWatching(!this.watching);
	}

	async rename() {
		const { body } = await getSession(this.options.id);
		const name = await nameDialog({ current: body?.title, pinned: body?.pinned });

		if (name === null) return;

		const { response } = await nameSession(this.options.id, name);

		if (!response?.ok) return new Notify({ type: 'error', content: 'Could not rename it.' });

		// A session that isn't running has no presence to bring the new name, so the page fetches it
		const { body: renamed } = await getSession(this.options.id);

		if (renamed?.title) this.titleLabel.elem.textContent = renamed.title;
	}

	async deleteThisSession() {
		const { body } = await getSession(this.options.id);

		if (await confirmDeleteSession({ id: this.options.id, title: body?.title }, deleteSession)) {
			window.location.hash = this.project ? `#/projects/${this.project}` : '#/';
		}
	}

	lineSelectHint(text) {
		this.selectHint.elem.textContent = text ?? '';
		this.selectHint.elem.style.display = text ? '' : 'none';
	}

	jumpTo(quote) {
		const quoteLines = quote.split('\n').map(line => line.trim());
		const anchor = quoteLines.find(Boolean);

		if (!anchor) return;

		const lines = bufferLines(this.terminal);

		for (let index = lines.length - 1; index >= 0; index--) {
			if (!lines[index].includes(anchor)) continue;

			const start = index - quoteLines.indexOf(anchor);

			this.terminal.scrollToLine(Math.max(0, start - 2));
			this.terminal.selectLines(Math.max(0, start), Math.max(0, start) + quoteLines.length - 1);
			if (window.matchMedia(NARROW).matches) this.toggleNotes(false);

			return;
		}

		new Notify({ type: 'warning', content: 'That text is no longer in the terminal history.' });
	}
}
