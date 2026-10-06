import { parseDiff } from '../../shared/diff';
import { button, element } from '../dom';

const MARK = { added: '+', removed: '-', context: ' ', note: '' };

// One file's changes as hunks, each line numbered on its side. A line number picks lines (Shift+click, or a second
// tap on a touch screen, picks the range between), and each hunk can be attached whole.
const renderDiff = ({ text, language, selection, onPick, onAttachHunk }) => {
	const { binary, hunks } = parseDiff(text);
	const container = element('div', 'diff');
	const rows = [];

	if (binary) container.append(element('div', 'empty', 'A binary file changed.'));
	else if (!hunks.length)
		container.append(element('div', 'empty', 'No line changes (an empty file, or only its mode).'));

	for (const hunk of hunks) {
		const head = element('div', 'hunk-head');

		head.append(element('span', 'where', `@@ -${hunk.oldStart} +${hunk.newStart} @@ ${hunk.heading}`));
		if (onAttachHunk)
			head.append(button('Attach', () => onAttachHunk(hunk), { title: 'Attach this hunk to the prompt' }));
		container.append(head);

		for (const line of hunk.lines) {
			const index = rows.length;
			const picked = selection && index >= selection.from && index <= selection.to;
			const row = element('div', `line ${line.kind}${picked ? ' picked' : ''}`);
			const numbers = element('span', 'numbers');

			rows.push(line);
			numbers.append(element('span', '', line.old ?? ''), element('span', '', line.new ?? ''));
			numbers.addEventListener('click', event => onPick(index, event));
			row.append(
				numbers,
				element('span', 'mark', MARK[line.kind]),
				element('code', language ? `language-${language}` : 'plain', line.text || ' '),
			);
			container.append(row);
		}
	}

	return { container, rows };
};

export default renderDiff;
