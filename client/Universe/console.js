import { Notify } from '@vanilla-bean/components';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { getAsking } from '../api';
import { AskingCard, showAsking } from '../Asking';
import { canBrowse, canNote, canType, identity } from '../identity';
import attach from '../Terminal/attach';
import { claudePointer, wheelToClaude } from '../Terminal/claudePointer';
import claudeKeys from '../Terminal/claudeKeys';
import { besideSelection, clickToClaude, forkButtons, forkFromMarker, touchToClaude } from '../Terminal/claudeTerminal';
import { acceptFiles } from '../Terminal/fileDrop';
import { copyAsSelected, copySelection, selectedText } from '../Terminal/copySelection';
import KeyBar from '../Terminal/KeyBar';
import selectLinesByTap from '../Terminal/lineSelect';
import { linkFilePaths, linkUrls } from '../Terminal/linkProviders';
import xtermOptions, { loadSymbolsFor, redrawWhenSymbolsLoad } from '../Terminal/xtermOptions';
import { button, element } from '../dom';
import { FONT, fitFont, roomFor } from './fitFont';
import withoutPointerReporting from '../../shared/pointerReporting';

// The dock's own width, the least it narrows to for a small terminal
const DOCK_LEAST = 620;
// The screen's padding top and bottom together, in CSS pixels, which a terminal too tall for it is lifted inside of
const FOOT_PADDING = 4;

// A session's terminal in its dock, at the session's own size so opening it here resizes nothing for anyone, its font
// as large as lets that size fit (smaller than the least, it scrolls across). Sized by its font, never a CSS transform:
// a transform blurs the text and puts clicks where they aren't. It works as the session's own page's does: the same
// keys, clicks, wheel and touch, selection, links, and new sessions from a past turn.
export default class TerminalPanel {
	// `openFile(path, line, lastLine)` opens a file path Claude names; `comment(quote)` starts a comment on a selection;
	// `toShell(text)` puts it on the side shell's command line; `onForked(id)` goes to a session started from a past turn
	constructor({ appendTo, session, addClass = [], openFile, comment, toShell, onForked }) {
		this.session = session;
		this.openFile = openFile;
		this.comment = comment;
		this.onForked = onForked;
		this.elem = element('div', ['docked-terminal', ...addClass].join(' '));
		this.state = element('div', 'about', 'connecting…');
		this.screen = element('div', 'screen');

		const here = !session.engine.remote;

		// What can be done with what's selected, as on the session's own page, beside it
		this.selected = element('div', 'selected');
		this.selected.style.display = 'none';
		this.selected.append(
			button('Copy', () => copySelection(this.terminal, { unwrap: true }), { icon: 'copy', className: 'variant-flat' }),
			...(canType() && toShell
				? [
						button('Shell', () => this.toShell(toShell), {
							icon: 'terminal',
							className: 'variant-flat',
							title: "Put it on the shell's command line",
						}),
					]
				: []),
			...(canNote() && comment && here
				? [button('Comment', () => this.commentOnSelection(), { icon: 'comment', className: 'variant-flat' })]
				: []),
		);
		// Pressed without taking the focus, so the selection is still there to act on
		this.selected.addEventListener('pointerdown', event => event.preventDefault());
		this.selected.addEventListener('mousedown', event => event.preventDefault());
		this.hint = element('div', 'select-hint');
		this.hint.style.display = 'none';
		// What Claude asks, as buttons over the terminal's foot, on a touch screen where its own dialog is hard to work
		this.asking = new AskingCard({ addClass: 'asking-overlay' });
		this.elem.append(this.state, this.selected, this.hint, this.screen, this.asking.elem);
		appendTo.append(this.elem);
	}

	toShell(send) {
		const text = this.terminal && selectedText(this.terminal, { unwrap: true }).replace(/\s+$/, '');

		if (!text) return;
		send(text);
		this.terminal.clearSelection();
	}

	startLineSelect() {
		if (this.endLineSelect) return this.endLineSelect();

		this.endLineSelect = selectLinesByTap({
			terminal: this.terminal,
			screen: this.screen,
			hint: text => {
				this.hint.textContent = text ?? '';
				this.hint.style.display = text ? '' : 'none';
			},
			purpose: 'copy or comment on',
			onEnd: () => {
				this.endLineSelect = null;
			},
		});
	}

	// Asked again shortly after Claude starts waiting, as the question may not be written down yet
	async showAsking(waiting) {
		const shown = this.asking.elem.classList;

		shown.remove('shown');
		for (const wait of waiting && !this.session.engine.remote ? [0, 400, 1500] : []) {
			await new Promise(resolve => setTimeout(resolve, wait));
			if (!this.waiting) return;

			const { body } = await getAsking(this.session.id);

			if (body?.asking) {
				showAsking(this.asking, this.session.id, body.asking, {
					canAnswer: canType(),
					onAnswered: () => shown.remove('shown'),
				});
				shown.add('shown');

				return;
			}
		}
	}

	commentOnSelection() {
		const quote = this.terminal?.getSelection().trim();

		if (!quote) return;
		this.comment(quote);
		this.terminal.clearSelection();
	}

	// Where a quote from the chat is in the terminal's history, scrolled to and selected
	jumpTo(quote) {
		const lines = quote.split('\n').map(line => line.trim());
		const anchor = lines.find(Boolean);
		const buffer = this.terminal?.buffer.active;

		if (!anchor) return;
		// Its history not here yet: once it is
		if (!this.arrived) {
			this.pendingJump = quote;

			return;
		}
		for (let index = buffer.length - 1; index >= 0; index--) {
			if (!(buffer.getLine(index)?.translateToString(true) ?? '').includes(anchor)) continue;

			const start = Math.max(0, index - lines.indexOf(anchor));

			this.terminal.scrollToLine(Math.max(0, start - 2));
			this.terminal.selectLines(start, start + lines.length - 1);

			return;
		}
		new Notify({ intent: 'warning', content: 'That text is no longer in the terminal history.' });
	}

	// Pasted rather than typed, so it lands in Claude's prompt as one paste and nothing is sent until Enter
	paste(text) {
		if (!this.connection?.send({ type: 'input', data: `\x1b[200~${text}\x1b[201~` }))
			return new Notify({ intent: 'warning', content: 'Not attached: reconnecting. Try again in a moment.' });
		this.terminal.focus();
		new Notify({ intent: 'success', content: 'Added to the prompt', timeout: 1500 });
	}

	start() {
		if (this.terminal) return this.fit();

		const { session } = this;
		const { cols = 100, rows = 30 } = session.screen ?? {};
		const { remote } = session.engine;
		const through = remote ? `/api/remotes/at/${encodeURIComponent(remote.url)}` : '';
		// See-through, so the ship shows behind it
		const terminal = new Terminal({
			...xtermOptions,
			fontSize: FONT.most,
			scrollback: 5000,
			disableStdin: !canType(),
			allowTransparency: true,
			theme: { ...xtermOptions.theme, background: 'rgba(0, 0, 0, 0)' },
		});
		let decoder = new TextDecoder();

		const pointer = claudePointer(terminal);

		this.terminal = terminal;
		terminal.open(this.screen);
		terminal.resize(cols, rows);
		const send = data => Boolean(this.connection?.send({ type: 'input', data }));
		const over = on => (this.overLink = on);
		const shared = { terminal, screen: this.screen, pointer, send, canType };

		// Its URLs open in a new tab and the project's files it names in the dock's files
		linkUrls(terminal, { over });
		if (canBrowse() && this.openFile && !remote) linkFilePaths(terminal, session.id, { over, open: this.openFile });
		terminal.attachCustomKeyEventHandler(claudeKeys({ terminal, send, canType }));
		copyAsSelected(terminal, { unwrap: true });
		terminal.onSelectionChange(() => besideSelection(terminal, this.selected));
		// Output scrolls the selection, and the buttons with it, except from under a pointer reaching for them
		terminal.onScroll(() => {
			if (!this.selected.matches(':hover')) besideSelection(terminal, this.selected);
		});
		redrawWhenSymbolsLoad(terminal);
		terminal.onData(send);
		wheelToClaude(terminal, pointer, send, { allowed: canType });
		touchToClaude({ ...shared, paused: () => Boolean(this.endLineSelect) });
		clickToClaude({ ...shared, paused: () => Boolean(this.endLineSelect || this.overLink) });
		if (identity()?.owner && !remote && this.onForked)
			forkButtons({
				terminal,
				screen: this.screen,
				onFork: line => forkFromMarker({ terminal, sessionId: session.id, line, go: this.onForked }),
			});
		if (canNote())
			this.elem.append(
				new KeyBar({ ...(canType() && { sendKey: send }), selectLines: () => this.startLineSelect() }).elem,
			);
		if (canType()) acceptFiles(this.screen, session.id, text => this.paste(text), through);
		this.connection = attach(session.id, {
			...(remote && { url: `${window.location.origin}${through}` }),
			hello: () => ({ kind: 'web', label: 'universe', cols: terminal.cols, rows: terminal.rows }),
			onOutput: data => {
				const text = decoder.decode(data, { stream: true });

				loadSymbolsFor(text);
				terminal.write(withoutPointerReporting(text, pointer.track));
			},
			onMessage: message => {
				if (message.type === 'snapshot') {
					// A new socket: what's claimed is told again once it's fitted
					this.natural = null;
					terminal.reset();
					terminal.resize(message.cols, message.rows);
					decoder = new TextDecoder();
					loadSymbolsFor(message.data);
					pointer.reset();
					terminal.write(withoutPointerReporting(message.data, pointer.track), () => {
						this.arrived = true;
						this.fit();
						if (this.pendingJump) this.jumpTo(this.pendingJump);
						this.pendingJump = null;
					});
				} else if (message.type === 'size') {
					terminal.resize(message.cols, message.rows);
					this.fit();
				} else if (message.type === 'presence') {
					if (Boolean(message.waiting) !== Boolean(this.waiting)) {
						this.waiting = message.waiting;
						this.showAsking(message.waiting);
					}
				} else if (message.type === 'notice') new Notify({ intent: 'warning', content: message.text });
			},
			onState: value => {
				this.state.textContent =
					{
						connected: 'live',
						reconnecting: 'reconnecting…',
						ended: 'ended',
						// Another paude's session refused on this machine's login there, which only that command renews
						unauthorized: remote ? `the login on ${remote.name} has ended; run: paude login ${remote.url}` : undefined,
					}[value] ?? value;
			},
		});
		this.resizing = new ResizeObserver(() => this.fit());
		this.resizing.observe(this.elem);
		this.fit();
		if (canType()) terminal.focus();
	}

	// The font as large as lets the session's columns fit the widest the dock can take and its rows the dock's height;
	// then the dock as wide as the terminal drawn at it
	fit() {
		const { terminal, screen } = this;
		const drawn = terminal?.element?.querySelector('.xterm-screen');
		const dock = this.elem.closest('.dock');

		if (!drawn || !dock || !drawn.offsetWidth || this.elem.hidden) return;

		// Measured by the boxes' outer widths, which a scrollbar showing or hiding doesn't change: measured inside them, a
		// scrollbar coming and going as the font changed fitted it again and again
		const chrome = dock.offsetWidth - screen.offsetWidth;
		// Sized by hand, the terminal fits the dock as it is; otherwise the most the dock can take
		const sized = dock.dataset.sized === 'true';
		const room = sized ? screen.offsetWidth : dock.parentElement.clientWidth - 32 - chrome;
		const height = screen.offsetHeight;
		const size = terminal.options.fontSize;

		// What was found too big is kept only while the room stays the same
		if (this.room !== `${room}x${height}`) {
			this.room = `${room}x${height}`;
			this.tooBig = Infinity;
		}

		const { font, tooBig } = fitFont({
			size,
			drawn: { width: drawn.offsetWidth, height: drawn.offsetHeight },
			room,
			height,
			sized,
			tooBig: this.tooBig,
		});

		this.tooBig = tooBig;

		// Fitted again once drawn at the new size, as the panel round it settles, until it no longer changes
		if (font !== size) {
			terminal.options.fontSize = font;
			requestAnimationFrame(() => this.fit());
		}
		this.claimRoom({ drawn, dock, chrome, sized, height });
		// Too tall for the panel even at its least font, its foot kept at the panel's: its oldest rows cut off at the top,
		// never its prompt at the bottom
		requestAnimationFrame(() => {
			const was = parseFloat(terminal.element.style.marginTop) || 0;
			// Where its last row ends past the screen's foot, measured as drawn, wherever xterm puts its rows in its box
			const over = drawn.getBoundingClientRect().bottom - (screen.getBoundingClientRect().bottom - FOOT_PADDING / 2);
			const lift = `${Math.min(0, Math.round(was - over))}px`;

			if (terminal.element.style.marginTop !== lift) terminal.element.style.marginTop = lift;
		});
		requestAnimationFrame(() => {
			if (this.elem.hidden || sized) return;

			const width = `${Math.min(dock.parentElement.clientWidth - 32, Math.max(DOCK_LEAST, drawn.offsetWidth + chrome + 24))}px`;

			// Written only when it changes, so the panel resizing under it doesn't fit it again for nothing
			if (dock.style.width !== width) dock.style.width = width;
		});
	}

	// The size that fills the panel at a comfortable font, told to the session: once typed into here it's driving, and
	// the session takes it, as it takes the size of the page of whoever's typing; till then it's shown as it is. As wide
	// as the panel's been dragged, else half the stage (not the panel's own width, which follows the terminal drawn),
	// and as tall as the panel
	claimRoom({ drawn, dock, chrome, sized, height }) {
		const { terminal } = this;
		const natural = roomFor({
			stage: dock.parentElement.clientWidth,
			sized,
			width: dock.offsetWidth,
			least: DOCK_LEAST,
			chrome,
			height,
			cell: { width: drawn.offsetWidth / terminal.cols, height: drawn.offsetHeight / terminal.rows },
			size: terminal.options.fontSize,
		});

		if (natural.cols === this.natural?.cols && natural.rows === this.natural?.rows) return;
		this.natural = natural;
		this.connection?.send({ type: 'resize', ...natural });
	}

	refresh() {
		this.fit();
	}

	stop() {
		this.resizing?.disconnect();
		this.connection?.close();
		this.terminal?.dispose();
		this.terminal = null;
		this.connection = null;
	}
}
