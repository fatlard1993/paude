import { stat } from 'fs/promises';
import path from 'path';

import { listFiles } from './files';

// Where things are defined, in any language, without a language server: each language's declaration forms, matched
// line by line, over the project's own files (git's list, so not node_modules or build output). Less exact than a
// compiler, but it's there for every project the moment it opens. Each file's symbols are kept until it changes.
const MAX_FILE_BYTES = 512 * 1024;
const MAX_RESULTS = 100;
const NAME = '([A-Za-z_$][\\w$]*)';

const JS = [
	[`^\\s*(?:export\\s+)?(?:default\\s+)?(?:async\\s+)?function\\*?\\s+${NAME}`, 'function'],
	[`^\\s*(?:export\\s+)?(?:default\\s+)?(?:abstract\\s+)?class\\s+${NAME}`, 'class'],
	[`^\\s*(?:export\\s+)?(?:declare\\s+)?(?:interface|type|enum)\\s+${NAME}`, 'type'],
	// Top-level only: a const inside a function is that function's business
	[
		`^(?:export\\s+)?(?:const|let|var)\\s+${NAME}\\s*(?::[^=]+)?=\\s*(?:async\\s*)?(?:\\([^)]*\\)|[\\w$]+)\\s*=>`,
		'function',
	],
	[`^(?:export\\s+)?(?:const|let|var)\\s+${NAME}\\s*(?::[^=]+)?=`, 'value'],
	[`^\\s+(?:static\\s+|async\\s+|get\\s+|set\\s+|#)*${NAME}\\s*\\([^)]*\\)\\s*\\{`, 'method'],
];

const LANGUAGES = {
	js: JS,
	jsx: JS,
	mjs: JS,
	cjs: JS,
	ts: JS,
	tsx: JS,
	vue: JS,
	svelte: JS,
	py: [
		[`^\\s*(?:async\\s+)?def\\s+${NAME}`, 'function'],
		[`^\\s*class\\s+${NAME}`, 'class'],
		[`^${NAME}\\s*(?::[^=]+)?=`, 'value'],
	],
	go: [
		[`^func\\s+(?:\\([^)]*\\)\\s*)?${NAME}`, 'function'],
		[`^type\\s+${NAME}`, 'type'],
		[`^(?:var|const)\\s+${NAME}`, 'value'],
	],
	rs: [
		[`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:async\\s+)?(?:unsafe\\s+)?fn\\s+${NAME}`, 'function'],
		[`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:struct|enum|trait|type|union)\\s+${NAME}`, 'type'],
		[`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?mod\\s+${NAME}`, 'module'],
		[`^\\s*(?:pub(?:\\([^)]*\\))?\\s+)?(?:const|static)\\s+${NAME}`, 'value'],
	],
	rb: [
		[`^\\s*def\\s+(?:self\\.)?${NAME}`, 'function'],
		[`^\\s*(?:class|module)\\s+${NAME}`, 'class'],
	],
	java: [
		[`^\\s*(?:public|private|protected|static|final|abstract|\\s)*(?:class|interface|enum|record)\\s+${NAME}`, 'class'],
	],
	kt: [
		[`^\\s*(?:\\w+\\s+)*(?:class|interface|object)\\s+${NAME}`, 'class'],
		[`^\\s*(?:\\w+\\s+)*fun\\s+(?:<[^>]*>\\s*)?(?:[\\w.]+\\.)?${NAME}`, 'function'],
	],
	cs: [
		[
			`^\\s*(?:public|private|protected|internal|static|sealed|abstract|partial|\\s)*(?:class|interface|enum|struct|record)\\s+${NAME}`,
			'class',
		],
	],
	php: [
		[`^\\s*(?:\\w+\\s+)*function\\s+${NAME}`, 'function'],
		[`^\\s*(?:abstract\\s+|final\\s+)?(?:class|interface|trait)\\s+${NAME}`, 'class'],
	],
	sh: [[`^\\s*(?:function\\s+)?${NAME}\\s*\\(\\)`, 'function']],
	zsh: [[`^\\s*(?:function\\s+)?${NAME}\\s*\\(\\)`, 'function']],
	bash: [[`^\\s*(?:function\\s+)?${NAME}\\s*\\(\\)`, 'function']],
	lua: [[`^\\s*(?:local\\s+)?function\\s+(?:[\\w.:]+[.:])?${NAME}`, 'function']],
	c: [[`^(?:static\\s+|inline\\s+|extern\\s+)*[\\w\\s*]+?\\b${NAME}\\s*\\([^;]*\\)\\s*\\{?\\s*$`, 'function']],
	h: [[`^(?:typedef\\s+)?(?:struct|enum|union)\\s+${NAME}`, 'type']],
	md: [['^#{1,6}\\s+(.+)$', 'heading']],
};

LANGUAGES.cpp = LANGUAGES.c;
LANGUAGES.hpp = LANGUAGES.h;

const COMPILED = Object.fromEntries(
	Object.entries(LANGUAGES).map(([extension, forms]) => [
		extension,
		forms.map(([form, kind]) => [new RegExp(form), kind]),
	]),
);

// Words that look like declarations to the patterns above but aren't (`if (...) {` as a method, say)
const NOT_NAMES = new Set([
	'if',
	'for',
	'while',
	'switch',
	'catch',
	'return',
	'function',
	'else',
	'do',
	'try',
	'with',
	'super',
	'constructor',
]);

const extensionOf = file => path.extname(file).slice(1).toLowerCase();

export const languageKnown = file => Boolean(COMPILED[extensionOf(file)]);

// The symbols one file declares: [{ name, kind, line }]
export const symbolsIn = (text, file) => {
	const forms = COMPILED[extensionOf(file)];

	if (!forms) return [];

	const found = [];

	text.split('\n').forEach((line, index) => {
		for (const [form, kind] of forms) {
			const name = form.exec(line)?.[1]?.trim();

			if (name && !NOT_NAMES.has(name)) {
				found.push({ name, kind, line: index + 1 });
				break;
			}
		}
	});

	return found;
};

const cache = new Map();

const fileSymbols = async (cwd, file) => {
	const full = path.join(cwd, file);
	const info = await stat(full).catch(() => null);

	if (!info?.isFile() || info.size > MAX_FILE_BYTES) return [];

	const key = `${cwd}\0${file}`;
	const cached = cache.get(key);

	if (cached?.modified === info.mtimeMs) return cached.symbols;

	const symbols = symbolsIn(await Bun.file(full).text(), file).map(symbol => ({ ...symbol, file }));

	cache.set(key, { modified: info.mtimeMs, symbols });

	return symbols;
};

const allSymbols = async cwd => {
	const files = (await listFiles(cwd)).filter(languageKnown);

	return (await Promise.all(files.map(file => fileSymbols(cwd, file)))).flat();
};

// One file's outline, in order
export const outline = async (cwd, file) => (languageKnown(file) ? fileSymbols(cwd, file) : []);

// Where a name is defined; the file asking first, so a local name wins
export const definitions = async (cwd, name, { from } = {}) =>
	(await allSymbols(cwd))
		.filter(symbol => symbol.name === name)
		.sort((a, b) => (b.file === from) - (a.file === from) || a.file.localeCompare(b.file))
		.slice(0, MAX_RESULTS);

// Symbols whose names match what's typed: those starting with it first, then those containing it
export const searchSymbols = async (cwd, query) => {
	const wanted = query.trim().toLowerCase();

	if (!wanted) return [];

	const rank = name => {
		const lower = name.toLowerCase();

		if (lower === wanted) return 0;
		if (lower.startsWith(wanted)) return 1;

		return lower.includes(wanted) ? 2 : null;
	};

	return (await allSymbols(cwd))
		.filter(symbol => symbol.kind !== 'heading')
		.map(symbol => ({ symbol, rank: rank(symbol.name) }))
		.filter(({ rank: found }) => found !== null)
		.sort((a, b) => a.rank - b.rank || a.symbol.name.length - b.symbol.name.length)
		.slice(0, MAX_RESULTS)
		.map(({ symbol }) => symbol);
};
