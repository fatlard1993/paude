import askHaiku, { jsonIn } from './haiku';
import { waitingToAsk } from './claudeInbox';
import { noteCrew } from './crew';
import { fabledOn, goingOn } from './keepWarm';
import { MOST_NUDGES, fabledVerdict } from './keepGoing';
import { runningSession } from './sessions/running';

// Keeping an arcade going while its people are away. An arcade's turn ends at the question Claude asks, never at an
// idle prompt box, so the keep-going that types a nudge after Claude Code's Stop never gets its chance there. Here the
// question is the turn's end: left a while unanswered, Haiku picks the choice that best carries on toward what they
// asked for, and it's answered for them, marked as paude's pick. The choices are mostly ways to carry on building, so
// keeping house is folded in: every answer asks for it with the change, and every few in a row is a pass of its own.

// Left this long for whoever is there to answer it first
export const ANSWER_AFTER_MS = 60_000;
// Every this many answers in a row, a housekeeping pass instead of another choice
export const HOUSEKEEPING_EVERY = 4;
const LOOK_EVERY_MS = 2000;
const DRAWN_WITHIN_MS = 30_000;
const DESCRIPTION_CHARACTERS = 300;

export const PICKED_MARK = 'Picked by paude while you are away';
const KEEP_HOUSE =
	'Keep house with it: the tests cover what changed and pass, README.md and IDEA.md say what the game is now, you have looked at the page, and nothing is left half done.';
export const HOUSEKEEPING = `${PICKED_MARK}: a housekeeping pass before anything new. Settle what the last few turns left: tests for what they added, the README and IDEA.md current, a look at the page at a phone's size and a computer's, rough edges and anything half done finished, the game's feel checked. Then ask what should happen next, as always.`;

// { [session]: { run, sent } }: answers given in a row, and the words of the last, to know a person's answer from ours
const runs = new Map();

export const pickedWords = option =>
	`${PICKED_MARK}: ${option.label}.${option.description ? ` ${option.description}` : ''} ${KEEP_HOUSE}`;

export const pickPrompt = ({ question, options }) =>
	[
		"A person building something in paude's arcade is away, and wants the building to carry on. Claude has asked them what should happen next. Pick the choice they would most likely make: the one that best carries on what they've been building toward, and that needs nothing from them. Never pick one that undoes their work, spends money, or decides something only they can (a name, a big change of direction).",
		'',
		`Claude asked: ${question}`,
		...options.map(
			(option, index) =>
				`${index + 1}. ${option.label}${option.description ? `: ${option.description.slice(0, DESCRIPTION_CHARACTERS)}` : ''}`,
		),
		'',
		'Reply with only a JSON object: {"pick": the number of the choice, or 0 when none should be picked for them, "why": "one plain sentence"}.',
	].join('\n');

// The question as a fabled session's monitor is asked it: the turn's end, to answer as the player would. It knows the
// whole run (what they loved, typed past and complained of), so it may answer none of the choices.
export const questionForMonitor = ({ question, options }) =>
	[
		`Claude ended its turn in the arcade asking the player: ${question}`,
		...options.map(
			(option, index) =>
				`${index + 1}. ${option.label}${option.description ? `: ${option.description.slice(0, DESCRIPTION_CHARACTERS)}` : ''}`,
		),
		'',
		'The player is away and wants the building to carry on. Answer for them as they would, with the words to answer in "next": one of the choices by its label, or, when none is what they\'d want (a complaint of theirs still standing, a choice passed over again and again, work you found unchecked or half done), what to do instead. Say go false when only they can answer (a name, a big change of direction, anything that spends money).',
	].join('\n');

// A fabled session's answer: its monitor's, or null when it says to wait for them or gives no verdict
const monitorAnswer = async (id, session, asked, verdictOf) => {
	const verdict = await verdictOf(id, session, questionForMonitor(asked)).catch(() => null);
	const next = typeof verdict?.next === 'string' ? verdict.next.trim() : '';

	if (!verdict || verdict.go === false || !next) return null;

	return { words: `${PICKED_MARK}, by its steward: ${next} ${KEEP_HOUSE}`, why: verdict.why ?? 'the monitor said so' };
};

// What to answer: a housekeeping pass when it's due, else the choice Haiku picks (the first when it can't say), or null
// when none should be picked for them
export const answerFor = async (asked, run, ask = prompt => askHaiku(prompt, 'keeping an arcade going')) => {
	if (run > 0 && run % HOUSEKEEPING_EVERY === 0) return { words: HOUSEKEEPING, why: 'housekeeping is due' };

	const verdict = jsonIn(await ask(pickPrompt(asked)).catch(() => ''));
	const pick = Number(verdict?.pick);

	if (verdict && pick === 0) return null;

	const option = asked.options[Number.isInteger(pick) && pick >= 1 ? pick - 1 : 0];

	return option && { words: pickedWords(option), why: verdict?.why ?? 'the first choice, Haiku not saying' };
};

// The question as the AskUserQuestion tool was called with it: its first question and choices
const askedOf = input => {
	const first = input?.questions?.[0];

	return first?.question
		? {
				question: first.question,
				options: (first.options ?? []).map(({ label, description }) => ({ label, description })),
			}
		: null;
};

// Called as Claude asks: answered for them once it has waited unanswered, while the session keeps going. Whether it was.
export const keepArcadeGoing = async (
	id,
	input,
	{
		sessionOf = runningSession,
		ask,
		verdictOf = fabledVerdict,
		pause = () => Bun.sleep(LOOK_EVERY_MS),
		waitMs = ANSWER_AFTER_MS,
	} = {},
) => {
	const asked = askedOf(input);

	if (!asked || !goingOn(id)) return false;

	const run = runs.get(id)?.run ?? 0;

	if (run >= MOST_NUDGES) {
		console.log(`Keep going ${id}: the arcade waits for its people, ${MOST_NUDGES} answers in a row`);

		return false;
	}

	// Drawn (the hook comes just before the dialog is), then still up after the wait: anyone there has had their chance
	const session = sessionOf(id);
	const showing = () => sessionOf(id) === session && session?.asking()?.question === asked.question;
	let waited = 0;

	for (; !showing() && waited < DRAWN_WITHIN_MS; waited += LOOK_EVERY_MS) await pause();
	for (waited = 0; showing() && waited < waitMs; waited += LOOK_EVERY_MS) await pause();
	if (!goingOn(id) || !showing() || waitingToAsk(id)) return false;

	// Fabled, its monitor answers, and keeps house in the quiet itself (steward.js) rather than every few answers
	const answer = fabledOn(id) ? await monitorAnswer(id, session, asked, verdictOf) : await answerFor(asked, run, ask);

	if (!answer) {
		console.log(`Keep going ${id}: none of the arcade's choices is one to pick for them`);

		return false;
	}

	const dialog = session.asking();

	if (dialog?.question !== asked.question || !dialog.typing) return false;
	if (!session.answer(dialog.question, dialog.typing, answer.words)) return false;

	runs.set(id, { run: run + 1, sent: answer.words });
	noteCrew('keeping a session going');
	console.log(`Keep going ${id}: answered the arcade's question (${answer.why})`);

	return true;
};

// An answer to an arcade question came back: one that isn't ours is a person's, and the run starts over
export const noteArcadeAnswer = (id, response) => {
	const answers = Object.values(response?.answers ?? {});
	const ours = runs.get(id)?.sent;

	if (!ours || !answers.some(answer => String(answer).trim() === ours.trim())) runs.delete(id);
};
