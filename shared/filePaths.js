// What could be a path in a row of text: anything between spaces, brackets, quotes and commas
const TOKEN = /[^\s()[\]{}<>"'`,|]+/g;
const TRAILING = /[.:;!?]+$/;
// path:12, path:12:5 (a column), path:12-20, path#L12, path#L12-L20
const LOCATION = /^(.+?)(?::(\d+)(?:-(\d+))?(?::\d+)?|#L(\d+)(?:-L?(\d+))?)?$/;

// Finds a project's file from how Claude might name it: as listed, from ./, absolutely or from ~ (by the longest
// listed path it ends with), or by its bare name when no other file shares it. null for anything else.
export const pathResolver = paths => {
	const listed = new Set(paths);
	const byName = new Map();

	for (const path of paths) {
		const name = path.split('/').at(-1);

		byName.set(name, byName.has(name) ? null : path);
	}

	return written => {
		const path = written.replace(/^\.\//, '');

		if (listed.has(path)) return path;
		if (/^(\/|~\/)/.test(path)) {
			const parts = path.split('/');

			for (let start = 1; start < parts.length; start++) {
				const within = parts.slice(start).join('/');

				if (listed.has(within)) return within;
			}

			return null;
		}

		return path.includes('/') ? null : (byName.get(path) ?? null);
	};
};

// The project files a row of text names: [{ path, line, lastLine, from, to }], `to` exclusive, string indexes
const findFilePaths = (text, resolve) => {
	const found = [];

	for (const token of text.matchAll(TOKEN)) {
		const written = token[0].replace(/^@/, '').replace(TRAILING, '');
		const [, name, line, lastLine, hashLine, hashLast] = LOCATION.exec(written) ?? [];

		if (!name || name.includes('://') || !/[./]/.test(name)) continue;

		const path = resolve(name);

		if (!path) continue;

		const from = token.index + token[0].indexOf(written);
		const first = Number(line ?? hashLine) || null;

		found.push({
			path,
			line: first,
			lastLine: Number(lastLine ?? hashLast) || first,
			from,
			to: from + written.length,
		});
	}

	return found;
};

export default findFilePaths;
