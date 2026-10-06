const SPECIAL = /[.+^$()|[\]\\]/g;

const globToSource = glob => {
	let source = '';
	let braces = 0;

	for (let index = 0; index < glob.length; index++) {
		const character = glob[index];

		if (glob.startsWith('**/', index)) {
			source += '(?:.*/)?';
			index += 2;
		} else if (glob.startsWith('**', index)) {
			source += '.*';
			index += 1;
		} else if (character === '*') source += '[^/]*';
		else if (character === '?') source += '[^/]';
		else if (character === '{') {
			source += '(?:';
			braces += 1;
		} else if (character === '}' && braces) {
			source += ')';
			braces -= 1;
		} else if (character === ',' && braces) source += '|';
		else source += character.replace(SPECIAL, '\\$&');
	}

	return source;
};

// VS Code's "files to include/exclude": comma-separated globs. One without a slash matches at any depth, and a
// pattern naming a folder takes in everything under it.
export const globMatcher = patterns => {
	const globs = String(patterns ?? '')
		.split(/,(?![^{]*\})/)
		.map(glob =>
			glob
				.trim()
				.replace(/^\.?\//, '')
				.replace(/\/$/, ''),
		)
		.filter(Boolean);

	if (!globs.length) return null;

	const sources = globs.map(glob => `${glob.includes('/') ? '' : '(?:.*/)?'}${globToSource(glob)}`);
	const pattern = new RegExp(`^(?:${sources.join('|')})(?:/.*)?$`);

	return path => pattern.test(path);
};

// Whether a path passes both filters; either may be empty
export const pathFilter = ({ include, exclude } = {}) => {
	const included = globMatcher(include);
	const excluded = globMatcher(exclude);

	return path => (!included || included(path)) && !excluded?.(path);
};
