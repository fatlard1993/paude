import { parseDiff, sideBySide } from '../../shared/diff';
import { button, element } from '../dom';

const MARK = { added: '+', removed: '-', context: ' ', note: '' };
const STATUS_LETTERS = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U' };

// The line's text in the syntax font, after its mark
const textParts = (line, language) => [
	element('span', 'mark', MARK[line.kind]),
	element('code', language ? `language-${language}` : 'plain', line.text || ' '),
];

const unifiedRows = ({ lines, offset, language, picked, pick }) =>
	lines.map((line, index) => {
		const row = element('div', `line ${line.kind}${picked(offset + index) ? ' picked' : ''}`);
		const numbers = element('span', 'numbers');

		numbers.append(element('span', '', line.old ?? ''), element('span', '', line.new ?? ''));
		numbers.addEventListener('click', event => pick(offset + index, event));
		row.append(numbers, ...textParts(line, language));

		return row;
	});

const splitRows = ({ lines, offset, language, picked, pick }) =>
	sideBySide(lines).map(({ left, right, note }) => {
		if (note) return element('div', 'line note split-note', note.line.text);

		const row = element('div', 'split-row');
		const side = (half, which) => {
			const cell = element('div', `side ${which} ${half ? half.line.kind : 'empty'}`);

			if (!half) return cell;

			const number = element('span', 'number', String(which === 'left' ? half.line.old : half.line.new));

			if (picked(offset + half.index)) cell.classList.add('picked');
			number.addEventListener('click', event => pick(offset + half.index, event));
			cell.append(number, ...textParts(half.line, language));

			return cell;
		};

		row.append(side(left, 'left'), side(right, 'right'));

		return row;
	});

// A set of file diffs, from any source, unified or side by side. A line number picks lines in its file (Shift+click,
// or a second tap on a touch screen, picks the range between); each hunk, or the lines picked, can be attached.
// Returns the container and, per file, its lines in order, which picks index into.
const renderDiffSet = ({ set, layout, languageOf, selection, onPick, onAttachLines }) => {
	const container = element('div', `diff ${layout}`);
	const files = [];

	if (!set.files.length) container.append(element('div', 'empty', 'Nothing differs.'));

	set.files.forEach((file, fileIndex) => {
		const { binary, hunks } = parseDiff(file.diff ?? '');
		const language = languageOf(file.path);
		const head = element('div', 'file-head');
		const lines = [];
		const picked = index => selection?.file === fileIndex && index >= selection.from && index <= selection.to;
		const pick = (index, event) => onPick(fileIndex, index, event);

		head.append(
			element('span', `status ${file.status}`, STATUS_LETTERS[file.status] ?? ''),
			element('span', 'file-path', file.from ? `${file.from} → ${file.path}` : file.path),
		);
		// The title names the set; a file's own path shows unless the title already is it
		if (set.files.length > 1 || set.title !== file.path) container.append(head);
		if (file.note || binary) container.append(element('div', 'empty', file.note ?? 'A binary file changed.'));

		for (const hunk of hunks) {
			const hunkHead = element('div', 'hunk-head');
			const offset = lines.length;

			hunkHead.append(element('span', 'where', `@@ -${hunk.oldStart} +${hunk.newStart} @@ ${hunk.heading}`));
			if (onAttachLines)
				hunkHead.append(
					button('Attach', () => onAttachLines(fileIndex, hunk.lines), { title: 'Attach this hunk to the prompt' }),
				);
			lines.push(...hunk.lines);
			container.append(
				hunkHead,
				...(layout === 'split' ? splitRows : unifiedRows)({ lines: hunk.lines, offset, language, picked, pick }),
			);
		}

		files.push({ path: file.path, lines });
	});

	return { container, files };
};

export default renderDiffSet;
