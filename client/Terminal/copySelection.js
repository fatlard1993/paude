import { Notify, copyToClipboard } from '@vanilla-bean/components';

import { unwrapped } from './unwrapped';

// Ctrl+C copies what's selected, as in a Windows terminal; with nothing selected it still interrupts
export const isCopyKey = (event, terminal) =>
	event.type === 'keydown' &&
	event.ctrlKey &&
	!event.altKey &&
	!event.metaKey &&
	event.key.toLowerCase() === 'c' &&
	terminal.hasSelection();

// What's selected, as text to copy: Claude's screen with its own wrapping undone (`unwrap`), a shell's as it is
export const selectedText = (terminal, { unwrap = false } = {}) => {
	const text = terminal.getSelection();

	return unwrap ? unwrapped(text, terminal.cols) : text;
};

// The browser's own copy of the terminal (Cmd+C, Ctrl+Shift+C, Ctrl+Insert, its menu) carries the same text the Copy
// button does
export const copyAsSelected = (terminal, options) =>
	terminal.element?.addEventListener('copy', event => {
		if (!terminal.hasSelection()) return;
		event.clipboardData.setData('text/plain', selectedText(terminal, options));
		event.preventDefault();
	});

export const copySelection = async (terminal, options) => {
	const text = selectedText(terminal, options);

	if (!text) return;

	// Outside https the copy goes through a field of its own, which takes the focus from the terminal
	const copied = await copyToClipboard(text);

	terminal.focus();

	if (copied) {
		terminal.clearSelection();
		new Notify({ intent: 'success', content: 'Copied', timeout: 1500 });
	} else new Notify({ intent: 'danger', content: "The browser wouldn't let paude copy; its own Copy still works." });
};

// Copies with a toast saying so, or saying the browser refused
export const copyWithNotice = async (text, content) => {
	if (await copyToClipboard(text)) new Notify({ intent: 'success', content, timeout: 1500 });
	else new Notify({ intent: 'warning', content: 'The browser would not allow copying here.' });
};
