// A server's reason worth showing beside our own: one short line of plain words, not HTML, a stack trace or a
// paragraph
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
