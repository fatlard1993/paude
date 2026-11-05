import { stat } from 'fs/promises';
import { fileURLToPath } from 'url';

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

const withoutPasteMarks = input =>
	input.startsWith(PASTE_START) && input.endsWith(PASTE_END)
		? input.slice(PASTE_START.length, -PASTE_END.length)
		: input;

// A terminal hands a dropped file over as text, pasted or typed: a file:// URI, or a path quoted or escaped the way a
// shell reads it, one or several, separated by spaces or lines. null when the input is anything else.
export const droppedPaths = input => {
	const text = withoutPasteMarks(input);
	const words = [];
	let word = null;
	let quote = null;

	for (let at = 0; at < text.length; at++) {
		const character = text[at];

		if (quote) {
			if (character === quote) quote = null;
			else if (character === '\\' && quote === '"' && at + 1 < text.length) word += text[++at];
			else word += character;
		} else if (character === "'" || character === '"') {
			quote = character;
			word ??= '';
		} else if (character === '\\' && at + 1 < text.length) word = (word ?? '') + text[++at];
		else if (/\s/.test(character)) {
			if (word !== null) words.push(word);
			word = null;
		} else word = (word ?? '') + character;
	}
	if (quote) return null;
	if (word !== null) words.push(word);

	const paths = words.map(written => {
		if (written.startsWith('file://')) {
			try {
				return fileURLToPath(written);
			} catch {
				return null;
			}
		}

		return written;
	});

	return paths.length && paths.every(path => path?.startsWith('/')) ? paths : null;
};

// As a paste Claude attaches an image from: the paths alone, a space in one escaped, nothing after them
export const pastedPaths = paths =>
	`${PASTE_START}${paths.map(path => path.replace(/\s/g, '\\$&')).join(' ')}${PASTE_END}`;

const isFile = path =>
	stat(path).then(
		found => found.isFile(),
		() => false,
	);

export const allFiles = async paths => (await Promise.all(paths.map(isFile))).every(Boolean);
