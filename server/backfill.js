import path from 'path';

import { claudeWrites } from './commitMessage';
import { concernFiles, fileReasoning, gitStack } from './git';
import { jsonIn } from './haiku';

// What a session settled that nothing wrote down, filed into the message of the open commit it shaped: the commit
// keeps the why for as long as the code is there, past the transcript and past this server's memory of it. A decision
// goes to the concern (an open commit, with what folds into it) whose files its turn changed; Claude rewrites that
// concern's whole message with what explains the change, and what it can't settle from the conversation it asks the
// person instead of guessing.

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
	if (answer.message && answer.message !== message) await file(root, concern.hash, answer.message);

	return decisions.map((decision, index) => {
		const number = String(index + 1);

		if (answer.says.has(number)) return { into: concern.hash, place: concern.short };
		if (answer.ask[number]) return { into: concern.hash, question: answer.ask[number].trim() };

		return { into: concern.hash };
	});
};
