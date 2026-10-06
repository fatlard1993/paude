// A search box's query as its options read it (VS Code's match case, whole word, regular expression), the way the
// server searches file contents; null when it isn't a valid expression
const searchPattern = (query, { caseSensitive, wholeWord, regex } = {}, flags = '') => {
	const source = regex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

	try {
		return new RegExp(wholeWord ? `\\b(?:${source})\\b` : source, `${flags}${caseSensitive ? '' : 'i'}`);
	} catch {
		return null;
	}
};

export default searchPattern;
