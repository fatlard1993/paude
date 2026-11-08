// An answer in words to a question Claude asks: its "Type something" option pressed, the words pasted once the option
// has opened for them, and Enter once they show. Each step waits for the screen rather than a fixed moment, since a
// loaded machine opens the field late, and words pasted before it opens land in the prompt box instead, to ride along
// with whatever is sent next.
const POLL_MS = 60;
const WAIT_MS = 2500;

const screenText = session => {
	const buffer = session.mirror.buffer.active;
	const lines = [];

	for (let y = 0; y < buffer.length; y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? '');

	return lines.join('\n');
};

const until = async (session, test, { pollMs, waitMs }) => {
	const end = Date.now() + waitMs;

	while (Date.now() < end) {
		if (test(screenText(session))) return true;
		await Bun.sleep(pollMs);
	}

	return false;
};

// Resolves to whether the words went in as the answer. The option is `key`; the words are typed as one paste.
const answerInWords = async (session, key, text, { pollMs = POLL_MS, waitMs = WAIT_MS } = {}) => {
	const cursorOn = new RegExp(`^\\s*❯\\s*${key}\\.`, 'm');
	const words = String(text).trim();
	const shown = words.slice(0, 24);

	session.typeIn(key);
	if (!(await until(session, screen => cursorOn.test(screen), { pollMs, waitMs }))) return false;
	session.typeIn(`\x1b[200~${words}\x1b[201~`);
	if (!(await until(session, screen => screen.includes(shown), { pollMs, waitMs }))) return false;
	session.typeIn('\r');

	return true;
};

export default answerInWords;
