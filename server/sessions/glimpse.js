import { SHADES } from '../../shared/glimpse';

// A screen as a desk's monitor shows it from across the room: each cell a dot of its color, blank where nothing's
// printed. Colors are cut to four steps a channel, one letter each, so a screen costs a few kilobytes at most. Only
// the rows that end in something printed are kept, the last of them at most.
const MOST = { rows: 24, cols: 120 };

const ANSI = [
	0x000000, 0xcd0000, 0x00cd00, 0xcdcd00, 0x0000ee, 0xcd00cd, 0x00cdcd, 0xe5e5e5, 0x7f7f7f, 0xff0000, 0x00ff00,
	0xffff00, 0x5c5cff, 0xff00ff, 0x00ffff, 0xffffff,
];
const DEFAULT_FG = 0xc8c8c8;
const CUBE = [0, 95, 135, 175, 215, 255];

const paletteColor = index => {
	if (index < 16) return ANSI[index];
	if (index >= 232) {
		const gray = 8 + (index - 232) * 10;

		return (gray << 16) | (gray << 8) | gray;
	}

	const cube = index - 16;

	return (CUBE[Math.floor(cube / 36)] << 16) | (CUBE[Math.floor(cube / 6) % 6] << 8) | CUBE[cube % 6];
};

const fgOf = cell => {
	if (cell.isFgRGB()) return cell.getFgColor();
	if (cell.isFgPalette()) return paletteColor(cell.getFgColor());

	return DEFAULT_FG;
};

const bgOf = cell => {
	if (cell.isBgRGB()) return cell.getBgColor();
	if (cell.isBgPalette()) return paletteColor(cell.getBgColor());

	return null;
};

const shade = (rgb, dim) => {
	const step = channel => Math.min(3, Math.round(((rgb >> channel) & 0xff) / (dim ? 170 : 85)));

	return SHADES[(step(16) << 4) | (step(8) << 2) | step(0)];
};

// What a cell shows: its ink where something's printed, its paper where only that's colored (inverse swaps them)
const dotOf = cell => {
	const printed = (cell.getChars() || ' ').trim() !== '';
	const [ink, paper] = cell.isInverse() ? [bgOf(cell) ?? 0, fgOf(cell)] : [fgOf(cell), bgOf(cell)];

	if (printed) return shade(ink, cell.isDim());

	return paper === null ? ' ' : shade(paper, false);
};

// `buffer` an xterm buffer, `rows` the screen's height: { lines } of dots, top first
export const glimpse = (buffer, rows) => {
	const top = buffer.baseY;
	const lines = [];
	let cell;

	for (let y = top; y < top + rows; y++) {
		const line = buffer.getLine(y);
		let dots = '';

		for (let x = 0; line && x < Math.min(line.length, MOST.cols); x++) {
			cell = line.getCell(x, cell);
			dots += dotOf(cell);
		}
		lines.push(dots.trimEnd());
	}

	while (lines.length && !lines.at(-1)) lines.pop();

	return { lines: lines.slice(-MOST.rows) };
};
