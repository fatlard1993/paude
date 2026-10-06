import { pathFilter } from './globs';
import searchPattern from './searchPattern';

const IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'svg', 'ico', 'bmp']);
const VIDEO = new Set(['mp4', 'webm', 'mov', 'ogv', 'm4v']);
const AUDIO = new Set(['mp3', 'wav', 'ogg', 'oga', 'm4a', 'flac', 'aac', 'opus']);
const MARKDOWN = new Set(['md', 'markdown', 'mdx']);

// A dotless name is its own extension (Dockerfile, Makefile)
export const extensionOf = path => {
	const name = path.split('/').at(-1).toLowerCase();

	return name.includes('.') ? name.split('.').at(-1) : name;
};

export const kindOf = path => {
	const extension = extensionOf(path);

	if (IMAGE.has(extension)) return 'image';
	if (VIDEO.has(extension)) return 'video';
	if (AUDIO.has(extension)) return 'audio';
	if (extension === 'pdf') return 'pdf';
	if (MARKDOWN.has(extension)) return 'markdown';

	return 'text';
};

// Every query character in order, closer together and nearer the file name scoring better; null for no match
export const fuzzyScore = (path, query, caseSensitive) => {
	const haystack = caseSensitive ? path : path.toLowerCase();
	let position = -1;
	let score = 0;

	for (const character of caseSensitive ? query : query.toLowerCase()) {
		const found = haystack.indexOf(character, position + 1);

		if (found === -1) return null;

		score += found - position;
		position = found;
	}

	return score - position / haystack.length + (haystack.length - haystack.lastIndexOf('/')) / 100;
};

// File names for a query, best first: whole word and regex match exactly, anything else loosely, the way editors
// find files. Files to include and exclude narrow them either way. null when the query isn't a valid expression.
export const matchNames = (paths, query, options = {}) => {
	const wanted = paths.filter(pathFilter(options));

	if (!query) return wanted;

	const pattern = (options.wholeWord || options.regex) && searchPattern(query, options);

	if (pattern === null) return null;
	if (pattern) return wanted.filter(path => pattern.test(path)).sort((a, b) => a.length - b.length);

	return wanted
		.map(path => ({ path, score: fuzzyScore(path, query, options.caseSensitive) }))
		.filter(({ score }) => score !== null)
		.sort((a, b) => a.score - b.score)
		.map(({ path }) => path);
};

// What attaching puts in Claude's prompt: an @-mention Claude Code reads itself, or the lines quoted with their place
export const attachFileText = path => `@${path} `;

export const attachLinesText = (path, from, to, text) => {
	const range = from === to ? `line ${from}` : `lines ${from}-${to}`;

	return `${path} ${range}:\n\`\`\`\n${text}\n\`\`\`\n`;
};
