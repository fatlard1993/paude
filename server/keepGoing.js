import askHaiku, { jsonIn } from './haiku';
import { waitingToAsk } from './claudeInbox';
import { noteCrew } from './crew';
import { sessionDecisions } from './decisions';
import { goingOn, isNudge, nudgeWith, typeWhenIdle } from './keepWarm';
import { runningSession } from './sessions/running';
import { sessionTurns } from './timeline';

// A session that keeps going doesn't stop doing something while there's anything useful left that needs nothing from
// the person: after each turn Haiku names what Claude should do next, the goal's next step or something useful toward
// it, and paude types that in. It waits only when everything useful left needs them. It's kept warm too, and stops with
// it: hours from the person's last real prompt, which a nudge doesn't move.

// Nudges in a row before it waits for the person, whatever Haiku says: what an unattended run may spend
export const MOST_NUDGES = 50;
// Nudged turns in a row where Claude did next to nothing (at most SLIGHT tools): it has said there's nothing left, and
// asking again only rereads the whole conversation from the cache
export const MOST_IDLE = 2;
const SLIGHT = 2;
// What Claude ended each earlier turn of the run with, as Haiku is shown it
const RUN_SHOWN = 6;
const RUN_CHARACTERS = 500;
const REPLY_CHARACTERS = 4000;
const ASKED_CHARACTERS = 1500;
// What the session settled, as Haiku is shown it, newest first
const SETTLED_SHOWN = 12;
const SETTLED_CHARACTERS = 300;

const KEEP_WARM_PING = /^keep-?warm ping/i;

const theirs = turn => !isNudge(turn.prompt) && !KEEP_WARM_PING.test(turn.prompt) && !turn.summary;

// Newest last, as sessionTurns has them: the person's last turn, then everything since
const sinceTheirs = turns => turns.slice(Math.max(0, turns.findLastIndex(theirs)));

const nudgedRun = turns => sinceTheirs(turns).filter(turn => isNudge(turn.prompt));

// Why it waits for the person before asking Haiku, or null when it may go on
export const holdBefore = turns => {
	const run = nudgedRun(turns);

	if (run.length >= MOST_NUDGES) return `${MOST_NUDGES} nudges in a row`;

	let idle = 0;

	while (idle < run.length && run.at(-1 - idle).steps.length <= SLIGHT) idle += 1;

	return idle >= MOST_IDLE ? `${MOST_IDLE} nudged turns in a row did next to nothing` : null;
};

const ASKED_PROMPTS = 4;

// What the person last asked for, oldest first: the goal, and how they've been steering toward it
const lastAsked = turns =>
	turns
		.filter(theirs)
		.slice(-ASKED_PROMPTS)
		.map(turn => turn.asked);

// What Claude ended each turn since the person's last prompt with, before the one just ended: without it Haiku sees
// only the latest reply, and sends Claude back to check what an earlier turn already did
const runSoFar = turns =>
	sinceTheirs(turns)
		.slice(0, -1)
		.filter(turn => turn.said)
		.slice(-RUN_SHOWN)
		.map(turn => turn.said.slice(-RUN_CHARACTERS));

const SAID_AS = { decision: 'Decided', direction: 'Direction', deferred: 'Put off', finding: 'Found' };

// What the session settled that still stands (not set aside by the person), newest first: work put off is work left,
// and each decision and direction is something the work can be checked against. One waiting on the person's answer is
// shown as theirs, so the way forward goes around it rather than through it.
export const settledSoFar = decisions => {
	const open = decisions.filter(decision => !decision.dismissed);
	const first = decision => decision.question || decision.kind === 'deferred';
	const shown = new Set([...open.filter(first), ...open.filter(decision => !first(decision))].slice(0, SETTLED_SHOWN));

	return open
		.filter(decision => shown.has(decision))
		.map(decision =>
			(decision.question
				? `Waiting on the person: ${decision.question} (about: ${decision.chose})`
				: [
						`${SAID_AS[decision.kind] ?? 'Decided'}: ${decision.chose}`,
						decision.rejected && `Rejected: ${decision.rejected}`,
					]
						.filter(Boolean)
						.join(' ')
			).slice(0, SETTLED_CHARACTERS),
		);
};

export const promptFor = (reply, asked, earlier = [], settled = []) =>
	[
		'A person is away from a Claude Code session and wants it to keep working toward their goal the whole time they are gone, never sitting idle while anything useful is left to do. Claude just ended a turn. Say what Claude should do next.',
		'',
		'Pick, in this order:',
		"0. Anything the person's last message asked for that neither the latest reply nor the earlier ones show done: a message asking for several things is often answered for only some of them.",
		'1. The next step toward the goal: what the reply names as left or offers to do next ("I\'d take those next", "a good next step if you want it" count as accepted), rough edges it noticed in its own work, work the session put off that nothing since shows done (unless it was put off until the person says), or the plain next step of the plan.',
		'2. If that step waits on the person (a question to them, a choice between real alternatives, a credential, a restart only they can do), or on background work Claude started, then work that is useful toward the goal and does not depend on it: another part of the goal, or the parts of the open choice that are the same either way.',
		'3. If the goal looks done, something that makes it better done: check it end to end the way the person will use it, check it holds to what the session decided (each decision and direction kept, nothing it rejected crept back in), cover edge cases and failure paths, review the change as a stranger would, look for the same fault elsewhere, tighten what it touched.',
		'',
		"Say go false only when nothing useful is left that needs nothing from the person: every way forward needs their answer, their credentials, or an action that reaches past this machine or can't be undone (a push, a deploy, a release, posting, deleting data, running anything against other machines, services or people); or Claude is stuck, failing the same way again after trying; or it cannot work at all (a broken environment, out of usage). Never send Claude to push, deploy, release, post, delete, run anything that reaches other machines, services or people (a dry run or a local test is fine), or decide a question of taste or priorities on the person's behalf.",
		'',
		'What the person last asked for, oldest first:',
		...asked.map(text => `<asked>\n${text.slice(0, ASKED_CHARACTERS)}\n</asked>`),
		'',
		...(settled.length
			? [
					'What the session settled earlier, newest first. A question waiting on the person is theirs: never answer it or decide it for them.',
					...settled.map(text => `<settled>\n${text}\n</settled>`),
					'',
				]
			: []),
		...(earlier.length
			? [
					"How Claude ended its earlier turns since the person's last message, oldest first. Don't send Claude back to do or check what these already did; if every way forward left is something they already did or declined, say go false.",
					...earlier.map(text => `<earlier>\n${text}\n</earlier>`),
					'',
				]
			: []),
		"Claude's latest reply (its end, if long):",
		'<reply>',
		reply.slice(-REPLY_CHARACTERS),
		'</reply>',
		'',
		'Reply with only a JSON object: {"go": true or false, "next": "what Claude should do next, one or two sentences spoken to Claude, specific to this work", "why": "one plain sentence"}.',
	].join('\n');

// After a turn ends in a session that keeps going: told what to do next unless Haiku finds nothing useful left that
// doesn't need the person. Without an answer from Haiku it's still told to carry on toward the goal. Typed in only
// while Claude sits idle with an empty prompt box and nobody's message waiting to go in (whoever came back and started
// typing has the session). Whether it was.
export const keepGoing = async (
	id,
	reply,
	{
		ask = text => askHaiku(text, 'deciding to keep going'),
		sessionOf = runningSession,
		turnsOf = sessionTurns,
		decisionsOf = (sessionId, cwd) => sessionDecisions(sessionId, cwd, { onlyRead: true, whole: true }),
	} = {},
) => {
	const session = sessionOf(id);

	if (!goingOn(id) || !session || !reply?.trim()) return false;

	const turns = await turnsOf(id, session.cwd);
	const hold = holdBefore(turns);

	if (hold) {
		console.log(`Keep going ${id}: waiting for the person, ${hold}`);

		return false;
	}

	const { decisions } = await decisionsOf(id, session.cwd).catch(() => ({ decisions: [] }));
	const verdict = jsonIn(await ask(promptFor(reply, lastAsked(turns), runSoFar(turns), settledSoFar(decisions))));
	const go = verdict?.go !== false;

	console.log(
		`Keep going ${id}: ${go ? `on, ${verdict?.next ?? 'toward the goal'}` : 'waiting'} (${verdict ? (verdict.why ?? 'no reason given') : 'no answer from Haiku'})`,
	);
	// Asking takes seconds: switched off, ended, or taken up by someone meanwhile
	if (
		!go ||
		!goingOn(id) ||
		sessionOf(id) !== session ||
		waitingToAsk(id) ||
		!typeWhenIdle(id, session, nudgeWith(typeof verdict?.next === 'string' ? verdict.next : ''))
	)
		return false;
	noteCrew('keeping a session going');

	return true;
};
