// What a server said when it refused, when it's a short line of plain words worth showing beside our own: not a page
// of HTML, a stack trace or a paragraph, which read as noise in a toast
const MOST = 120;

export const reasonOf = body => {
	const said = (typeof body === 'string' ? body : (body?.error ?? '')).trim();

	return said && said.length <= MOST && !/[\r\n<]/.test(said) ? said : '';
};

// Our sentence, with the server's reason after it when there's one worth showing, ending as that reason ends
const refusal = (sentence, body) => {
	const reason = reasonOf(body);

	if (!reason) return `${sentence}.`;

	return `${sentence}: ${reason}${/[.!?]$/.test(reason) ? '' : '.'}`;
};

export default refusal;
