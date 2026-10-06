import { Button, Elem, Notify, View, styled } from '@vanilla-bean/components';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { getSession } from '../api';
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
		border-radius: 10px;
		border: 1px solid rgba(255, 255, 255, 0.12);
		background: rgba(24, 24, 27, 0.35);
		backdrop-filter: blur(10px) saturate(140%);
		-webkit-backdrop-filter: blur(10px) saturate(140%);
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
		width: min(62%, calc(100% - 16px));
		transform: translateX(-12px);
	}

	.notes .resize {
		position: absolute;
		left: 0;
		top: 0;
		bottom: 0;
		width: 6px;
		cursor: ew-resize;
		z-index: 1;
	}

	.notes .resize:hover,
	.notes.resizing .resize {
		background: rgba(255, 255, 255, 0.15);
	}

	.notes.resizing {
		transition: none;
	}

	@media ${NARROW} {
		.notes {
			inset: 0;
			width: auto;
			border-radius: 0;
			border: none;
		}

		.notes .resize {
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

const NotesToggle = styled(
	Button,
	() => `
		flex-shrink: 0;
	`,
);

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

		.who {
			padding: 2px 8px;
			border-radius: 10px;
			background: ${colors.alpha(colors.white, 0.08)};
			white-space: nowrap;
		}

		.who.driver {
			outline: 1px solid ${colors.light(colors.orange)};
		}

		.status {
			color: ${colors.gray};
		}

		.status.busy {
			color: ${colors.light(colors.orange)};
		}
	`,
);

const ICONS = { web: '🌐', terminal: '⌨' };
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
const MIN_NOTES_WIDTH = 260;
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
		const header = new Header({ appendTo: this, style: { maxWidth: 'none' } });

		if (identity()?.owner) {
			new Button({
				appendTo: header,
				icon: 'arrow-left',
				onPointerPress: () => (window.location.hash = this.project ? `#/projects/${this.project}` : '#/'),
			});
		} else {
			new Button({
				appendTo: header,
				textContent: 'Leave',
				onPointerPress: async () => {
					await fetch('/api/logout', { method: 'POST' });
					window.location.reload();
				},
			});
		}
		this.titleLabel = new Elem({ appendTo: header, addClass: 'title' });
		this.presence = new Presence({ appendTo: header });

		const body = new Body({ appendTo: this });

		if (canNote()) {
			new NotesToggle({
				appendTo: header,
				textContent: '📁',
				title: 'Project files',
				onPointerPress: () => this.toggleFiles(),
			});
		}
		this.notesToggle = new NotesToggle({
			appendTo: header,
			textContent: '💬',
			onPointerPress: () => this.toggleNotes(),
		});
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
				this.notesToggle.elem.textContent = count ? `💬 ${count}` : '💬';
			},
		});

		this.addResizeHandle();
		if (recall(NOTES_OPEN_KEY)) this.toggleNotes(true);

		this.loadInfo();
	}

	async loadInfo() {
		const { body, response } = await getSession(this.options.id);

		if (!response?.ok) return;

		this.project = body.project;
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
		this.terminal.onData(data => this.sendInput(data));
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
			onOutput: data => this.terminal.write(withoutPointerReporting(this.decoder.decode(data, { stream: true }))),
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
			this.terminal.write(withoutPointerReporting(message.data));
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
		const { busy, title, clients, you } = presence;
		const offline = this.connectionState === 'reconnecting' || this.connectionState === 'ended';

		this.lastPresence = presence;
		this.notes.myName = clients[you]?.name;
		if (title && this.connectionState !== 'ended') this.titleLabel.elem.textContent = title;

		this.presence.empty();
		new Elem({
			appendTo: this.presence,
			addClass: ['status', ...(busy || offline ? ['busy'] : [])],
			textContent:
				{ reconnecting: 'reconnecting...', ended: 'ended' }[this.connectionState] ?? (busy ? 'working' : 'idle'),
		});

		clients.forEach((client, index) => {
			new Elem({
				appendTo: this.presence,
				addClass: ['who', ...(client.driver ? ['driver'] : [])],
				textContent: `${ICONS[client.kind] ?? ''} ${index === you ? 'you' : client.name}`,
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
		remember(NOTES_OPEN_KEY, open ? 'yes' : '');
		if (open) this.notes.showTab(this.notes.tab);
	}

	// Dragging the panel's left edge sets its width, kept between sessions
	addResizeHandle() {
		const panel = this.notes.elem;
		const handle = document.createElement('div');
		const setWidth = width => {
			const clamped = Math.round(Math.min(Math.max(width, MIN_NOTES_WIDTH), window.innerWidth * 0.8));

			panel.style.setProperty('--notes-width', `${clamped}px`);

			return clamped;
		};

		handle.className = 'resize';
		panel.append(handle);

		if (Number(recall(NOTES_WIDTH_KEY))) setWidth(Number(recall(NOTES_WIDTH_KEY)));

		handle.addEventListener('pointerdown', start => {
			start.preventDefault();
			handle.setPointerCapture(start.pointerId);
			panel.classList.add('resizing');

			const right = panel.getBoundingClientRect().right;
			const move = event => setWidth(right - event.clientX);
			const stop = event => {
				remember(NOTES_WIDTH_KEY, String(setWidth(right - event.clientX)));
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
