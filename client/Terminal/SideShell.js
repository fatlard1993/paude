import { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';

import { attachOutputText } from '../../shared/attachText';
import { CLOSED } from '../../shared/protocol';
import { button, element, icon } from '../dom';
import KeyBar from './KeyBar';
import selectLinesByTap from './lineSelect';
import Panel from './SideShell.styles';
import xtermOptions, { loadSymbolsFor, redrawWhenSymbolsLoad } from './xtermOptions';

// Why it ended, when the person didn't end it themselves
const PASTE_WAIT_MS = 3000;

const endedBecause = ({ code, reason }, opened) => {
	if (code === CLOSED.unauthorized) return 'Your login no longer allows a terminal here.';
	if (code === CLOSED.ended) return reason === 'Shell exited' ? null : reason;

	return opened ? 'The connection dropped, so the side terminal ended.' : 'Could not open a side terminal.';
};

// A shell in the session's folder for whoever opened it, for a few quick commands beside Claude. It lives exactly
// as long as the panel is open: closing it, or losing the connection, ends the shell.
export default class SideShell extends Panel {
	build() {
		const bar = element('div', 'bar');
		const label = element('span', 'label', 'Side terminal: ends when you close it');

		label.prepend(icon('terminal'));
		this.attachButton = button('Attach selection', () => this.attachSelection(), {
			icon: 'paperclip',
			title: "Quote the selected output in Claude's prompt",
		});
		this.attachButton.disabled = true;
		bar.append(
			label,
			this.attachButton,
			button('', () => this.options.close(), { icon: 'xmark', title: 'End it', className: 'icon-only' }),
		);

		this.screen = element('div', 'screen');
		this.hint = element('div', 'hint');
		this.hint.style.display = 'none';
		this.elem.append(bar, this.screen);

		new KeyBar({
			appendTo: this,
			sendKey: data => this.send({ type: 'input', data }),
			selectLines: () => this.startLineSelect(),
			selectTitle: 'Attach lines: tap the first, then the last',
		});
	}

	get running() {
		return Boolean(this.socket);
	}

	send(message) {
		if (this.socket?.readyState !== WebSocket.OPEN) return false;

		this.socket.send(JSON.stringify(message));

		return true;
	}

	start() {
		if (this.socket) return;

		this.terminal = new Terminal({
			...xtermOptions,
			scrollback: 2000,
			allowTransparency: true,
			theme: { background: 'rgba(0, 0, 0, 0)' },
		});
		this.fitter = new FitAddon();
		this.decoder = new TextDecoder();
		this.terminal.loadAddon(this.fitter);
		this.terminal.open(this.screen);
		redrawWhenSymbolsLoad(this.terminal);
		this.screen.append(this.hint);
		this.terminal.onData(data => this.send({ type: 'input', data }));
		this.terminal.onResize(({ cols, rows }) => this.send({ type: 'resize', cols, rows }));
		this.terminal.onSelectionChange(() => {
			this.attachButton.disabled = !this.terminal.hasSelection();
		});
		this.sizeWatcher = new ResizeObserver(() => this.fit());
		this.sizeWatcher.observe(this.screen);

		const socket = new WebSocket(
			`${window.location.origin.replace(/^http/, 'ws')}/api/sessions/${this.options.sessionId}/shell`,
		);
		let opened = false;

		socket.binaryType = 'arraybuffer';
		socket.addEventListener('open', () => {
			opened = true;
			this.fit();
			this.send({ type: 'hello', cols: this.terminal.cols, rows: this.terminal.rows });
			this.terminal.focus();
		});
		socket.addEventListener('message', ({ data }) => {
			if (typeof data === 'string' || !this.terminal) return;

			const text = this.decoder.decode(data, { stream: true });

			loadSymbolsFor(text);
			this.terminal.write(text, () => this.pastePending());
		});
		socket.addEventListener('close', event => {
			if (this.socket !== socket) return;

			this.socket = null;
			this.options.ended(endedBecause(event, opened));
		});
		this.socket = socket;
	}

	// Onto the command line, not run: held until the shell turns on bracketed paste (or gives up waiting for it), so
	// a line break in the text can't press Enter
	paste(text) {
		this.pending = text;
		this.pasteAnyway = false;
		clearTimeout(this.pasteTimer);
		this.pasteTimer = setTimeout(() => {
			this.pasteAnyway = true;
			this.pastePending();
		}, PASTE_WAIT_MS);
		this.pastePending();
	}

	pastePending() {
		if (this.pending === undefined || !this.terminal || this.socket?.readyState !== WebSocket.OPEN) return;
		if (!this.pasteAnyway && !this.terminal.modes.bracketedPasteMode) return;

		clearTimeout(this.pasteTimer);
		this.terminal.paste(this.pending);
		this.pending = undefined;
		this.terminal.focus();
	}

	stop() {
		const { socket } = this;

		this.socket = null;
		this.pending = undefined;
		clearTimeout(this.pasteTimer);
		socket?.close();
		this.endLineSelect?.();
		this.sizeWatcher?.disconnect();
		this.terminal?.dispose();
		this.terminal = null;
		this.screen.replaceChildren();
		this.attachButton.disabled = true;
	}

	fit() {
		if (this.terminal && this.screen.clientHeight) this.fitter.fit();
	}

	attachSelection() {
		const selected = this.terminal?.getSelection();

		if (!selected?.trim()) return;

		if (this.options.attach(attachOutputText(selected))) this.terminal.clearSelection();
	}

	startLineSelect() {
		if (!this.terminal) return;
		if (this.endLineSelect) return this.endLineSelect();

		this.endLineSelect = selectLinesByTap({
			terminal: this.terminal,
			screen: this.screen,
			hint: text => {
				this.hint.textContent = text ?? '';
				this.hint.style.display = text ? '' : 'none';
			},
			purpose: 'attach',
			onEnd: () => {
				this.endLineSelect = null;
			},
		});
	}
}
