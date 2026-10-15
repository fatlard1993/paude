import { Notify } from '@vanilla-bean/components';

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

	try {
		await navigator.clipboard.writeText(text);
		terminal.clearSelection();
		new Notify({ type: 'success', content: 'Copied', timeout: 1500 });
	} catch {
		new Notify({ type: 'error', content: "The browser wouldn't let paude copy; its own Copy still works." });
	}
};
