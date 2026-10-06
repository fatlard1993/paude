const ESC = '\x1b';

// Mouse reporting (9, 1000-1003) and how it's encoded (1005, 1006, 1015, 1016), and focus reporting (1004)
const POINTER_MODES = new Set(['9', '1000', '1001', '1002', '1003', '1004', '1005', '1006', '1015', '1016']);
const MODE_CHANGE = new RegExp(`${ESC}\\[\\?([\\d;]+)([hl])`, 'g');

// In a browser, mouse reporting stops a drag from selecting and the wheel from scrolling, and focus reporting
// makes Claude redraw on every click, which clears a fresh selection
const withoutPointerReporting = (text, onMode) =>
	text.replace(MODE_CHANGE, (sequence, list, action) => {
		const modes = list.split(';');
		const kept = modes.filter(mode => !POINTER_MODES.has(mode));

		if (onMode) for (const mode of modes) if (POINTER_MODES.has(mode)) onMode(mode, action === 'h');

		return kept.length ? `${ESC}[?${kept.join(';')}${action}` : '';
	});

export default withoutPointerReporting;
