import { Button, Elem, Notify, View, styled } from '@vanilla-bean/components';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { getSession } from '../api';
import { canNote, canType, identity } from '../identity';
import { Header } from '../Layout';
import { NOTE_TYPES } from '../../shared/protocol';
import attach from './attach';
import KeyBar from './KeyBar';
import NotesPanel, { savedName } from './NotesPanel';

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

	.notes {
		width: 340px;
		flex-shrink: 0;
	}

	@media ${NARROW} {
		.notes {
			position: absolute;
			inset: 0;
			width: auto;
			z-index: 2;
			display: none;
		}

		.notes.open {
			display: flex;
		}
	}
`;

// Phones have the key bar's Select instead
const SelectButton = styled(
	Button,
	() => `
		flex-shrink: 0;

		@media (pointer: coarse) {
			display: none;
		}
	`,
);

// Only needed where the panel isn't already showing beside the terminal
const NotesToggle = styled(
	Button,
	() => `
		flex-shrink: 0;

		@media not ${NARROW} {
			display: none;
		}
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
		// Claude Code takes mouse drags for itself, so plain dragging never selects: Shift+drag does, or this
		if (canNote()) {
			new SelectButton({
				appendTo: header,
				textContent: 'Select',
				title: 'Comment on lines: click the first, then the last (or Shift+drag)',
				onPointerPress: () => this.startLineSelect(),
			});
		}

		const body = new Body({ appendTo: this });

		this.notesToggle = new NotesToggle({
			appendTo: header,
			textContent: '💬',
			onPointerPress: () => this.toggleNotes(),
		});
		const column = new Elem({ appendTo: body, addClass: 'terminal-column' });

		this.screen = new Screen({ appendTo: column });
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

		this.notes = new NotesPanel({
			appendTo: body,
			addClass: 'notes',
			sessionId: this.options.id,
			send: message => this.connection?.send(message),
			jump: quote => this.jumpTo(quote),
			reveal: () => this.toggleNotes(true),
			showUnread: count => {
				this.notesToggle.elem.textContent = count ? `💬 ${count}` : '💬';
			},
		});

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
			onOutput: data => this.terminal.write(data),
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
	// full layout and paint on each of Claude's redraws. WebGL draws the whole grid on the GPU; the DOM renderer stays
	// as the fallback where WebGL is missing or its context is lost.
	useGpuRenderer() {
		try {
			const gpu = new WebglAddon();

			gpu.onContextLoss(() => gpu.dispose());
			this.terminal.loadAddon(gpu);
		} catch (error) {
			console.warn('WebGL unavailable; using the DOM renderer', error);
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
			this.terminal.write(message.data);
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
		if (open) this.notes.showTab(this.notes.tab);
	}

	commentOnSelection() {
		const quote = this.terminal.getSelection().trim();

		if (!quote) return;

		this.notes.startComment(quote);
		this.terminal.clearSelection();
	}

	// Touch screens can't drag-select in a terminal: tap the first line, then the last
	startLineSelect() {
		const screen = this.screen.elem;
		let first = null;

		screen.classList.add('selecting');

		const rowAt = event => {
			const rect = this.terminal.element.querySelector('.xterm-screen').getBoundingClientRect();
			const row = Math.floor(((event.clientY - rect.top) / rect.height) * this.terminal.rows);

			return Math.min(Math.max(row, 0), this.terminal.rows - 1) + this.terminal.buffer.active.viewportY;
		};

		const onTap = event => {
			event.preventDefault();
			event.stopPropagation();

			const row = rowAt(event);

			if (first === null) {
				first = row;
				this.terminal.selectLines(row, row);

				return;
			}

			this.terminal.selectLines(Math.min(first, row), Math.max(first, row));
			screen.classList.remove('selecting');
			screen.removeEventListener('pointerdown', onTap, true);
		};

		screen.addEventListener('pointerdown', onTap, true);
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
