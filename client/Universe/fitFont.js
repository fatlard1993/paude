// `room`, the size the panel's terminal is laid out for when it's driving
export const FONT = { most: 14, least: 8, tiny: 6, room: 13 };

// The docked terminal's font for the room it has, `drawn` its size drawn at `size` now: as large as lets its columns
// across and its rows down both fit, never one found too big for this room (`tooBig`, kept by the caller for as long as
// the room stays the same), so a font whose drawn width doesn't grow in step with its size can't swing between two
// sizes for ever. Sized narrow by hand (`sized`), smaller still. On a phone (`narrow`) only its columns are fitted, as
// small as `sized` at most: shrunk to fit its rows too in a drawer that short, it was too small to read; its oldest rows
// go off the top instead, its prompt kept at the foot. { font, tooBig }
export const fitFont = ({ size, drawn, room, height, sized = false, narrow = false, tooBig = Infinity }) => {
	const overflows = drawn.width > room - 24 || (!narrow && drawn.height > height - 8);
	const known = overflows ? Math.min(tooBig, size) : tooBig;
	const across = Math.floor((size * (room - 24)) / drawn.width);
	const down = narrow ? Infinity : Math.floor((size * (height - 8)) / drawn.height);

	return {
		font: Math.max(sized || narrow ? FONT.tiny : FONT.least, Math.min(FONT.most, across, down, known - 1)),
		tooBig: known,
	};
};

// The size the panel's terminal is laid out for when it's driving, in columns and rows: as wide as the panel's been
// dragged (`sized`, its `width`), else half the stage, never narrower than `least` nor wider than the stage less its
// margin, and as tall as the panel (`height`), at FONT.room for cells drawn `cell` big at `size`; never less than a
// terminal's usual 80 by 24. On a phone (`narrow`) the panel is the stage's whole width, and it takes what fits there
// as the session's own page does on a phone, however few: 80 columns across a phone are too small to read, or cut off
export const roomFor = ({ stage, sized = false, narrow = false, width, least, chrome, height, cell, size }) => {
	const across = narrow ? stage : Math.min(stage - 32, sized ? width : Math.max(least, stage * 0.5));
	const scale = FONT.room / size;
	const [cols, rows] = narrow ? [20, 8] : [80, 24];

	return {
		cols: Math.max(cols, Math.floor((across - chrome - 24) / (cell.width * scale))),
		rows: Math.max(rows, Math.floor((height - 8) / (cell.height * scale))),
	};
};
