import path from 'path';

import { claudeWrites } from './commitMessage';
import {
	commitAfter,
	commitOf,
	concernFiles,
	explainedHash,
	explainsLine,
	fileExplanation,
	fileReasoning,
	gitStack,
} from './git';
import { jsonIn } from './haiku';

// What a session settled that nothing wrote down, filed into the history of the commit it shaped: the history keeps
// the why for as long as the code is there, past the transcript and past this server's memory of it. A decision goes
// to the commit its turn made (as turnCommits.js links them), else to the one its files say. Still open, Claude rewrites
// that concern's whole message with what explains the change; pushed, its message is final, and what explains it goes
// in a commit of its own that names it. What Claude can't settle from the conversation it asks the person instead of
// guessing.

// The files, as git names them from the top, that a turn and the one after it changed: what Claude proposes is
// settled by the person's reply and built in the turn after
export const changedFiles = (turns, turnId, { cwd, root }) => {
	const at = turns.findIndex(turn => turn.id === turnId);
	const changed = turns
		.slice(at, at === -1 ? 0 : at + 2)
		.flatMap(turn => turn.steps.filter(step => step.edits && step.file))
		.map(step => path.relative(root, path.resolve(cwd, step.file)));

	return [...new Set(changed.filter(file => !file.startsWith('..')))];
};

// The open concern a turn's changes went into, of those sharing its files (null when none does): one opened at the turn
// or after it, since a concern opens with its first change, the oldest of those on a tie; failing that, the newest
// opened before it, which the turn amended. Of either, the one sharing the most files.
export const concernFor = (concerns, files, at) => {
	const wanted = new Set(files);
	const sharing = concerns
		.map(concern => ({ concern, shared: concern.files.filter(file => wanted.has(file)).length }))
		.filter(({ shared }) => shared);
	const after = sharing.filter(({ concern }) => !at || !concern.authored || concern.authored >= at);
	const [best] = (after.length ? after.toReversed() : sharing).toSorted((a, b) => b.shared - a.shared);

	return best?.concern ?? null;
};

// Where a decision is filed: { concern } (open) or { commit } (pushed); null when nothing it changed is in a commit.
// `linked` are the commits its turn and the next made; of those, the one sharing the most of its files.
export const targetFor = async (root, { files, linked = [], concerns, at }) => {
	const inStack = hash => concerns.find(open => open.hash === hash || open.folds.some(fold => fold.hash === hash));
	const concern = !linked.length && concernFor(concerns, files, at);

	if (concern) return { concern };

	const hash = linked.length ? await mostShared(root, linked, files, inStack) : await commitAfter(root, files, at);

	if (!hash) return null;

	return inStack(hash) ? { concern: inStack(hash) } : { commit: await commitOf(root, hash) };
};

// Of these commits, the one sharing the most of the files, the first on a tie
const mostShared = async (root, hashes, files, inStack) => {
	const wanted = new Set(files);
	const scored = await Promise.all(
		hashes.map(async hash => ({
			hash,
			shared: (inStack(hash)?.files ?? (await commitOf(root, hash)).files).filter(file => wanted.has(file)).length,
		})),
	);

	return scored.toSorted((a, b) => b.shared - a.shared)[0].hash;
};

const decisionText = (decision, index) =>
	[
		`${index + 1}. ${{ decision: 'Decided', direction: 'Direction' }[decision.kind] ?? 'Settled'}: ${decision.chose}`,
		decision.rejected && `   Rejected: ${decision.rejected}`,
		decision.because && `   Because: ${decision.because}`,
		decision.question && `   You asked the person: ${decision.question}`,
		decision.answer && `   They answered: ${decision.answer}`,
	]
		.filter(Boolean)
		.join('\n');

export const backfillPrompt = ({ message, files, decisions }) =>
	[
		'Below is the message of a git commit not pushed yet, the files it changes, and what was settled in the conversation that made it. Write the whole message anew: keep what it says that still holds, and add what was settled that explains this change, as plain sentences of what was chosen, what was rejected, and why.',
		'Leave out what does not explain this change. Never guess: when one would explain it but the conversation leaves unclear which way was taken, whether it still holds, or why, ask the person one short question about it instead of writing it in. Write only what the conversation or the answer says: a reason only when one was given, never one of your own.',
		'Keep the subject unless it is now wrong. The body is read later, from blame, by someone who was never in the conversation: say what the code does and why, not how the conversation went. No "you asked", no "then we tried", never "the user", no lists.',
		'Reply with only a JSON object: {"message": the whole new message, or "" when it stays as it is; "says": the numbers the message holds now, whether it held them already or you added them; "ask": {number: question} for those you need the person for}. Like {"message": "", "says": [1], "ask": {"2": "…"}}.',
		`The message now:\n${message}`,
		`The files it changes:\n${files.join('\n')}`,
		`What was settled:\n${decisions.map(decisionText).join('\n')}`,
	].join('\n\n');

export const explainPrompt = ({ message, files, decisions }) =>
	[
		"Below is the message of a git commit already pushed, so its message can't change any more, the files it changes, and what was settled in the conversation that made it. Write the message of a new commit, which changes no code, recording what was settled that explains that change, as plain sentences of what was chosen, what was rejected, and why. Its subject says what it records, in the form of the pushed commit's subject.",
		'Leave out what does not explain that change, and what its message already says. Never guess: when one would explain it but the conversation leaves unclear which way was taken, whether it still holds, or why, ask the person one short question about it instead of writing it in. Write only what the conversation or the answer says: a reason only when one was given, never one of your own.',
		'It is read later, from the pushed commit, by someone who was never in the conversation: say what the code does and why, not how the conversation went. No "you asked", no "then we tried", never "the user", no lists.',
		'Reply with only a JSON object: {"message": the new commit\'s message, or "" when nothing is left to record; "says": the numbers the pushed message or yours holds; "ask": {number: question} for those you need the person for}. Like {"message": "", "says": [1], "ask": {"2": "…"}}.',
		`The pushed commit's message:\n${message}`,
		`The files it changes:\n${files.join('\n')}`,
		`What was settled:\n${decisions.map(decisionText).join('\n')}`,
	].join('\n\n');

// Claude's reply as { message, says: Set of numbers, ask: { [number]: question } }; null for no reply at all
export const parseBackfill = reply => {
	const json = jsonIn(reply);

	if (!json) return null;

	return {
		message: typeof json.message === 'string' ? json.message.trim() : '',
		says: new Set((Array.isArray(json.says) ? json.says : []).map(String)),
		ask: Object.fromEntries(
			Object.entries(json.ask && typeof json.ask === 'object' ? json.ask : {}).filter(
				([, question]) => typeof question === 'string' && question.trim(),
			),
		),
	};
};

// The open stack with each concern's files: [{ hash, short, subject, body, folds, files }]
export const openConcerns = async root =>
	Promise.all(
		(await gitStack(root)).concerns.map(async concern => ({ ...concern, files: await concernFiles(root, concern) })),
	);

// One concern's decisions filed into its message, each resolving to { into, place } (its message says it, or now
// does), { into, question } (the person is asked) or { into } (it doesn't explain this change)
export const fileInto = async (root, concern, decisions, { ask = claudeWrites, file = fileReasoning } = {}) => {
	const message = [concern.subject, concern.body].filter(Boolean).join('\n\n');
	const answer = parseBackfill(await ask(backfillPrompt({ message, files: concern.files, decisions })));

	if (!answer) throw new Error('No answer from Claude');

	// A concern explaining a pushed commit keeps naming it, whatever Claude wrote
	const explains = explainedHash(concern.body);
	const rewritten =
		explains && answer.message && !explainedHash(answer.message)
			? `${answer.message}\n\n${explainsLine(explains)}`
			: answer.message;

	if (rewritten && rewritten !== message) await file(root, concern.hash, rewritten);

	return outcomes(decisions, answer, concern.hash, concern.short);
};

const outcomes = (decisions, answer, into, place) =>
	decisions.map((decision, index) => {
		const number = String(index + 1);

		if (answer.says.has(number)) return { into, place };
		if (answer.ask[number]) return { into, question: answer.ask[number].trim() };

		return { into };
	});

// A pushed commit's decisions, recorded in a commit of their own that names it; resolving as fileInto's do, a place
// being the new commit, or the pushed one when its message said it already
export const explainInto = async (root, commit, decisions, { ask = claudeWrites, file = fileExplanation } = {}) => {
	const message = [commit.subject, commit.body].filter(Boolean).join('\n\n');
	const answer = parseBackfill(await ask(explainPrompt({ message, files: commit.files, decisions })));

	if (!answer) throw new Error('No answer from Claude');

	const filed = answer.message ? await file(root, commit.hash, answer.message) : null;

	return outcomes(decisions, answer, commit.hash, filed ? filed.slice(0, commit.short.length) : commit.short);
};
