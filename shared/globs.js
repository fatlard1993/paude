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

export const pathFilter = ({ include, exclude } = {}) => {
	const included = globMatcher(include);
	const excluded = globMatcher(exclude);

	return path => (!included || included(path)) && !excluded?.(path);
};
