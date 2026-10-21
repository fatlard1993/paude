const C = { line: '//', block: { open: '/*', close: '*/' } };
const HASH = { line: '#' };
const DASHES = { line: '--' };
const MARKUP = { block: { open: '<!--', close: '-->' } };

const BY_EXTENSION = {
	...Object.fromEntries(
		['js', 'mjs', 'cjs', 'jsx', 'ts', 'mts', 'cts', 'tsx', 'c', 'h', 'cc', 'cpp', 'hpp', 'cs', 'java', 'kt', 'kts']
			.concat(['go', 'rs', 'swift', 'scala', 'dart', 'php', 'scss', 'less', 'groovy', 'gradle', 'zig', 'proto'])
			.concat(['jsonc', 'json5'])
			.map(extension => [extension, C]),
	),
	css: { block: C.block },
	...Object.fromEntries(
		['py', 'rb', 'sh', 'bash', 'zsh', 'fish', 'yaml', 'yml', 'toml', 'r', 'pl', 'conf', 'cfg', 'tf', 'nix', 'ex']
			.concat(['exs', 'jl', 'cmake', 'ps1', 'gitignore', 'dockerignore', 'env', 'properties'])
			.map(extension => [extension, HASH]),
	),
	...Object.fromEntries(['sql', 'lua', 'hs', 'elm'].map(extension => [extension, DASHES])),
	...Object.fromEntries(
		['html', 'htm', 'xml', 'svg', 'md', 'markdown', 'vue', 'svelte'].map(extension => [extension, MARKUP]),
	),
	ini: { line: ';' },
	lisp: { line: ';' },
	clj: { line: ';' },
	el: { line: ';' },
	vim: { line: '"' },
	tex: { line: '%' },
	erl: { line: '%' },
};

const BY_NAME = { makefile: HASH, dockerfile: HASH, gemfile: HASH, rakefile: HASH, justfile: HASH, procfile: HASH };

// How a file's lines are commented out, by its name or extension: { line, block: { open, close } }, either of them,
// or null for a file whose kind isn't known
const commentTokens = path => {
	const name = path.split('/').at(-1).toLowerCase();
	const dot = name.lastIndexOf('.');

	return BY_NAME[name] ?? BY_EXTENSION[dot >= 0 ? name.slice(dot + 1) : ''] ?? null;
};

export default commentTokens;
