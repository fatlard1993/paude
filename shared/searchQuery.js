// The search box's query and options as URL parameters, and back: what the clients send and the server reads
export const searchParameters = (query, { caseSensitive, wholeWord, regex, include, exclude } = {}) => ({
	q: query,
	case: caseSensitive ? '1' : '',
	word: wholeWord ? '1' : '',
	regex: regex ? '1' : '',
	include: include ?? '',
	exclude: exclude ?? '',
});

const on = value => value === '1' || value === 'true';

export const searchOptionsFrom = parameters => ({
	caseSensitive: on(parameters.case),
	wholeWord: on(parameters.word),
	regex: on(parameters.regex),
	include: parameters.include,
	exclude: parameters.exclude,
});
