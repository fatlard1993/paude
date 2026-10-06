// null when a regular-expression query isn't valid
const searchPattern = (query, { caseSensitive, wholeWord, regex } = {}, flags = '') => {
	const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	try {
		return new RegExp(wholeWord ? `\\b(?:${source})\\b` : source, `${flags}${caseSensitive ? '' : 'i'}`);
	} catch {
		return null;
	}
};

export default searchPattern;
