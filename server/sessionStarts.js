import { createHmac } from 'crypto';
import path from 'path';

import writeJsonFile from '../shared/writeJsonFile';
import readJsonFile from '../shared/readJsonFile';
import { setStatus } from './activity';

// A session starting another: Claude in one session asks (`paude start`, at the address in its environment), the
// people in that session are asked as Claude's own questions are, and on a yes paude starts the new one as the
// owner's. Which session started which is kept, so each can find the other afterwards and the new one is told where
// it came from.

// A session's own token for asking: only paude, holding the secret, can make it, and it names that one session
export const startToken = (secret, sessionId) =>
	createHmac('sha256', secret).update(`start\n${sessionId}`).digest('base64url').slice(0, 32);

let file;
// { [new session]: { from, fromTitle, fromProject, by, at } }
let lineage = {};

export const initSessionStarts = async dataDir => {
	file = path.join(dataDir, 'session-starts.json');
	lineage = await readJsonFile(file, {});
};

export const startedFrom = id => lineage[id] ?? null;

export const startedBy = id =>
	Object.entries(lineage)
		.filter(([, started]) => started.from === id)
		.map(([started, { at }]) => ({ id: started, at }));

export const recordStart = async (id, { from, fromTitle, fromProject, by }) => {
	lineage[id] = { from, fromTitle, fromProject, by, at: new Date().toISOString() };
	await writeJsonFile(file, () => lineage);
};

// Deleted, a session is no one's to find: its own line goes, and the lines of those it started keep its id, which
// then finds nothing
export const forgetStart = async id => {
	if (!lineage[id]) return;
	delete lineage[id];
	await writeJsonFile(file, () => lineage);
};

// What a session started by another is told, every time Claude starts in it
export const originPrompt = id => {
	const started = lineage[id];

	if (!started) return '';

	return [
		`This session was started from another paude session, at that session's request: "${started.fromTitle || 'untitled'}" (${started.from}, in ${started.fromProject}), on ${started.by}'s yes there.`,
		'`paude lineage` shows that session and any this one starts: their status, their transcripts to read, and their pages. paude passes no messages between sessions: what the other needs to know goes in the work itself (a commit, a file, the reply here), where it can be read.',
	].join(' ');
};

export const ANSWERS = { yes: '1', no: '2' };

// One request at a time per session: { asking, request, settle }
const pending = new Map();

const askingOf = ({ project, prompt, worktree, model }) => ({
	paude: 'start',
	title: 'paude',
	details: [
		`In ${project}${worktree ? `, in a new worktree, ${worktree}` : ''}${model ? `, on ${model}` : ''}:`,
		...prompt.split('\n').slice(0, 12),
	],
	question: `Start a new session in ${project}, as this session asks?`,
	options: [
		{ key: ANSWERS.yes, label: 'Yes, start it', detail: '' },
		{ key: ANSWERS.no, label: "No, don't", detail: '' },
	],
});

// The question asked in the session while a request waits; null when none does
export const startAsking = id => pending.get(id)?.asking ?? null;

// Resolves to { by } on a yes, { declined: true, by } on a no, or { withdrawn: true } when the asker goes. A second
// request while one waits is refused rather than queued: the first is still being looked at.
export const askToStart = (id, request) => {
	if (pending.has(id)) return Promise.resolve({ busy: true });

	return new Promise(resolve => {
		pending.set(id, { asking: askingOf(request), request, settle: resolve });
		setStatus(id, 'waiting');
	});
};

const settle = (id, outcome) => {
	const waiting = pending.get(id);

	if (!waiting) return false;
	pending.delete(id);
	// Claude's command is still running, now with its answer
	setStatus(id, 'working');
	waiting.settle(outcome);

	return true;
};

// An answer from someone in the session, named as they're shown there; false when that isn't what's asked now
export const answerStart = (id, question, key, by) => {
	const waiting = pending.get(id);

	if (!waiting || waiting.asking.question !== question || !Object.values(ANSWERS).includes(key)) return false;

	return settle(id, key === ANSWERS.yes ? { by } : { declined: true, by });
};

export const withdrawStart = id => settle(id, { withdrawn: true });
