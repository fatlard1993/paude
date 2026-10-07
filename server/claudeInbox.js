import { statusOf } from './activity';
import { promptText } from './sessions/history';
import { runningSession } from './sessions/running';
import { transcriptLines } from './sessions/transcript';

const RETRY_MS = 1000;
// Claude Code takes a paste and its Enter as one keystroke if they arrive together
const ENTER_AFTER_MS = 300;
// A message whose turn never shows up in the transcript (Claude cleared, or the session restarted) stops waiting
const GIVE_UP_MS = 60 * 60 * 1000;

// Per session: messages from chat and comments waiting to be typed into Claude, and those typed in, waiting for their
// turn to end. Each is { prompt, answer: text => Promise }.
const inboxes = new Map();

const inboxOf = id => {
	if (!inboxes.has(id)) inboxes.set(id, { queue: [], asked: [], timer: null });

	return inboxes.get(id);
};

// Typed in only when the prompt box is empty and Claude isn't asking anything: a message must neither answer a
// permission prompt nor run into what someone is halfway through typing. While Claude works, Claude queues it.
const deliver = id => {
	const inbox = inboxes.get(id);
	const session = runningSession(id);

	if (!inbox) return;
	clearTimeout(inbox.timer);
	if (!session) return inboxes.delete(id);
	if (!inbox.queue.length) return;

	if (statusOf(id) === 'waiting' || session.promptDraft() !== '') {
		inbox.timer = setTimeout(() => deliver(id), RETRY_MS);

		return;
	}

	const message = inbox.queue.shift();

	session.typeIn(`\x1b[200~${message.prompt}\x1b[201~`);
	setTimeout(() => session.typeIn('\r'), ENTER_AFTER_MS);
	inbox.asked.push({ ...message, at: Date.now() });
	if (inbox.queue.length) inbox.timer = setTimeout(() => deliver(id), RETRY_MS);
};

export const askClaude = (id, message) => {
	inboxOf(id).queue.push(message);
	deliver(id);
};

const textOf = line =>
	(line.message?.content ?? [])
		.filter(block => block.type === 'text')
		.map(block => block.text)
		.join('\n')
		.trim();

// Once a turn has ended, what Claude wrote in answer to `prompt`, from a transcript: the last of its replies after it
// with words in them ('' for none). undefined while Claude hasn't taken it up: it's not there yet, or nothing has
// answered it (the turn that ended was the one before, and this one is only starting).
export const answerTo = (lines, prompt) => {
	// Claude Code keeps a multi-line paste inside <pasted_content> tags
	const start = lines.findLastIndex(line => promptText(line)?.includes(prompt));

	if (start === -1) return undefined;

	const next = lines.findIndex((line, index) => index > start && promptText(line) !== null);
	const replies = lines.slice(start + 1, next === -1 ? undefined : next).filter(line => line.type === 'assistant');

	if (!replies.length && next === -1) return undefined;

	return replies.filter(textOf).map(textOf).at(-1) ?? '';
};

// Claude's hook says a turn ended before its last reply is in the transcript file, so the file is read again a few
// times before a message waits for the next turn
const READ_AGAIN_MS = [0, 300, 1000, 2500, 5000];

const sleep = ms => new Promise(done => setTimeout(done, ms));

// A turn ended (the Stop hook): every message whose turn is over gets its answer
export const turnEnded = async id => {
	for (const wait of READ_AGAIN_MS) {
		await sleep(wait);

		const inbox = inboxes.get(id);
		const session = runningSession(id);

		if (!inbox?.asked.length || !session) return;

		const lines = await transcriptLines(id, session.cwd);

		for (const message of [...inbox.asked]) {
			const answer = answerTo(lines, message.prompt);

			if (answer === undefined && Date.now() - message.at < GIVE_UP_MS) continue;

			inbox.asked = inbox.asked.filter(other => other !== message);
			if (answer !== undefined) await message.answer(answer || '(Claude finished without writing an answer.)');
		}

		deliver(id);
	}
};
