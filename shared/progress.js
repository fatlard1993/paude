// Reads a streamed answer of JSON lines: each { output } goes to onOutput as it arrives, anything else that isn't
// the answer ({ waiting }) is passed over, and it resolves with the answer, { id } or { error }
export const readProgress = async (response, onOutput) => {
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	let buffered = '';
	let last = null;

	for (;;) {
		const { done, value } = await reader.read();

		if (done) break;
		buffered += decoder.decode(value, { stream: true });

		let end;

		while ((end = buffered.indexOf('\n')) !== -1) {
			const line = buffered.slice(0, end);

			buffered = buffered.slice(end + 1);
			if (!line) continue;

			const message = JSON.parse(line);

			if (typeof message.output === 'string') onOutput(message.output);
			else if ('id' in message || 'error' in message) last = message;
		}
	}

	return last ?? { error: 'The server stopped answering.' };
};

const ESC = '\x1b';
const BEL = '\x07';
const ESCAPES = new RegExp(`${ESC}(?:\\[[0-?]*[ -/]*[@-~]|\\][^${BEL}${ESC}]*(?:${BEL}|${ESC}\\\\)|[@-Z\\\\-_])`, 'g');
// Printable characters and tabs; the rest of the control characters go
const printable = character => character === '\t' || (character >= ' ' && character !== '\x7f');

// The last `count` lines of a command's output as plain text: colors gone, and a line a progress bar redrew with
// carriage returns showing only its latest state
export const recentLines = (output, count) =>
	output
		.replace(ESCAPES, '')
		.split('\n')
		.map(line => line.split('\r').filter(Boolean).at(-1) ?? '')
		.map(line => [...line].filter(printable).join(''))
		.filter((line, index, lines) => line || index < lines.length - 1)
		.slice(-count);
