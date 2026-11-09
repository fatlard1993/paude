import path from 'path';
import { delay } from '@vanilla-bean/components/utils/data';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { statusOf } from './activity';
import { promptText } from './sessions/history';
import { runningSession } from './sessions/running';
import { transcriptLines } from './sessions/transcript';

const RETRY_MS = 1000;
// Claude Code takes a paste and its Enter as one keystroke if they arrive together
const ENTER_AFTER_MS = 300;
// A message whose turn never shows up in the transcript (Claude cleared, or the session restarted) stops waiting
const GIVE_UP_MS = 60 * 60 * 1000;

// Per session: messages from chat, comments and prompts waiting to be typed into Claude, and those typed in, waiting
// for their turn to end. Each is { prompt, to }, `to` where Claude's answer goes (as the answersGo handler takes it),
// or nothing for one nobody reads back. Saved to a file as they change: a server restart (every save, in dev mode)
// hands them on to the next server instead of dropping what was already accepted.
const inboxes = new Map();
let file = null;
let sessionOf = runningSession;
let sendAnswer = async () => {};

const save = () =>
	file &&
	writeJsonFile(file, () => Object.fromEntries([...inboxes].map(([id, { queue, asked }]) => [id, { queue, asked }])));

const inboxOf = id => {
	if (!inboxes.has(id)) inboxes.set(id, { queue: [], asked: [], timer: null });

	return inboxes.get(id);
};

// Typed in only when the prompt box is empty and Claude isn't asking anything: a message must neither answer a
// permission prompt nor run into what someone is halfway through typing. While Claude works, Claude queues it. A
// question of Claude's that takes words (its "type something" option) takes the message as its answer, as it would
// take the same words typed at the terminal: the words are what the person wants done next, whatever was offered.
const deliver = id => {
	const inbox = inboxes.get(id);
	const session = sessionOf(id);

	if (!inbox) return;
	clearTimeout(inbox.timer);
	if (!session) {
		inboxes.delete(id);

		return save();
	}
	if (!inbox.queue.length) return;

	const asked = statusOf(id) === 'waiting' ? session.asking?.() : null;

	if (asked?.typing && session.answer(asked.question, asked.typing, inbox.queue[0].prompt)) {
		inbox.asked.push({ ...inbox.queue.shift(), at: Date.now() });
		if (inbox.queue.length) inbox.timer = setTimeout(() => deliver(id), RETRY_MS);

		return save();
	}
	if (statusOf(id) === 'waiting' || session.promptDraft() !== '') {
		inbox.timer = setTimeout(() => deliver(id), RETRY_MS);

		return;
	}

	const message = inbox.queue.shift();

	session.typeIn(`\x1b[200~${message.prompt}\x1b[201~`);
	setTimeout(() => session.typeIn('\r'), ENTER_AFTER_MS);
	inbox.asked.push({ ...message, at: Date.now() });
	if (inbox.queue.length) inbox.timer = setTimeout(() => deliver(id), RETRY_MS);

	return save();
};

// Where the messages wait between servers; the ones waiting are taken up again, for the sessions running (adopted
// from the last server) and Claude's answers go to the answersGo handler as (sessionId, to, text)
export const initClaudeInbox = async (dataDir, running = runningSession) => {
	file = path.join(dataDir, 'claude-inbox.json');
	sessionOf = running;
	for (const inbox of inboxes.values()) clearTimeout(inbox.timer);
	inboxes.clear();
	for (const [id, { queue = [], asked = [] }] of Object.entries(await readJsonFile(file, {}))) {
		inboxes.set(id, { queue, asked, timer: null });
		deliver(id);
	}

	return save();
};

export const answersGo = answer => (sendAnswer = answer);

// Someone's message waits to be typed into Claude
export const waitingToAsk = id => Boolean(inboxes.get(id)?.queue.length);

// Resolves once it's saved, typed in or waiting
export const askClaude = (id, { prompt, to }) => {
	inboxOf(id).queue.push({ prompt, ...(to && { to }) });
	deliver(id);

	return save();
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

// A turn ended (the Stop hook): every message whose turn is over gets its answer
export const turnEnded = async id => {
	for (const wait of READ_AGAIN_MS) {
		await delay(wait);

		const inbox = inboxes.get(id);
		const session = sessionOf(id);

		if (!inbox?.asked.length || !session) return;

		const lines = await transcriptLines(id, session.cwd);

		for (const message of [...inbox.asked]) {
			const answer = answerTo(lines, message.prompt);

			if (answer === undefined && Date.now() - message.at < GIVE_UP_MS) continue;

			inbox.asked = inbox.asked.filter(other => other !== message);
			save();
			if (answer !== undefined && message.to)
				await sendAnswer(id, message.to, answer || '(Claude finished without writing an answer.)');
		}

		deliver(id);
	}
};
