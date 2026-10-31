// A screen's dots, as the universe view's monitors show it: one letter for each color, cut to four steps a channel,
// red in the high bits
const run = (from, count) =>
	Array.from({ length: count }, (_, index) => String.fromCharCode(from.charCodeAt(0) + index)).join('');

export const SHADES = `${run('a', 26)}${run('A', 26)}${run('0', 10)}+/`;

export const shadeColor = letter => {
	const index = SHADES.indexOf(letter);

	return `rgb(${((index >> 4) & 3) * 85}, ${((index >> 2) & 3) * 85}, ${(index & 3) * 85})`;
};
