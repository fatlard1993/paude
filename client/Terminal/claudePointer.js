// Claude's mouse reporting, kept from the browser (so a drag selects) but remembered, so the wheel and a click can be
// handed to Claude as the reports it asked for: which modes it has on, the cell under a point, and a report for it
export const claudePointer = terminal => {
	const modes = new Set();

	// The cell under a point, 1-based, as mouse reports count them: on the screen, not the terminal element, which
	// keeps its full-size width when scaled down and spills out
	const cellAt = ({ clientX, clientY }) => {
		const bounds = terminal.element.querySelector('.xterm-screen').getBoundingClientRect();
		const clamp = (value, most) => Math.min(Math.max(Math.ceil(value), 1), most);

		return {
			column: clamp(((clientX - bounds.left) / bounds.width) * terminal.cols, terminal.cols),
			row: clamp(((clientY - bounds.top) / bounds.height) * terminal.rows, terminal.rows),
		};
	};

	// A report in the encoding Claude asked for; the legacy one has no button for a release, only 3
	const report = (button, point, { release = false } = {}) => {
		const { column, row } = cellAt(point);

		if (modes.has('1006')) return `\x1b[<${button};${column};${row}${release ? 'm' : 'M'}`;

		return `\x1b[M${String.fromCharCode(32 + (release ? 3 : button), 32 + column, 32 + row)}`;
	};

	return {
		track: (mode, on) => (on ? modes.add(mode) : modes.delete(mode)),
		reset: () => modes.clear(),
		tracking: () => ['1000', '1002', '1003'].some(mode => modes.has(mode)),
		report,
		// Wheel notches up or down at a point
		wheel: (up, point, notches) => report(up ? 64 : 65, point).repeat(notches),
	};
};

// The wheel over the terminal goes to Claude as a wheel whenever Claude has asked for one (and `allowed` says this
// viewer may type); otherwise xterm scrolls its own scrollback, never, on the alternate screen, turning it into the
// arrow keys Claude reads as walking through past prompts
export const wheelToClaude = (terminal, pointer, send, { allowed = () => true } = {}) =>
	terminal.attachCustomWheelEventHandler(event => {
		if (!pointer.tracking()) return terminal.buffer.active.type !== 'alternate';
		if (!allowed() || !event.deltaY) return false;

		// A touchpad sends many small deltas; a notch of a wheel is about 100
		send(pointer.wheel(event.deltaY < 0, event, Math.max(1, Math.round(Math.abs(event.deltaY) / 100))));

		return false;
	});
