import { listFiles } from '../api';
import findFilePaths, { pathResolver } from '../../shared/filePaths';
import findUrls from '../../shared/terminalLinks';

// How many rows either side of one a URL broken across rows is looked for in
const URL_ROWS = 6;

// A buffer row's text and, for each character of it, the column it's drawn in (1-based, as xterm's links count)
export const bufferCells = (terminal, index) => {
	const line = terminal.buffer.active.getLine(index);
	const columns = [];
	let text = '';

	for (let x = 0; line && x < terminal.cols; x++) {
		const cell = line.getCell(x);

		if (!cell || cell.getWidth() === 0) continue;

		const chars = cell.getChars() || ' ';

		text += chars;
		for (let unit = 0; unit < chars.length; unit++) columns.push(x + 1);
	}

	return { text: text.trimEnd(), columns };
};

// Plain URLs open in a new tab, one Claude broke across rows included; the rows around each one are searched so a
// broken URL is the same link from any of its rows. `over` hears whether the pointer is on one.
export const linkUrls = (terminal, { over = () => {} } = {}) =>
	terminal.registerLinkProvider({
		provideLinks: (lineNumber, callback) => {
			const first = Math.max(lineNumber - 1 - URL_ROWS, 0);
			const rows = [];

			for (let index = first; index <= lineNumber - 1 + URL_ROWS; index++) rows.push(bufferCells(terminal, index));

			const links = findUrls(
				rows.map(({ text }) => text),
				terminal.cols,
			)
				.filter(({ parts }) => parts.some(({ row }) => first + row === lineNumber - 1))
				.map(({ url, parts }) => {
					const [start, end] = [parts[0], parts.at(-1)];

					return {
						range: {
							start: { x: rows[start.row].columns[start.from], y: first + start.row + 1 },
							end: { x: rows[end.row].columns[end.to - 1], y: first + end.row + 1 },
						},
						text: url,
						decorations: { pointerCursor: true, underline: true },
						hover: () => over(true),
						leave: () => over(false),
						activate: () => window.open(url, '_blank', 'noopener,noreferrer'),
					};
				});

			callback(links.length ? links : undefined);
		},
	});

// The project's files Claude names, opened with `open(path, line, lastLine)` at the lines named
export const linkFilePaths = (terminal, sessionId, { open, over = () => {} }) => {
	let resolvePath;

	return terminal.registerLinkProvider({
		provideLinks: async (lineNumber, callback) => {
			resolvePath ??= listFiles(sessionId).then(({ body, response }) => pathResolver(response?.ok ? body : []));

			const { text, columns } = bufferCells(terminal, lineNumber - 1);
			const links = findFilePaths(text, await resolvePath).map(({ path, line, lastLine, from, to }) => ({
				range: { start: { x: columns[from], y: lineNumber }, end: { x: columns[to - 1], y: lineNumber } },
				text: path,
				decorations: { pointerCursor: true, underline: true },
				hover: () => over(true),
				leave: () => over(false),
				activate: () => open(path, line, lastLine),
			}));

			callback(links.length ? links : undefined);
		},
	});
};
