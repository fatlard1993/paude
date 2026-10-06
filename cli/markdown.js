import { marked } from 'marked';

import { highlightLines } from './highlight';
import { ACCENT, printable, visibleLength } from './screen';

const ESC = '\x1b';
const style = (codes, text) => `${ESC}[${codes}m${text}${ESC}[0m`;
const CODE_BACKGROUND = 236;

// Inline markdown as colored text; everything from the file goes through printable() first
const inline = tokens =>
	(tokens ?? [])
		.map(token => {
			switch (token.type) {
				case 'strong':
					return style('1', inline(token.tokens));
				case 'em':
					return style('3', inline(token.tokens));
				case 'del':
					return style('9', inline(token.tokens));
				case 'codespan':
					return style(`38;5;150;48;5;${CODE_BACKGROUND}`, printable(token.text));
				case 'link':
					return `${style('4;38;5;111', inline(token.tokens))}${token.href.startsWith('#') ? '' : style('2', ` (${printable(token.href)})`)}`;
				case 'image':
					return style('38;5;140', `[image: ${printable(token.text || token.href)}]`);
				case 'br':
					return '\n';
				case 'escape':
				case 'text':
					return token.tokens ? inline(token.tokens) : printable(token.text);
				case 'html':
					return style('2', printable(token.text));
				default:
					return printable(token.raw ?? '');
			}
		})
		.join('');

// Word-wraps colored text to a width, carrying no style across lines (each inline style closes itself)
const wrapStyled = (text, width) => {
	const lines = [];

	for (const paragraph of text.split('\n')) {
		let line = '';

		for (const word of paragraph.split(' ')) {
			if (line && visibleLength(line) + 1 + visibleLength(word) > width) {
				lines.push(line);
				line = word;
			} else line = line ? `${line} ${word}` : word;
		}

		lines.push(line);
	}

	return lines;
};

const HEADING_MARKS = ['#', '##', '###', '####', '#####', '######'];

const block = (token, width) => {
	switch (token.type) {
		case 'heading':
			return [
				'',
				style(`1;38;5;${ACCENT}`, `${HEADING_MARKS[token.depth - 1]} `) +
					style(`1;38;5;${token.depth === 1 ? 223 : 252}`, inline(token.tokens)),
			];
		case 'paragraph':
			return ['', ...wrapStyled(inline(token.tokens), width)];
		case 'code': {
			const source = printable(token.text.replaceAll('\t', '    ').replaceAll('\n', ' ')).replaceAll(' ', '\n');
			const lines = highlightLines(source, '', token.lang?.split(/\s/)[0] || undefined) ?? source.split('\n');
			const inner = Math.max(...lines.map(visibleLength), 0);

			return [
				'',
				...lines.map(line => {
					const padded = `  ${line}${' '.repeat(Math.max(inner - visibleLength(line), 0))}  `;

					return `${ESC}[48;5;${CODE_BACKGROUND}m${padded}${ESC}[0m`;
				}),
			];
		}
		case 'blockquote':
			return [
				'',
				...token.tokens
					.flatMap(child => block(child, width - 2))
					.filter((line, index) => index > 0 || line)
					.map(line => `${style(`38;5;${ACCENT}`, '│')} ${style('3', line)}`),
			];
		case 'list':
			return [
				'',
				...token.items.flatMap((item, index) => {
					const marker = token.ordered ? `${(token.start || 1) + index}.` : '•';
					const check = item.task ? `${item.checked ? '☑' : '☐'} ` : '';
					const body = item.tokens
						.flatMap(child =>
							child.type === 'text' ? wrapStyled(inline(child.tokens ?? [child]), width - 4) : block(child, width - 4),
						)
						.filter((line, lineIndex) => lineIndex > 0 || line);

					return body.map(
						(line, lineIndex) =>
							`${lineIndex ? '   ' : style(`38;5;${ACCENT}`, ` ${marker}`)} ${lineIndex ? '' : check}${line}`,
					);
				}),
			];
		case 'table': {
			const rows = [token.header, ...token.rows].map(cells => cells.map(cell => inline(cell.tokens)));
			const widths = token.header.map((_, column) => Math.max(...rows.map(row => visibleLength(row[column] ?? ''))));
			const line = row =>
				row.map((cell, column) => `${cell}${' '.repeat(widths[column] - visibleLength(cell))}`).join('  │  ');

			return [
				'',
				style('1', line(rows[0])),
				style('2', widths.map(size => '─'.repeat(size)).join('──┼──')),
				...rows.slice(1).map(line),
			];
		}
		case 'hr':
			return ['', style('2', '─'.repeat(Math.min(width, 40)))];
		case 'html':
			return [
				'',
				...printable(token.text)
					.split('\n')
					.map(text => style('2', text)),
			];
		case 'space':
			return [];
		default:
			return token.tokens ? ['', ...wrapStyled(inline(token.tokens), width)] : [];
	}
};

// A markdown file as lines of terminal text, wrapped to a width
export const renderMarkdown = (text, width) => {
	const lines = marked.lexer(text).flatMap(token => block(token, width));

	return lines[0] === '' ? lines.slice(1) : lines;
};
