import { Notify, copyToClipboard } from '@vanilla-bean/components';

// Ctrl+C copies what's selected, as in a Windows terminal; with nothing selected it still interrupts
export const isCopyKey = (event, terminal) =>
	event.type === 'keydown' &&
	event.ctrlKey &&
	!event.altKey &&
	!event.metaKey &&
	event.key.toLowerCase() === 'c' &&
	terminal.hasSelection();

export const copySelection = async terminal => {
	const text = terminal.getSelection();

	if (!text) return;

	// Outside https the copy goes through a field of its own, which takes the focus from the terminal
	const copied = await copyToClipboard(text);

	terminal.focus();

	if (copied) {
		terminal.clearSelection();
		new Notify({ type: 'success', content: 'Copied', timeout: 1500 });
	} else new Notify({ type: 'error', content: "The browser wouldn't let paude copy; its own Copy still works." });
};

// Copies with a toast saying so, or saying the browser refused
export const copyWithNotice = async (text, content) => {
	if (await copyToClipboard(text)) new Notify({ type: 'success', content, timeout: 1500 });
	else new Notify({ type: 'warning', content: 'The browser would not allow copying here.' });
};
