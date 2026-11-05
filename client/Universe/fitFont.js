// `room`, the size the panel's terminal is laid out for when it's driving
export const FONT = { most: 14, least: 8, tiny: 6, room: 13 };

// The docked terminal's font for the room it has, `drawn` its size drawn at `size` now: as large as lets its columns
// across and its rows down both fit, never one found too big for this room (`tooBig`, kept by the caller for as long as
// the room stays the same), so a font whose drawn width doesn't grow in step with its size can't swing between two
// sizes for ever. Sized narrow by hand (`sized`), smaller still. { font, tooBig }
export const fitFont = ({ size, drawn, room, height, sized = false, tooBig = Infinity }) => {
	const overflows = drawn.width > room - 24 || drawn.height > height - 8;
	const known = overflows ? Math.min(tooBig, size) : tooBig;
	const across = Math.floor((size * (room - 24)) / drawn.width);
	const down = Math.floor((size * (height - 8)) / drawn.height);

	return {
		font: Math.max(sized ? FONT.tiny : FONT.least, Math.min(FONT.most, across, down, known - 1)),
		tooBig: known,
	};
};
