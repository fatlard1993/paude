// Patterns arrive from guests' searches, so matching has a hard cost ceiling: no backtracking regex, a memoized
// walk bounded by pattern length times path length, and caps on how much pattern there can be
const MAX_PATTERN = 200;
const MAX_GLOBS = 20;
const MAX_EXPANSIONS = 32;

// {a,b} alternatives become separate globs
const expandBraces = glob => {
	const open = glob.indexOf('{');
	const close = open === -1 ? -1 : glob.indexOf('}', open);

	if (close === -1) return [glob];

	return glob
		.slice(open + 1, close)
		.split(',')
		.flatMap(choice => expandBraces(`${glob.slice(0, open)}${choice}${glob.slice(close + 1)}`))
		.slice(0, MAX_EXPANSIONS);
};

// dirs: any whole folders (**/), any: anything (**), star: within a name (*), one: a character of a name (?)
const tokenize = glob => {
	const tokens = [];

	for (let index = 0; index < glob.length; index++) {
		if (glob.startsWith('**/', index)) {
			tokens.push({ kind: 'dirs' });
			index += 2;
		} else if (glob.startsWith('**', index)) {
			tokens.push({ kind: 'any' });
			index += 1;
		} else if (glob[index] === '*') tokens.push({ kind: 'star' });
		else if (glob[index] === '?') tokens.push({ kind: 'one' });
		else tokens.push({ kind: 'literal', character: glob[index] });
	}

	return tokens;
};

// A glob matches a path, or a folder the path is inside
const matches = (tokens, path) => {
	const memo = new Map();
	const scanMemo = new Map();

	const from = (token, at) => {
		const key = token * (path.length + 1) + at;

		if (memo.has(key)) return memo.get(key);

		let result;
		const current = tokens[token];
		const character = path[at];

		if (!current) result = at === path.length || character === '/';
		else if (current.kind === 'literal') result = character === current.character && from(token + 1, at + 1);
		else if (current.kind === 'one') result = character !== undefined && character !== '/' && from(token + 1, at + 1);
		else if (current.kind === 'star')
			result = from(token + 1, at) || (character !== undefined && character !== '/' && from(token, at + 1));
		else if (current.kind === 'any') result = from(token + 1, at) || (character !== undefined && from(token, at + 1));
		else result = from(token + 1, at) || afterSlash(token, at);

		memo.set(key, result);

		return result;
	};

	// The rest of the glob after some folder boundary at or past `at`
	const afterSlash = (token, at) => {
		const key = token * (path.length + 1) + at;

		if (scanMemo.has(key)) return scanMemo.get(key);

		const result = at < path.length && ((path[at] === '/' && from(token + 1, at + 1)) || afterSlash(token, at + 1));

		scanMemo.set(key, result);

		return result;
	};

	return from(0, 0);
};

// VS Code's "files to include/exclude": comma-separated globs. One without a slash matches at any depth, and a
// pattern naming a folder takes in everything under it.
export const globMatcher = patterns => {
	const globs = String(patterns ?? '')
		.slice(0, MAX_PATTERN)
		.split(/,(?![^{]*\})/)
		.map(glob =>
			glob
				.trim()
				.replace(/^\.?\//, '')
				.replace(/\/$/, ''),
		)
		.filter(Boolean)
		.flatMap(expandBraces)
		.slice(0, MAX_GLOBS)
		.map(glob => tokenize(glob.includes('/') ? glob : `**/${glob}`));

	if (!globs.length) return null;

	return path => globs.some(tokens => matches(tokens, path));
};

export const pathFilter = ({ include, exclude } = {}) => {
	const included = globMatcher(include);
	const excluded = globMatcher(exclude);

	return path => (!included || included(path)) && !excluded?.(path);
};
