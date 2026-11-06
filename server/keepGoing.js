import askHaiku, { jsonIn } from './haiku';
import { statusOf } from './activity';
import { waitingToAsk } from './claudeInbox';
import { noteCrew } from './crew';
import { sessionDecisions } from './decisions';
import {
	MOST_IDLE as FABLED_IDLE,
	MOST_NUDGES as FABLED_NUDGES,
	askMonitor as askFabledMonitor,
	briefFor,
	deltaFor,
	forgetMonitor,
	usageWords,
} from './fabled';
import {
	askingSessions,
	fabledOn,
	goingOn,
	isNudge,
	monitorOf,
	noteAsking,
	noteMonitor,
	nudgeWith,
	typeWhenIdle,
} from './keepWarm';
import { runningSession } from './sessions/running';
import { sessionTurns, startAndEnd } from './timeline';

// A session that keeps going doesn't stop doing something while there's anything useful left that needs nothing from
// the person: after each turn Haiku (or, fabled, the session's own monitor) names what Claude should do next, the goal's next step or something useful toward
// it, and paude types that in. It waits only when everything useful left needs them. It's kept warm too, and stops with
// it: hours from the person's last real prompt, which a nudge doesn't move.

// Nudges in a row before it waits for the person, whatever Haiku says: what an unattended run may spend
export const MOST_NUDGES = 50;
// Nudged turns in a row where Claude did next to nothing (at most SLIGHT tools): it has said there's nothing left, and
// asking again only rereads the whole conversation from the cache
export const MOST_IDLE = 2;
const SLIGHT = 2;
// How many earlier turns Haiku is shown, each by what Claude ended it with (the timeline keeps its start and end)
const RUN_SHOWN = 6;
const REPLY_CHARACTERS = 4000;
const ASKED_CHARACTERS = 1500;
// What the session settled, as Haiku is shown it, newest first
const SETTLED_SHOWN = 12;
const SETTLED_CHARACTERS = 300;
// Claude's title shows it busy until the turn's last Stop hook is done, and paude's is only one of them: Haiku often
// answers before the rest finish, and the title goes idle before the prompt box is drawn back. How long a nudge waits
// for both, and how often it looks
const IDLE_WAIT_MS = 5 * 60_000;
const IDLE_CHECK_MS = 1000;

const KEEP_WARM_PING = /^keep-?warm ping/i;

const theirs = turn => !isNudge(turn.prompt) && !KEEP_WARM_PING.test(turn.prompt) && !turn.summary;
// A turn the person spoke in: prompted it, or added to it while Claude worked, as they do with thoughts as they come
const spoke = turn => theirs(turn) || Boolean(turn.added?.length);

// Newest last, as sessionTurns has them: the last turn the person spoke in, then everything since
const sinceTheirs = turns => turns.slice(Math.max(0, turns.findLastIndex(spoke)));

const nudgedRun = turns => sinceTheirs(turns).filter(turn => isNudge(turn.prompt));

// Why it waits for the person before asking, or null when it may go on; a fabled session has more room
export const holdBefore = (turns, { most = MOST_NUDGES, idle: mostIdle = MOST_IDLE } = {}) => {
	const run = nudgedRun(turns);

	if (run.length >= most) return `${most} nudges in a row`;

	let idle = 0;

	while (idle < run.length && run.at(-1 - idle).steps.length <= SLIGHT) idle += 1;

	return idle >= mostIdle ? `${mostIdle} nudged turns in a row did next to nothing` : null;
};

const FABLED_ROOM = { most: FABLED_NUDGES, idle: FABLED_IDLE };
// Asks in a row that never reached a fabled session's monitor before it's given up as gone, whatever Claude Code said:
// a conversation lost in words the ask doesn't know would otherwise be tried forever
export const MOST_MISSED = 3;

const ASKED_PROMPTS = 4;

// The turns from the last few the person spoke in on: the goal, and how they've been steering toward it
const lately = turns => {
	const asked = turns.flatMap((turn, index) => (spoke(turn) ? [index] : []));

	return turns.slice(asked.at(-ASKED_PROMPTS) ?? asked[0] ?? 0);
};

// What the person last asked for, oldest first: each prompt, then what they added to its turn while Claude worked
const lastAsked = turns =>
	lately(turns).flatMap(turn => [
		...(theirs(turn) ? [turn.asked] : []),
		...(turn.added ?? []).map(added => `(added while Claude worked) ${added}`),
	]);

// How Claude ended the turns before the one just ended, whoever prompted them: without them Haiku sees only the latest
// reply, and sends Claude back to do what an earlier turn already did
const runSoFar = turns =>
	lately(turns)
		.slice(0, -1)
		.filter(turn => turn.said)
		.slice(-RUN_SHOWN)
		.map(turn => `${theirs(turn) ? 'After the person asked' : 'After a nudge'}: ${turn.said}`);

const SAID_AS = { decision: 'Decided', direction: 'Direction', deferred: 'Put off', finding: 'Found' };

// What the session settled lately that still stands (not set aside by the person), newest first: work put off is work
// left, and each decision and direction is something the work can be checked against. Only from the turns given (the
// last few turns the person spoke in on): nothing marks work put off as done once it is, and older put-off work came
// back as suggestions long after it was done. One waiting on the person's answer is shown whenever it was asked, as theirs,
// so the way forward goes around it rather than through it.
export const settledSoFar = (decisions, within = null) => {
	const open = decisions.filter(
		decision => !decision.dismissed && (decision.question || !within || within.has(decision.turnId)),
	);
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
		'0. Anything the person asked for that neither the latest reply nor the earlier ones show done, the oldest first: a message asking for several things is often answered for only some of them, and the person drops thoughts and findings in while Claude works, to be taken up whenever there is time. Each of those is work left until a reply shows it done or the person sets it aside; a thought that only needs their call is a question for them, not work.',
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
					"How Claude ended its earlier turns, oldest first. Don't send Claude back to do or check what these already did: a request or work put off that any of them reports done is done, even when the latest reply doesn't mention it. If every way forward left is something they already did or declined, say go false.",
					...earlier.map(text => `<earlier>\n${text}\n</earlier>`),
					'',
				]
			: []),
		"Claude's latest reply (its start and end, if long):",
		'<reply>',
		startAndEnd(reply, REPLY_CHARACTERS),
		'</reply>',
		'',
		'Reply with only a JSON object: {"go": true or false, "next": "what Claude should do next, one or two sentences spoken to Claude, specific to this work", "why": "one plain sentence"}.',
	].join('\n');

// The turns since the monitor was last told of one, for its delta: each by who prompted it and how it ended; the one it
// was told of gone (compacted away) leaves only the latest
const sinceSeen = (turns, seen) => {
	const at = turns.findIndex(turn => turn.id === seen);
	const since = at === -1 ? turns.slice(-1) : turns.slice(at + 1);

	return since.map((turn, index) => ({
		theirs: theirs(turn),
		asked: turn.asked ?? turn.prompt ?? '',
		added: turn.added,
		said: turn.said,
		steps: turn.steps?.length ?? 0,
		last: index === since.length - 1,
	}));
};

// A fabled session's verdict, from its monitor: briefed on the goal and the run so far at its first look, told what
// happened since at each later one. The monitor has seen up to this turn once the prompt reached its conversation,
// answered or not (a look that ran out of rounds still read the delta); a conversation that can't be carried on is
// forgotten, for a fresh one to be briefed at the next turn end; any other failure keeps it as it was, to try again.
// The verdict's JSON text, or '' for none.
const askFabled = async (id, session, reply, turns, settled, askMonitor) => {
	const { monitor, seen } = monitorOf(id) ?? { monitor: crypto.randomUUID(), seen: null };
	const first = !seen;
	const prompt = first
		? briefFor({ cwd: session.cwd, asked: lastAsked(turns), settled, earlier: runSoFar(turns), reply })
		: deltaFor({ since: sinceSeen(turns, seen), settled, reply });
	const { answer, delivered, resumable, usage, why } = await askMonitor(monitor, session.cwd, prompt, { first });
	const missed = delivered ? 0 : (monitorOf(id)?.missed ?? 0) + 1;

	// Each ask on its own line, so the log says what the monitor cost and what went wrong when it gave no verdict
	if (delivered)
		console.log(
			`Keep fabled ${id}: monitor ${first ? 'briefed' : 'told'}${answer ? '' : `, no verdict (${why})`}: ${usageWords(usage)}`,
		);
	else console.log(`Keep fabled ${id}: the ask never reached the monitor (${why}), ${missed} of ${MOST_MISSED}`);
	if (!resumable || missed >= MOST_MISSED) {
		console.log(
			`Keep fabled ${id}: monitor forgotten, ${resumable ? `${missed} asks in a row never reached it` : why}; a fresh one is briefed at the next turn end`,
		);
		// The record's, and one made for this ask alone, which the record never held
		await noteMonitor(id, { monitor: null });
		await forgetMonitor(monitor);
	} else if (delivered) await noteMonitor(id, { monitor, seen: turns.at(-1)?.id ?? seen });
	else await noteMonitor(id, { monitor, seen, missed });

	return answer;
};

// The latest turn end each session's keep-going is answering
const turnEnds = new Map();

// Why a nudge Haiku asked for didn't go in, or null when nothing stops it now
const keptOut = (id, session, ended, sessionOf) => {
	if (turnEnds.get(id) !== ended) return 'a later turn end answers instead';
	if (!goingOn(id)) return 'switched off meanwhile';
	if (sessionOf(id) !== session) return 'the session ended meanwhile';
	if (waitingToAsk(id)) return 'a message is waiting to go in';

	return null;
};

const FINISHING = 'finishing';

// Why a nudge can't go in now: FINISHING while Claude is still ending its turn (busy, or no prompt box drawn yet),
// why when someone has the session, or null when it can
const notIdle = (id, session) => {
	if (statusOf(id) === 'waiting') return 'Claude is asking something';

	const draft = session.promptDraft();

	if (draft) return 'someone is typing';

	return session.busy || draft === null ? FINISHING : null;
};

// After a turn ends in a session that keeps going: told what to do next unless Haiku (or, fabled, its monitor) finds
// nothing useful left that doesn't need the person. Without an answer it's still told to carry on toward the goal.
// Typed in only once Claude sits idle with an empty prompt box and nobody's message waiting to go in (whoever came
// back and started typing has the session). A turn end another Stop hook turned back isn't the end: Claude answers the
// hook and ends again, and only the later one is answered. Whether it was typed.
export const keepGoing = async (
	id,
	reply,
	{
		ask = text => askHaiku(text, 'deciding to keep going'),
		askMonitor = askFabledMonitor,
		sessionOf = runningSession,
		// Whole: a session heavy with screenshots can hold the person's last prompts far back past the usual tail
		turnsOf = (sessionId, cwd) => sessionTurns(sessionId, cwd, { whole: true }),
		decisionsOf = (sessionId, cwd) => sessionDecisions(sessionId, cwd, { onlyRead: true, whole: true }),
		pause = () => Bun.sleep(IDLE_CHECK_MS),
	} = {},
) => {
	const session = sessionOf(id);
	const ended = (turnEnds.get(id) ?? 0) + 1;

	turnEnds.set(id, ended);
	if (!goingOn(id) || !session || !reply?.trim()) return false;

	const fabled = fabledOn(id);
	const kept = fabled ? 'fabled' : 'going';
	const turns = await turnsOf(id, session.cwd);

	// Answering this turn end, until it's answered: a server that restarts meanwhile takes it up (resumeKeepingGoing)
	await noteAsking(id, turns.at(-1)?.id ?? 'the latest');
	try {
		return await answerTurnEnd(id, session, ended, reply, turns, fabled, kept, {
			ask,
			askMonitor,
			sessionOf,
			decisionsOf,
			pause,
		});
	} finally {
		// Only the latest turn end's answer stands; an earlier one finishing late mustn't mark the latest answered
		if (turnEnds.get(id) === ended) await noteAsking(id, null);
	}
};

const answerTurnEnd = async (
	id,
	session,
	ended,
	reply,
	turns,
	fabled,
	kept,
	{ ask, askMonitor, sessionOf, decisionsOf, pause },
) => {
	const hold = holdBefore(turns, fabled ? FABLED_ROOM : {});

	if (hold) {
		console.log(`Keep ${kept} ${id}: waiting for the person, ${hold}`);

		return false;
	}

	const { decisions } = await decisionsOf(id, session.cwd).catch(() => ({ decisions: [] }));
	const within = new Set(lately(turns).map(turn => turn.id));
	const settled = settledSoFar(decisions, within);
	const verdict = jsonIn(
		fabled
			? await askFabled(id, session, reply, turns, settled, askMonitor)
			: await ask(promptFor(reply, lastAsked(turns), runSoFar(turns), settled)),
	);
	const why = verdict ? (verdict.why ?? 'no reason given') : `no answer from ${fabled ? 'the monitor' : 'Haiku'}`;

	if (verdict?.go === false) {
		console.log(`Keep ${kept} ${id}: waiting (${why})`);

		return false;
	}

	const next = typeof verdict?.next === 'string' ? verdict.next : '';
	// Asking takes seconds: answered by a later turn end, switched off, ended, or taken up by someone meanwhile
	const look = () => keptOut(id, session, ended, sessionOf) ?? notIdle(id, session);
	let out = look();

	for (let waited = 0; out === FINISHING && waited < IDLE_WAIT_MS; waited += IDLE_CHECK_MS) {
		await pause();
		out = look();
	}
	if (out === FINISHING) out = `Claude hadn't finished its turn after ${IDLE_WAIT_MS / 60_000} minutes`;
	if (!out && !typeWhenIdle(id, session, nudgeWith(next, { fabled })))
		out = 'Claude is busy, asking, or someone is typing';

	console.log(`Keep ${kept} ${id}: ${out ? `not sent, ${out}:` : 'on,'} ${next || 'toward the goal'} (${why})`);
	if (out) return false;
	noteCrew('keeping a session going');

	return true;
};

// After a server start: a session whose turn end was being answered when the last server stopped (an ask to Haiku or
// the monitor takes seconds to minutes, and a restart kills it) is answered now, from the reply its transcript holds,
// instead of sitting idle until the keep-warm ping. Those no longer running or kept are let be.
export const resumeKeepingGoing = async ({
	sessionOf = runningSession,
	turnsOf = (sessionId, cwd) => sessionTurns(sessionId, cwd),
	answer = keepGoing,
} = {}) => {
	const resumed = [];

	for (const id of askingSessions()) {
		const session = sessionOf(id);
		const last = session && (await turnsOf(id, session.cwd).catch(() => [])).at(-1);

		if (!last?.said) {
			await noteAsking(id, null);
			continue;
		}
		console.log(`Keep going ${id}: answering the turn end a restart interrupted`);
		resumed.push(id);
		answer(id, last.said).catch(error => console.error('Keeping going after a restart failed:', error));
	}

	return resumed;
};
