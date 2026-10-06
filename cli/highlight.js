import hljs from 'highlight.js';

const ESC = '\x1b';
const MAX_HIGHLIGHT_BYTES = 200_000;
// highlight.js's classes in the 256-color palette, close to the web reader's colors. Only the foreground changes, so
// a highlighted cursor line keeps its background.
const COLORS = {
	keyword: 141,
	built_in: 117,
	type: 117,
	literal: 215,
	number: 215,
	string: 150,
	regexp: 150,
	symbol: 150,
	comment: 244,
	doc: 244,
	meta: 180,
	title: 111,
	'title.function': 111,
	'title.class': 117,
	params: 252,
	attr: 180,
	attribute: 180,
	variable: 216,
	'variable.language': 141,
	property: 117,
	tag: 167,
	name: 167,
	selector: 167,
	'selector-tag': 167,
	'selector-class': 180,
	'selector-id': 180,
	section: 111,
	bullet: 180,
	code: 150,
	emphasis: 252,
	strong: 252,
	link: 111,
	quote: 244,
	addition: 114,
	deletion: 167,
	subst: 252,
	punctuation: 247,
	operator: 247,
};

const ENTITIES = { '&lt;': '<', '&gt;': '>', '&amp;': '&', '&quot;': '"', '&#x27;': "'", '&#39;': "'" };

const colorOf = className => {
	const names = className
		.split(' ')
		.map(name => name.replace(/^hljs-/, '').replace(/_+$/, ''))
		.filter(Boolean);
	const full = names.join('.');

	return COLORS[full] ?? names.map(name => COLORS[name]).find(Boolean) ?? null;
};

const paint = color => (color ? `${ESC}[38;5;${color}m` : `${ESC}[39m`);

// highlight.js's HTML as one string of colored text per source line. Its spans can cross lines (a block comment, a
// template string), so each new line starts by restoring the color it opened in.
const htmlToLines = html => {
	const lines = [];
	const stack = [];
	let line = '';

	for (const [, tag, closing, className, text] of html.matchAll(/(<(\/)?span(?: class="([^"]*)")?>)|([^<]+)/g)) {
		if (tag) {
			if (closing) stack.pop();
			else stack.push(colorOf(className ?? ''));
			line += paint(stack.findLast(Boolean));
			continue;
		}

		const decoded = text.replace(/&(?:lt|gt|amp|quot|#x27|#39);/g, entity => ENTITIES[entity]);
		const parts = decoded.split('\n');

		parts.forEach((part, index) => {
			if (index > 0) {
				lines.push(`${line}${paint(null)}`);
				line = paint(stack.findLast(Boolean));
			}
			line += part;
		});
	}

	lines.push(`${line}${paint(null)}`);

	return lines;
};

const languageFor = path => {
	const name = path.split('/').at(-1).toLowerCase();
	const extension = name.includes('.') ? name.split('.').at(-1) : name;

	return [extension, name].find(candidate => hljs.getLanguage(candidate)) ?? null;
};

// Each line of a file colored by its language, or null when the language isn't known or the file is too big to bother.
// The text should already be free of control characters.
export const highlightLines = (text, path, language = languageFor(path)) => {
	if (!language || text.length > MAX_HIGHLIGHT_BYTES || !hljs.getLanguage(language)) return null;

	try {
		return htmlToLines(hljs.highlight(text, { language, ignoreIllegals: true }).value);
	} catch {
		return null;
	}
};
