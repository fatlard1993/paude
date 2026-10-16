import { parseDiff, sideBySide } from '../../shared/diff';
import { describeFiles, fileLabel, folds } from '../../shared/reviewOrder';
import { button, element } from '../dom';

const MARK = { added: '+', removed: '-', context: ' ', note: '' };
const STATUS_LETTERS = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', untracked: 'U' };

// The line's text in the syntax font, after its mark
const textParts = (line, language) => [
	element('span', 'mark', MARK[line.kind]),
	element('code', language ? `language-${language}` : 'plain', line.text || ' '),
];

// A bar beside a line open comments are on, which opens the first of them
const commentMark = (comments, onComment) => {
	if (!comments.length) return [];

	// Not a button: the panel's button look would cover the line number it sits beside
	const mark = Object.assign(element('div', 'comment-mark'), { role: 'button', tabIndex: 0 });

	mark.title = comments.map(comment => `${comment.author}: ${comment.text}`).join('\n');
	mark.addEventListener('click', () => onComment(comments[0].id));
	mark.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		onComment(comments[0].id);
	});

	return [mark];
};

const unifiedRows = ({ lines, offset, language, picked, pick, marks }) =>
	lines.map((line, index) => {
		const row = element('div', `line ${line.kind}${picked(offset + index) ? ' picked' : ''}`);
		const numbers = element('span', 'numbers');

		numbers.append(element('span', '', line.old ?? ''), element('span', '', line.new ?? ''));
		numbers.addEventListener('click', event => pick(offset + index, event));
		row.append(...marks(line), numbers, ...textParts(line, language));

		return row;
	});

const splitRows = ({ lines, offset, language, picked, pick, marks }) =>
	sideBySide(lines).map(({ left, right, note }) => {
		if (note) return element('div', 'line note split-note', note.line.text);

		const row = element('div', 'split-row');
		const side = (half, which) => {
			const cell = element('div', `side ${which} ${half ? half.line.kind : 'empty'}`);

			if (!half) return cell;

			const number = element('span', 'number', String(which === 'left' ? half.line.old : half.line.new));

			if (picked(offset + half.index)) cell.classList.add('picked');
			number.addEventListener('click', event => pick(offset + half.index, event));
			cell.append(...marks(half.line, which === 'left' ? 'old' : 'new'), number, ...textParts(half.line, language));

			return cell;
		};

		row.append(side(left, 'left'), side(right, 'right'));

		return row;
	});

// A set of file diffs, from any source, unified or side by side. A line number picks lines in its file (Shift+click,
// or a second tap on a touch screen, picks the range between); each hunk, or the lines picked, can be attached.
// Each file says what it is to the change (a test of which file, config, generated, a rename), and a file read under a
// heading (its `group`) says its part there; in a set of several, a generated file or one of a rename swept across
// files stays folded unless it's in `shown`, and its button calls onShow. A line open comments are on has a bar
// (`commentsAt(path, side, number)` says which), and clicking it calls onComment. Returns the container and, per
// file, its lines in order, which picks index into.
const renderDiffSet = ({
	set,
	layout,
	languageOf,
	selection,
	onPick,
	onAttachLines,
	shown,
	onShow,
	about,
	commentsAt = () => [],
	onComment,
}) => {
	const container = element('div', `diff ${layout}`);
	const files = [];
	const described = about ?? describeFiles(set.files);
	let group = null;

	if (!set.files.length) container.append(element('div', 'empty', 'Nothing differs.'));

	set.files.forEach((file, fileIndex) => {
		const { binary, hunks } = parseDiff(file.diff ?? '');
		const language = languageOf(file.path);
		const head = element('div', 'file-head');
		const lines = [];
		const picked = index => selection?.file === fileIndex && index >= selection.from && index <= selection.to;
		const pick = (index, event) => onPick(fileIndex, index, event);
		// Side by side, each half is its own side; unified, a line shows what's on either side it has
		const marks = (line, only) => {
			const on = side =>
				line[side] !== undefined && (!only || only === side) ? commentsAt(file.path, side, line[side]) : [];

			return commentMark([...new Set([...on('new'), ...on('old')])], onComment);
		};

		head.append(
			element('span', `status ${file.status}`, STATUS_LETTERS[file.status] ?? ''),
			element('span', 'file-path', file.from ? `${file.from} → ${file.path}` : file.path),
		);
		const what = described.get(file.path);
		const folded = folds(what) && set.files.length > 1 && !shown?.has(file.path);

		// Read under a heading (a function and where it's used, a rename across files): the heading once, above its first
		if (file.group && file.group !== group) container.append(element('div', 'group-head', file.group));
		group = file.group ?? null;
		if (file.part) head.append(element('span', 'file-label part', file.part));
		if (fileLabel(what)) head.append(element('span', 'file-label', fileLabel(what)));
		if (folded && onShow)
			head.append(button(`Show ${what.changed} changed lines`, () => onShow(file.path), { className: 'show' }));
		// The title names the set; a file's own path shows unless the title already is it
		if (set.files.length > 1 || set.title !== file.path) container.append(head);
		if (file.note || binary) container.append(element('div', 'empty', file.note ?? 'A binary file changed.'));

		for (const hunk of folded ? [] : hunks) {
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
				...(layout === 'split' ? splitRows : unifiedRows)({ lines: hunk.lines, offset, language, picked, pick, marks }),
			);
		}

		files.push({ path: file.path, lines, blobs: file.blobs ?? {} });
	});

	return { container, files };
};

export default renderDiffSet;
