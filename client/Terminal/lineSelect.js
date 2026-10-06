const SWALLOWED = ['pointerdown', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click'];

// Touch screens can't drag-select in a terminal: tap the first line, then the last. Every touch is swallowed
// before xterm sees it, or xterm would move or clear the selection between the two taps. Returns what ends it early.
const selectLinesByTap = ({ terminal, screen, hint, purpose, onEnd }) => {
	let first = null;
	const swallow = event => {
		event.preventDefault();
		event.stopPropagation();
	};
	const rowAt = event => {
		const rect = terminal.element.querySelector('.xterm-screen').getBoundingClientRect();
		const row = Math.floor(((event.clientY - rect.top) / rect.height) * terminal.rows);

		return Math.min(Math.max(row, 0), terminal.rows - 1) + terminal.buffer.active.viewportY;
	};

	const end = () => {
		screen.classList.remove('selecting');
		screen.removeEventListener('pointerup', onTap, true);
		for (const type of SWALLOWED) screen.removeEventListener(type, swallow, { capture: true });
		hint(null);
		onEnd();
	};

	const onTap = event => {
		swallow(event);

		const row = rowAt(event);

		if (first === null) {
			first = row;
			terminal.selectLines(row, row);
			hint('Now tap the last line');

			return;
		}

		terminal.selectLines(Math.min(first, row), Math.max(first, row));
		end();
	};

	screen.classList.add('selecting');
	hint(`Tap the first line to ${purpose}`);
	screen.addEventListener('pointerup', onTap, true);
	for (const type of SWALLOWED) screen.addEventListener(type, swallow, { capture: true, passive: false });

	return end;
};

export default selectLinesByTap;
