const ESC = '\x1b';

// Mouse reporting (which events, 9 and 1000-1003; how they're encoded, 1005, 1006, 1015, 1016) and focus
// reporting (1004)
const POINTER_MODES = new Set(['9', '1000', '1001', '1002', '1003', '1004', '1005', '1006', '1015', '1016']);
const MODE_CHANGE = new RegExp(`${ESC}\\[\\?([\\d;]+)([hl])`, 'g');

// Drops the mouse- and focus-reporting switches from terminal output, keeping any other modes in the same sequence.
// In a browser, Claude reporting the mouse means a drag can't select text and the wheel can't scroll back, and
// reporting focus makes Claude redraw on every click, which clears a selection the moment it's made.
// `onMode(mode, on)` hears about each one dropped, for a client that still wants to know what Claude asked for.
const withoutPointerReporting = (text, onMode) =>
	text.replace(MODE_CHANGE, (sequence, list, action) => {
		const modes = list.split(';');
		const kept = modes.filter(mode => !POINTER_MODES.has(mode));

		if (onMode) for (const mode of modes) if (POINTER_MODES.has(mode)) onMode(mode, action === 'h');

		return kept.length ? `${ESC}[?${kept.join(';')}${action}` : '';
	});

export default withoutPointerReporting;
