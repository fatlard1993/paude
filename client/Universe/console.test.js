import { expect, test } from 'bun:test';

import { fitFont } from './fitFont';

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
