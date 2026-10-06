const ESC = '\x1b';

// Mouse reporting (which events, 9 and 1000-1003; how they're encoded, 1005, 1006, 1015, 1016) and focus
// reporting (1004)
const POINTER_MODES = new Set(['9', '1000', '1001', '1002', '1003', '1004', '1005', '1006', '1015', '1016']);
const MODE_CHANGE = new RegExp(`${ESC}\\[\\?([\\d;]+)([hl])`, 'g');

// Drops the mouse- and focus-reporting switches from terminal output, keeping any other modes in the same sequence.
// In a browser, Claude reporting the mouse means a drag can't select text and the wheel can't scroll back, and
// reporting focus makes Claude redraw on every click, which clears a selection the moment it's made.
const withoutPointerReporting = text =>
	text.replace(MODE_CHANGE, (sequence, list, action) => {
		const kept = list.split(';').filter(mode => !POINTER_MODES.has(mode));

		return kept.length ? `${ESC}[?${kept.join(';')}${action}` : '';
	});

export default withoutPointerReporting;
