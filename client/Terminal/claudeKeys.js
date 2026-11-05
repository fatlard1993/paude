import { copySelection, isCopyKey } from './copySelection';

// Command with these does what a Mac terminal makes it do: clears the line back to its start, or goes to either end.
// Option with these deletes a word or jumps one, sent here rather than left to the browser, which may take them for
// its own editing.
const MAC_LINE_KEYS = { Backspace: '\x15', ArrowLeft: '\x01', ArrowRight: '\x05' };
const MAC_WORD_KEYS = { Backspace: '\x1b\x7f', ArrowLeft: '\x1bb', ArrowRight: '\x1bf' };
// xterm sends Shift+Enter as a bare Enter, which submits; Claude Code takes Escape then Enter as a new line
const NEWLINE = '\x1b\r';

// xterm's key handler: the Mac's line and word keys and Shift+Enter sent as the terminal takes them, and Ctrl+C with
// something selected copying it rather than interrupting Claude. `leave(event)` names keys left to the page.
const claudeKeys =
	({ terminal, send, canType, leave = () => false }) =>
	event => {
		const lineKey =
			(event.metaKey && !event.ctrlKey && !event.altKey && MAC_LINE_KEYS[event.key]) ||
			(event.altKey && !event.ctrlKey && !event.metaKey && MAC_WORD_KEYS[event.key]) ||
			(event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey && event.key === 'Enter' && NEWLINE);

		if (lineKey) {
			event.preventDefault();
			if (event.type === 'keydown' && canType()) send(lineKey);

			return false;
		}
		if (leave(event)) return false;

		const copy = isCopyKey(event, terminal);

		if (copy) {
			event.preventDefault();
			copySelection(terminal);
		}

		return !copy;
	};

export default claudeKeys;
