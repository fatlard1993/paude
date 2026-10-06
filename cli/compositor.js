import xtermHeadless from '@xterm/headless';

const { Terminal } = xtermHeadless;

const ESC = '\x1b';
// Synchronized output: supporting terminals show the frame at once instead of row by row
const BEGIN_FRAME = `${ESC}[?2026h`;
const END_FRAME = `${ESC}[?2026l`;

// A copy of Claude's screen kept in this terminal client, so the overlay can float over it while it keeps updating
export const createMirror = () => new Terminal({ cols: 80, rows: 24, scrollback: 0, allowProposedApi: true });

const colorCodes = (cell, foreground) => {
	if (foreground ? cell.isFgDefault() : cell.isBgDefault()) return [foreground ? 39 : 49];

	const color = foreground ? cell.getFgColor() : cell.getBgColor();

	if (foreground ? cell.isFgRGB() : cell.isBgRGB())
		return [foreground ? 38 : 48, 2, (color >> 16) & 255, (color >> 8) & 255, color & 255];
	if (color < 8) return [(foreground ? 30 : 40) + color];
	if (color < 16) return [(foreground ? 90 : 100) + color - 8];

	return [foreground ? 38 : 48, 5, color];
};

// xterm's attribute checks return numbers, and a stray 0 would be a reset in the middle of the style
const SHADOW = 232;

const styleOf = (cell, dim, shade) =>
	[
		0,
		...[
			[cell.isBold(), 1],
			[dim || cell.isDim(), 2],
			[cell.isItalic(), 3],
			[cell.isUnderline(), 4],
			[cell.isInverse(), 7],
			[cell.isInvisible(), 8],
			[cell.isStrikethrough(), 9],
		]
			.filter(([on]) => on)
			.map(([, code]) => code),
		...colorCodes(cell, true),
		...(shade ? [48, 5, SHADOW] : colorCodes(cell, false)),
	].join(';');

// Columns [from, to) of one mirrored row as text with its colors. A wide character cut by either edge becomes a space.
const renderCells = (line, from, to, dim, cell, shade = false) => {
	let out = '';
	let style = null;

	for (let x = from; x < to; x++) {
		const current = line?.getCell(x, cell);
		const width = current?.getWidth() ?? 1;

		if (!current || width === 0 || (width === 2 && x + 1 >= to)) {
			const blank = shade ? `${ESC}[0;48;5;${SHADOW}m` : `${ESC}[0m`;

			if (style !== blank) out += blank;
			style = blank;
			out += ' ';
			continue;
		}

		const next = styleOf(current, dim, shade);

		if (next !== style) out += `${ESC}[${next}m`;
		style = next;
		out += current.getChars() || ' ';
		if (width === 2) x += 1;
	}

	return `${out}${ESC}[0m`;
};

// Claude's screen dimmed, the box's lines (each exactly box.width wide) at box.x, box.y, and a shadow down its
// left side and along its bottom
export const composeFrame = ({ mirror, cols, rows, box }) => {
	const buffer = mirror.buffer.active;
	const cell = buffer.getNullCell();
	const bottom = box.y + box.lines.length;
	const shadowX = Math.max(box.x - 1, 0);
	let frame = BEGIN_FRAME;

	for (let y = 0; y < rows; y++) {
		const line = y < mirror.rows ? buffer.getLine(buffer.viewportY + y) : undefined;
		const boxLine = box.lines[y - box.y];
		const cells = (from, to, shade) => (from < to ? renderCells(line, from, to, true, cell, shade) : '');

		frame += `${ESC}[${y + 1};1H`;

		if (boxLine !== undefined) {
			const shaded = y > box.y ? shadowX : box.x;

			frame += cells(0, shaded, false) + cells(shaded, box.x, true) + boxLine + cells(box.x + box.width, cols, false);
		} else if (y === bottom && box.x > 0) {
			const end = Math.min(box.x + box.width - 1, cols);

			frame += cells(0, shadowX, false) + cells(shadowX, end, true) + cells(end, cols, false);
		} else frame += cells(0, cols, false);
	}

	return `${frame}${END_FRAME}`;
};
