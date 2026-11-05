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

// The size the panel's terminal is laid out for when it's driving, in columns and rows: as wide as the panel's been
// dragged (`sized`, its `width`), else half the stage, never narrower than `least` nor wider than the stage less its
// margin, and as tall as the panel (`height`), at FONT.room for cells drawn `cell` big at `size`; never less than a
// terminal's usual 80 by 24
export const roomFor = ({ stage, sized = false, width, least, chrome, height, cell, size }) => {
	const across = Math.min(stage - 32, sized ? width : Math.max(least, stage * 0.5));
	const scale = FONT.room / size;

	return {
		cols: Math.max(80, Math.floor((across - chrome - 24) / (cell.width * scale))),
		rows: Math.max(24, Math.floor((height - 8) / (cell.height * scale))),
	};
};
