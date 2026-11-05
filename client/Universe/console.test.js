import { expect, test } from 'bun:test';

import { fitFont, roomFor } from './fitFont';

// Fitted again and again as the panel would, each time drawn at the font the last fit chose: the fonts it goes through
const fitsOver = ({ widthAt, room, height = 600 }) => {
	let state = { font: 14, tooBig: Infinity };
	const fonts = [];

	for (let fit = 0; fit < 50; fit++) {
		state = fitFont({
			size: state.font,
			drawn: { width: widthAt(state.font), height: state.font * 30 * 0.5 },
			room,
			height,
			tooBig: state.tooBig,
		});
		fonts.push(state.font);
	}

	return fonts;
};

test("the docked terminal's font settles where its drawn width doesn't grow in step with its size", () => {
	// Drawn narrower than its size predicts up to 11 and wider past it: by the arithmetic alone, 11 fits and estimates 13,
	// and 13 overflows and estimates 11, so it swung between them for ever
	const widthAt = font => (font <= 11 ? font * 63.6 : font * 73);
	const fonts = fitsOver({ widthAt, room: 860 });
	const settled = fonts.at(-1);

	expect(new Set(fonts.slice(-10)).size).toBe(1);
	expect(widthAt(settled)).toBeLessThanOrEqual(860 - 24);
});

test('a font that fits is kept, and one that fits better is grown to', () => {
	expect(fitsOver({ widthAt: font => font * 60, room: 900 }).at(-1)).toBe(14);
	expect(fitsOver({ widthAt: font => font * 80, room: 900 }).at(-1)).toBe(10);
});

test('typed into, the panel claims as much as fills it: half the stage or as dragged, kept within the stage, never under 80 by 24', () => {
	const at = { least: 620, chrome: 40, height: 800, cell: { width: 7, height: 15 }, size: 13 };
	const across = ({ cols }) => cols * 7 + 40 + 24;

	// Half a wide stage
	const half = roomFor({ ...at, stage: 2000 });

	expect(across(half)).toBeLessThanOrEqual(1000);
	expect(across(half)).toBeGreaterThan(1000 - 7);
	expect(half.rows).toBe(Math.floor((800 - 8) / 15));
	// Dragged wider than the stage allows: kept to the stage less its margin
	expect(across(roomFor({ ...at, stage: 1200, sized: true, width: 5000 }))).toBeLessThanOrEqual(1200 - 32);
	// A narrow stage and a short panel: no smaller than a usual terminal
	expect(roomFor({ ...at, stage: 500, height: 100 })).toEqual({ cols: 80, rows: 24 });
	// Drawn at another font, laid out for the panel's own
	expect(roomFor({ ...at, stage: 2000, cell: { width: 14, height: 30 }, size: 26 })).toEqual(half);
});
