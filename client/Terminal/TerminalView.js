import { Button, Elem, Notify, View, styled } from '@vanilla-bean/components';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { deleteSession, forkSession, getSession, getTurns, nameSession, setWatching } from '../api';
import confirmDialog, { confirmDeleteSession, nameDialog } from '../confirmDialog';
import { canNote, canType, identity } from '../identity';
import { Header } from '../Layout';
import withoutPointerReporting from '../../shared/pointerReporting';
import { NOTE_TYPES } from '../../shared/protocol';
import attach from './attach';
import KeyBar from './KeyBar';
import FilesPanel from './FilesPanel';
import NotesPanel, { desktopNotificationsOn, recall, remember, savedName } from './NotesPanel';

const BACKGROUND = '#1b1b1b';
const touch = window.matchMedia('(pointer: coarse)').matches;
// Below this the notes panel opens over the terminal instead of beside it
const NARROW = '(max-width: 800px)';

const Body = styled.Component`
	flex: 1;
	min-height: 0;
	display: flex;
	position: relative;

	.terminal-column {
		flex: 1;
		min-width: 0;
		display: flex;
		flex-direction: column;
		position: relative;
	}

	/* Floats over the terminal rather than taking a column, so opening it never changes the session's size */
	.notes,
	.files {
		position: absolute;
		top: 8px;
		bottom: 8px;
		z-index: 2;
		box-sizing: border-box;
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(24, 24, 27, 0.04);
		backdrop-filter: blur(18px) saturate(160%);
		-webkit-backdrop-filter: blur(18px) saturate(160%);
		box-shadow: 0 8px 32px rgba(0, 0, 0, 0.45);
		overflow: hidden;
		opacity: 0;
		pointer-events: none;
		transition:
			opacity 0.15s ease,
			transform 0.15s ease;
	}

	.notes.open,
	.files.open {
		opacity: 1;
		transform: none;
		pointer-events: auto;
	}

	.notes {
		right: 8px;
		width: min(var(--notes-width, 360px), calc(100% - 16px));
		transform: translateX(12px);
	}

	/* Reading code wants room; it opens from the other side */
	.files {
		left: 8px;
		width: min(var(--files-width, 62%), calc(100% - 16px));
		transform: translateX(-12px);
	}

	.files.fullscreen {
		inset: 8px;
		width: auto;
	}

	.resize {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: ew-resize;
		z-index: 3;
	}

	.notes .resize {
		left: 0;
	}

	.files .resize {
		right: 0;
	}

	.files.fullscreen .resize {
		display: none;
	}

	.resize:hover,
	.resizing .resize {
		background: rgba(255, 255, 255, 0.15);
	}

	.resizing {
		transition: none;
	}

	@media ${NARROW} {
		.notes {
			inset: 0;
			width: auto;
			border-radius: 0;
			border: none;
		}

		.resize {
			display: none;
		}

		.files {
			inset: 0;
			width: auto;
			border-radius: 0;
			border: none;
		}
	}
`;

// A slim strip of glass, in keeping with the panels that float beneath it
const TopBar = styled(
	Header,
	({ colors }) => `
		max-width: none;
		gap: 4px;
		padding: 6px 10px;
		background: rgba(24, 24, 27, 0.55);
		backdrop-filter: blur(12px);
		-webkit-backdrop-filter: blur(12px);
		border-bottom: 1px solid rgba(255, 255, 255, 0.07);

		.title {
			display: flex;
			align-items: center;
			gap: 8px;
			font-size: 1em;
			min-width: 0;
		}

		.crumb {
			color: ${colors.gray};
			font-weight: normal;
			cursor: pointer;
			flex-shrink: 0;
		}

		.crumb:hover {
			color: ${colors.white};
		}

		.name {
			overflow: hidden;
			text-overflow: ellipsis;
		}

		.state {
			width: 8px;
			height: 8px;
			flex-shrink: 0;
			border-radius: 50%;
			background: ${colors.alpha(colors.white, 0.25)};
		}

		.state.busy {
			background: ${colors.light(colors.orange)};
			animation: paude-pulse 1.2s ease-in-out infinite;
		}

		.state.waiting {
			background: hsl(38, 70%, 60%);
			box-shadow: 0 0 0 3px hsla(38, 70%, 60%, 0.3);
			animation: none;
		}

		.state.offline {
			background: ${colors.red};
		}

		@keyframes paude-pulse {
			50% {
				opacity: 0.35;
			}
		}

		.ghost {
			position: relative;
			flex-shrink: 0;
			min-width: 32px;
			height: 32px;
			padding: 0 8px;
			border: none;
			border-radius: 6px;
			background: transparent;
			color: ${colors.alpha(colors.white, 0.7)};
			font: inherit;
			cursor: pointer;
		}

		.ghost:hover {
			background: ${colors.alpha(colors.white, 0.08)};
			color: ${colors.white};
		}

		.ghost.active {
			background: ${colors.alpha(colors.blue, 0.25)};
			color: ${colors.lighter(colors.blue)};
		}

		.ghost.danger:hover {
			color: ${colors.light(colors.red)};
		}

		.ghost .count {
			position: absolute;
			top: 1px;
			right: 0;
			min-width: 14px;
			padding: 0 3px;
			border-radius: 7px;
			background: ${colors.orange};
			color: ${colors.white};
			font-size: 10px;
			line-height: 14px;
		}

		.divider {
			width: 1px;
			height: 20px;
			margin: 0 4px;
			background: rgba(255, 255, 255, 0.1);
		}
	`,
);

// A plain icon button for the top bar
const ghostButton = (appendTo, { icon, label, title, onPress, className = '' }) => {
	const button = document.createElement('button');

	button.className = `ghost ${className}`;
	button.title = title ?? '';
	if (icon) button.append(Object.assign(document.createElement('i'), { className: `fa-solid fa-${icon}` }));
	if (label) button.append(label);
	button.addEventListener('click', onPress);
	appendTo.elem.append(button);

	return button;
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

const SelectHint = styled(
	Elem,
	({ colors }) => `
		position: absolute;
		left: 50%;
		top: 12px;
		transform: translateX(-50%);
		z-index: 1;
		padding: 6px 12px;
		border-radius: 14px;
		background: ${colors.alpha(colors.black, 0.75)};
		color: ${colors.light(colors.orange)};
		pointer-events: none;
	`,
);

const CommentButton = styled(
	Button,
	() => `
		position: absolute;
		right: 12px;
		bottom: 12px;
		z-index: 1;
	`,
);

const Presence = styled(
	Elem,
	({ colors }) => `
		display: flex;
		gap: 6px;
		flex-shrink: 0;
		font-size: 0.8em;
		overflow: hidden;

		align-items: center;

		.who {
			display: flex;
			align-items: center;
			gap: 5px;
			padding: 2px 8px;
			border-radius: 10px;
			background: ${colors.alpha(colors.white, 0.06)};
			color: ${colors.alpha(colors.white, 0.75)};
			white-space: nowrap;
		}

		.who i {
			font-size: 0.85em;
			opacity: 0.6;
		}

		.who.driver {
			box-shadow: inset 0 0 0 1px ${colors.alpha(colors.orange, 0.6)};
		}

		.status {
			color: ${colors.light(colors.orange)};
		}
	`,
);

const ICONS = { web: 'globe', terminal: 'terminal' };
// Claude's line at the end of each turn, e.g. "✻ Cooked for 2s · done 2:48 PM"
const DONE_MARKER = /\S+ for (?:\d+[hms] ?)+ · done \d{1,2}:\d{2}\s?[AP]M/;
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
const ROLE_LABELS = { owner: 'owner', drive: 'can type', comment: 'can chat and comment', watch: 'watching' };

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
			onDisconnected: () => {
				this.connection?.close();
				this.resizeObserver?.disconnect();
				this.terminal?.dispose();
			},
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

		if (canNote()) {
			this.filesButton = ghostButton(header, {
				icon: 'folder-tree',
				title: 'Project files',
				onPress: () => this.toggleFiles(),
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
		if (canType()) {
			new KeyBar({
				appendTo: column,
				sendKey: data => this.sendInput(data),
				selectLines: () => this.startLineSelect(),
			});
		}

		this.files = new FilesPanel({
			appendTo: body,
			addClass: 'files',
			sessionId: this.options.id,
			close: () => this.toggleFiles(false),
			setFullscreen: on => this.files.elem.classList.toggle('fullscreen', on),
			attach: text => this.attachToPrompt(text),
		});
		this.notes = new NotesPanel({
			appendTo: body,
			addClass: 'notes',
			sessionId: this.options.id,
			send: message => this.connection?.send(message),
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

		this.terminal = new Terminal({
			fontFamily: 'ui-monospace, "Cascadia Mono", "DejaVu Sans Mono", Menlo, monospace',
			fontSize: touch ? 12 : 14,
			lineHeight: 1.15,
			scrollback: 5000,
			cursorBlink: true,
			allowProposedApi: true,
			disableStdin: !canType(),
			theme: { background: BACKGROUND },
		});
		this.fitter = new FitAddon();
		this.terminal.loadAddon(this.fitter);
		this.decoder = new TextDecoder();
		this.terminal.open(this.screen.elem);
		this.useGpuRenderer();
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
			onOutput: data =>
				this.terminal.write(
					withoutPointerReporting(this.decoder.decode(data, { stream: true }), this.trackPointerMode),
				),
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
		this.connection?.send({ type: 'input', data });
	}

	// How many cells fit this screen at full font size
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
		const offline = this.connectionState === 'reconnecting' || this.connectionState === 'ended';

		this.lastPresence = presence;
		this.notes.myName = clients[you]?.name;
		if (title && this.connectionState !== 'ended') this.titleLabel.elem.textContent = title;

		this.presence.empty();
		this.stateDot.elem.className = `state${busy ? ' busy' : ''}${waiting ? ' waiting' : ''}${offline ? ' offline' : ''}`;
		this.stateDot.elem.title = waiting
			? 'Claude is waiting on someone: a permission or a question'
			: ({ reconnecting: 'Reconnecting', ended: 'Ended' }[this.connectionState] ??
				(busy ? 'Claude is working' : 'Claude is idle'));
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
				addClass: ['who', ...(client.driver ? ['driver'] : [])],
				append: [
					Object.assign(document.createElement('i'), { className: `fa-solid fa-${ICONS[client.kind] ?? 'user'}` }),
					index === you ? 'you' : client.name,
				],
				attributes: {
					title: [client.label, ROLE_LABELS[client.role], client.driver && 'sets the terminal size']
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

	// Dragging the panel's left edge sets its width, kept between sessions
	// Dragging the panel's inner edge sets its width, remembered per panel
	addResizeHandle(panel, { variable, key, edge }) {
		const handle = document.createElement('div');
		const setWidth = width => {
			const clamped = Math.round(Math.min(Math.max(width, MIN_PANEL_WIDTH), window.innerWidth * 0.9));

			panel.style.setProperty(variable, `${clamped}px`);

			return clamped;
		};

		handle.className = 'resize';
		panel.append(handle);

		if (Number(recall(key))) setWidth(Number(recall(key)));

		handle.addEventListener('pointerdown', start => {
			start.preventDefault();
			handle.setPointerCapture(start.pointerId);
			panel.classList.add('resizing');

			const bounds = panel.getBoundingClientRect();
			const widthAt = event => (edge === 'left' ? bounds.right - event.clientX : event.clientX - bounds.left);
			const move = event => setWidth(widthAt(event));
			const stop = event => {
				remember(key, String(setWidth(widthAt(event))));
				panel.classList.remove('resizing');
				handle.removeEventListener('pointermove', move);
				handle.removeEventListener('pointerup', stop);
			};

			handle.addEventListener('pointermove', move);
			handle.addEventListener('pointerup', stop);
		});
	}

	toggleFiles(open = !this.files.elem.classList.contains('open')) {
		this.files.elem.classList.toggle('open', open);
		this.filesButton?.classList.toggle('active', open);
		if (open) this.files.refresh();
	}

	// Pasted rather than typed, so a multi-line attachment lands in Claude's prompt as one paste and nothing is sent
	// until someone presses Enter
	attachToPrompt(text) {
		this.sendInput(`\x1b[200~${text}\x1b[201~`);
		this.terminal.focus();
		// Out of the way of the prompt it just added to; reopening returns to the same file and lines
		this.toggleFiles(false);
		new Notify({ type: 'success', content: 'Added to the prompt', timeout: 1500 });
	}

	get notesOpen() {
		return this.notes.elem.classList.contains('open');
	}

	// Someone else's chat or comment: a toast when the panel isn't showing it, and a desktop notification (if
	// switched on) when this tab isn't in front
	announce({ author, text, tab }) {
		const what = `${author} ${tab === 'comments' ? 'commented' : 'says'}: ${text}`;

		if (document.hidden) {
			if (desktopNotificationsOn()) new Notification('paude', { body: what, tag: `paude-${this.options.id}` });

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

	// Touch screens can't drag-select in a terminal: tap the first line, then the last
	// Touch screens can't drag-select in a terminal: tap the first line, then the last. Every touch is swallowed
	// before xterm sees it, or xterm would move or clear the selection between the two taps.
	startLineSelect() {
		const screen = this.screen.elem;

		if (this.endLineSelect) return this.endLineSelect();

		let first = null;
		const swallow = event => {
			event.preventDefault();
			event.stopPropagation();
		};
		const rowAt = event => {
			const rect = this.terminal.element.querySelector('.xterm-screen').getBoundingClientRect();
			const row = Math.floor(((event.clientY - rect.top) / rect.height) * this.terminal.rows);

			return Math.min(Math.max(row, 0), this.terminal.rows - 1) + this.terminal.buffer.active.viewportY;
		};
		const onTap = event => {
			swallow(event);

			const row = rowAt(event);

			if (first === null) {
				first = row;
				this.terminal.selectLines(row, row);
				this.lineSelectHint('Now tap the last line');

				return;
			}

			this.terminal.selectLines(Math.min(first, row), Math.max(first, row));
			this.endLineSelect();
		};
		const SWALLOWED = ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'];

		screen.classList.add('selecting');
		this.lineSelectHint('Tap the first line to comment on');
		screen.addEventListener('pointerup', onTap, true);
		for (const type of SWALLOWED) screen.addEventListener(type, swallow, { capture: true, passive: false });

		this.endLineSelect = () => {
			screen.classList.remove('selecting');
			screen.removeEventListener('pointerup', onTap, true);
			for (const type of SWALLOWED) screen.removeEventListener(type, swallow, { capture: true });
			this.lineSelectHint(null);
			this.endLineSelect = null;
		};
	}

	// Claude draws on the alternate screen, which has no scrollback, and keeps its transcript's scrolling to itself.
	// With mouse reporting withheld from the browser, xterm would turn the wheel into arrow keys, which Claude reads
	// as walking through past prompts; the wheel goes to Claude as a wheel instead, when Claude has asked for one.
	scrollClaudeWithWheel() {
		this.pointerModes = new Set();
		this.trackPointerMode = (mode, on) => (on ? this.pointerModes.add(mode) : this.pointerModes.delete(mode));

		this.terminal.attachCustomWheelEventHandler(event => {
			if (this.terminal.buffer.active.type !== 'alternate') return true;

			const tracking = ['1000', '1002', '1003'].some(mode => this.pointerModes.has(mode));

			if (!tracking || !canType() || !event.deltaY) return false;

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
		const turns = body.busy ? body.turns.slice(0, -1) : body.turns;
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

	// Finds a comment's quote in the scrollback (the most recent match) and highlights it
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
