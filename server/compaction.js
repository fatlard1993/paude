import { HANDOVER_TURNS, askMonitor as askFabledMonitor, handoverFor, repoStateOf, usageWords } from './fabled';
import { sessionDecisions } from './decisions';
import { settledIn } from './keepGoing';
import { fabledOn, monitorOf } from './keepWarm';
import { runningSession } from './sessions/running';
import { sessionTurns } from './timeline';

// What paude adds as Claude Code compacts a session's context: notes for the summary, from what the session settled,
// and for a fabled session a handover from its monitor, which never compacts, given to Claude as it carries on.

const sessionDeps = {
	sessionOf: runningSession,
	turnsOf: (sessionId, cwd) => sessionTurns(sessionId, cwd, { whole: true }),
	decisionsOf: (sessionId, cwd) => sessionDecisions(sessionId, cwd, { onlyRead: true, whole: true }),
};

// Claude Code takes what a PreCompact hook prints as instructions for its summary, cut at this
const NOTES_CHARACTERS = 10_000;

// What the summary is asked to keep: what a summary loses first, and what this session settled as paude recorded it
// (decisions with what they rejected, work put off, questions waiting on the person), read from what paude already
// holds, since Claude waits on it to compact. '' for a session paude isn't running.
export const summaryNotes = async (id, { sessionOf, turnsOf, decisionsOf } = sessionDeps) => {
	const session = sessionOf(id);

	if (!session) return '';

	const turns = await turnsOf(id, session.cwd).catch(() => []);
	const settled = await settledIn(id, session.cwd, turns, decisionsOf);

	return [
		"Notes from paude for this summary. Keep, in the person's own words where they matter: each correction and redirection they gave and what they turned down; each decision with the alternative rejected and why; approaches that failed, so they aren't tried again; work promised or put off and not yet done; and any question waiting on the person, as theirs to answer.",
		...(settled.length
			? ['', 'What this session settled, as paude recorded it, newest first:', ...settled.map(line => `- ${line}`)]
			: []),
	]
		.join('\n')
		.slice(0, NOTES_CHARACTERS);
};

// The handover each fabled session's monitor is writing as Claude's context compacts, until the resumed Claude takes it
const handovers = new Map();

// Claude Code is about to compact a fabled session's context (its PreCompact hook): the monitor, which has followed the
// run whole and never compacts, writes the resumed Claude a handover, while compacting takes its half a minute or more.
// Only a monitor that has looked at the session has anything to hand over. Neither who the monitor has seen nor its
// misses move: a handover is no verdict, and the turn in hand is told at its end as any other. Whether one was begun.
export const beginHandover = async (
	id,
	{ custom_instructions: focus } = {},
	{
		askMonitor = askFabledMonitor,
		repoOf = repoStateOf,
		sessionOf = sessionDeps.sessionOf,
		turnsOf = sessionDeps.turnsOf,
		decisionsOf = sessionDeps.decisionsOf,
	} = {},
) => {
	const session = sessionOf(id);
	const { monitor, seen } = monitorOf(id) ?? {};

	if (!session || !fabledOn(id) || !monitor || !seen) return false;

	const written = (async () => {
		const [turns, repo] = await Promise.all([turnsOf(id, session.cwd), repoOf(session.cwd)]);
		const settled = await settledIn(id, session.cwd, turns, decisionsOf);
		const prompt = handoverFor({ settled, repo, focus: typeof focus === 'string' ? focus.trim() : '' });
		const { answer, usage, why } = await askMonitor(monitor, session.cwd, prompt, {
			turns: HANDOVER_TURNS,
			job: 'handing over a compacted session',
		});

		console.log(
			`Keep fabled ${id}: ${answer ? 'handover written' : `no handover (${why})`}${usage ? `: ${usageWords(usage)}` : ''}`,
		);

		return answer.trim();
	})().catch(error => {
		console.error('Writing a handover failed:', error);

		return '';
	});

	handovers.set(id, written);

	return true;
};

// The handover for a session whose context was just compacted (its SessionStart hook, from compacting), waited for at
// most `waitMs` since Claude waits on it to carry on; '' for none. Taken once: a later compaction gets its own.
export const takeHandover = async (id, waitMs) => {
	const written = handovers.get(id);

	if (!written) return '';
	handovers.delete(id);

	let timer;
	const late = new Promise(resolve => {
		timer = setTimeout(() => resolve(null), waitMs);
	});
	const handover = await Promise.race([written, late]);

	clearTimeout(timer);
	if (handover === null)
		console.log(`Keep fabled ${id}: the handover wasn't written in time; Claude carries on without it`);

	return handover ?? '';
};
