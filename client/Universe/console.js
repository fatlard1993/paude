import { Notify } from '@vanilla-bean/components';
import { Terminal } from '@xterm/xterm';
import '@xterm/xterm/css/xterm.css';

import { canBrowse, canNote, canType } from '../identity';
import attach from '../Terminal/attach';
import { copySelection, isCopyKey } from '../Terminal/copySelection';
import { linkFilePaths, linkUrls } from '../Terminal/linkProviders';
import xtermOptions, { loadSymbolsFor, redrawWhenSymbolsLoad } from '../Terminal/xtermOptions';
import { button, element } from '../dom';

const FONT = { most: 14, least: 8, tiny: 6 };
// The dock's own width, the least it narrows to for a small terminal
const DOCK_LEAST = 620;

// A session's terminal in its dock, at the session's own size so opening it here resizes nothing for anyone, its font
// as large as lets that size fit (smaller than the least, it scrolls across). Sized by its font, never a CSS transform:
// a transform blurs the text and puts clicks where they aren't.
export default class TerminalPanel {
	// `openFile(path, line, lastLine)` opens a file path Claude names; `comment(quote)` starts a comment on a selection
	constructor({ appendTo, session, addClass = [], openFile, comment }) {
		this.session = session;
		this.openFile = openFile;
		this.comment = comment;
		this.elem = element('div', ['docked-terminal', ...addClass].join(' '));
		this.state = element('div', 'about', 'connecting…');
		this.screen = element('div', 'screen');
		// What can be done with what's selected, as on the session's own page
		this.selected = element('div', 'selected');
		this.selected.hidden = true;
		this.selected.append(
			button('Copy', () => copySelection(this.terminal), { icon: 'copy', className: 'variant-flat' }),
			...(canNote() && comment
				? [button('Comment', () => this.commentOnSelection(), { icon: 'comment', className: 'variant-flat' })]
				: []),
		);
		// Pressed without taking the focus, so the selection is still there to act on
		this.selected.addEventListener('mousedown', event => event.preventDefault());
		this.elem.append(this.state, this.selected, this.screen);
		appendTo.append(this.elem);
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

	start() {
		if (this.terminal) return this.fit();

		const { session } = this;
		const { cols = 100, rows = 30 } = session.screen ?? {};
		// See-through, so the ship shows behind it
		const terminal = new Terminal({
			...xtermOptions,
			fontSize: FONT.most,
			scrollback: 1000,
			disableStdin: !canType(),
			allowTransparency: true,
			theme: { ...xtermOptions.theme, background: 'rgba(0, 0, 0, 0)' },
		});
		let decoder = new TextDecoder();

		this.terminal = terminal;
		terminal.open(this.screen);
		terminal.resize(cols, rows);
		// Its URLs open in a new tab and the project's files it names in the dock's files; Ctrl+C with something selected
		// copies it rather than interrupting Claude
		linkUrls(terminal);
		if (canBrowse() && this.openFile) linkFilePaths(terminal, session.id, { open: this.openFile });
		terminal.attachCustomKeyEventHandler(event => {
			if (!isCopyKey(event, terminal)) return true;
			event.preventDefault();
			copySelection(terminal);

			return false;
		});
		terminal.onSelectionChange(() => (this.selected.hidden = !terminal.hasSelection()));
		redrawWhenSymbolsLoad(terminal);
		terminal.onData(data => this.connection?.send({ type: 'input', data }));
		this.connection = attach(session.id, {
			hello: () => ({ kind: 'web', label: 'universe', cols: terminal.cols, rows: terminal.rows }),
			onOutput: data => {
				const text = decoder.decode(data, { stream: true });

				loadSymbolsFor(text);
				terminal.write(text);
			},
			onMessage: message => {
				if (message.type === 'snapshot') {
					terminal.reset();
					terminal.resize(message.cols, message.rows);
					decoder = new TextDecoder();
					loadSymbolsFor(message.data);
					terminal.write(message.data, () => {
						this.arrived = true;
						this.fit();
						if (this.pendingJump) this.jumpTo(this.pendingJump);
						this.pendingJump = null;
					});
				} else if (message.type === 'size') {
					terminal.resize(message.cols, message.rows);
					this.fit();
				} else if (message.type === 'notice') new Notify({ intent: 'warning', content: message.text });
			},
			onState: value => {
				this.state.textContent = { connected: 'live', reconnecting: 'reconnecting…', ended: 'ended' }[value] ?? value;
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

		const chrome = dock.offsetWidth - screen.clientWidth;
		// Sized by hand, the terminal fits the dock as it is; otherwise the most the dock can take
		const sized = dock.dataset.sized === 'true';
		const room = sized ? screen.clientWidth : dock.parentElement.clientWidth - 32 - chrome;
		const size = terminal.options.fontSize;
		const across = Math.floor((size * (room - 24)) / drawn.offsetWidth);
		const down = Math.floor((size * (screen.clientHeight - 8)) / drawn.offsetHeight);
		// Sized narrow by hand, smaller still, so it fits the width chosen for it
		const font = Math.max(sized ? FONT.tiny : FONT.least, Math.min(FONT.most, across, down));

		// Fitted again once drawn at the new size, as the panel round it settles, until it no longer changes
		if (font !== size) {
			terminal.options.fontSize = font;
			if ((this.refits = (this.refits ?? 0) + 1) < 6) requestAnimationFrame(() => this.fit());
		} else this.refits = 0;
		requestAnimationFrame(() => {
			if (this.elem.hidden || sized) return;
			dock.style.width = `${Math.min(dock.parentElement.clientWidth - 32, Math.max(DOCK_LEAST, drawn.offsetWidth + chrome + 24))}px`;
		});
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
