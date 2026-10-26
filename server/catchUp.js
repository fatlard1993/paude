import { jsonIn } from './haiku';
import { transcriptFile } from './sessions/transcript';
import { TAIL_BYTES, lastLines, timelineFrom } from './timeline';
import { tellOnce } from './tours';
import { verification } from './verification';

// Catching someone up on a session: the turns since they last looked (or the latest few), told by Haiku as a short
// overview and a stop per turn, for a tour through the scrollback. One kind of tour (see tours.js): asked only when
// someone asks, and told once for everyone shown the same turns.
const RECENT_TURNS = 10;
const MOST_TURNS = 25;
const SAID_IN_PROMPT = 400;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// What a turn did, in a line: the files it changed, the commands it ran, what else it used
export const didOf = steps => {
	const edited = [...new Set(steps.filter(step => step.edits).map(step => step.file))];
	const commands = steps.filter(step => step.tool === 'Bash');
	const reads = steps.filter(step => step.tool === 'Read').length;
	const declined = steps.filter(step => step.declined);
	const failed = steps.filter(step => step.ok === false && !step.declined).length;

	return [
		edited.length &&
			`changed ${edited.slice(0, 6).join(', ')}${edited.length > 6 ? ` and ${edited.length - 6} more` : ''}`,
		commands.length &&
			`ran ${plural(commands.length, 'command')} (${commands
				.slice(0, 3)
				.map(step => step.summary)
				.join('; ')})`,
		reads && `read ${plural(reads, 'file')}`,
		failed && `${plural(failed, 'step')} failed`,
		declined.length &&
			`the person turned down ${declined
				.slice(0, 3)
				.map(step => `${step.tool} ${step.summary ?? ''}`.trim())
				.join('; ')}`,
	]
		.filter(Boolean)
		.join('; ');
};

// What a turn settled, in a line: the decision, the direction, the work put off or what was found, what it was chosen
// over, and why
const SETTLED_AS = { decision: 'Decided', direction: 'Direction set', deferred: 'Put off', finding: 'Found' };
export const settledLine = ({ kind, chose, rejected, because }) =>
	`${SETTLED_AS[kind] ?? 'Settled'}: ${chose}${rejected ? ` Not: ${rejected}` : ''}${because ? ` Because: ${because}` : ''}`;

// `waiting`: what's left for the person: the questions about where something settled is written down, and the design
// documents' claims it overrules
export const tourPrompt = (turns, { waiting = [] } = {}) =>
	[
		'You are catching someone up on a coding session between a person and Claude, a coding assistant.',
		'Write an overview of 2 or 3 sentences: where things stand now, and anything left waiting on them. Then one stop per turn: 1 or 2 sentences on what was asked and what came of it.',
		'Where a turn settled something (a decision, a direction, work put off, something found out), say what and why in its stop: what was settled outlasts what was done.',
		'Plain words, past tense, no markdown, no filler, no praise. The reader may not be who asked: never say "you"; start a stop with what was asked, like "Asked for a smaller icon; Claude…".',
		'Where the person stopped Claude partway, redirected it, or turned down a step, say so plainly in that stop: those are where they steered, and they matter most to someone catching up.',
		'Reply with only a JSON object: {"overview": "…", "stops": {"1": "…", "2": "…"}}, one stop for each numbered turn.',
		turns
			.map((turn, index) =>
				[
					`Turn ${index + 1}, ${turn.at}`,
					`  Asked: ${turn.prompt}`,
					turn.redirect && '  This redirected the turn before, which the person had stopped.',
					turn.stopped && '  The person stopped Claude partway through this.',
					turn.steps.length && `  Did: ${didOf(turn.steps)}`,
					turn.said && `  Claude ended with: ${turn.said.slice(-SAID_IN_PROMPT)}`,
					...(turn.settled ?? []).map(decision => `  ${settledLine(decision)}`),
				]
					.filter(Boolean)
					.join('\n'),
			)
			.join('\n\n'),
		waiting.length &&
			`Waiting on the person, about writing down what was settled:\n${waiting.map(question => `- ${question}`).join('\n')}`,
	]
		.filter(Boolean)
		.join('\n\n');

// How the person steered a turn, if they did: stopped it, redirected it, turned down a step in it
export const steeringOf = turn =>
	[
		turn.stopped && 'stopped partway',
		turn.redirect && 'redirected',
		turn.steps?.some(step => step.declined) && 'a step turned down',
	].filter(Boolean);

// Each turn marked where the person interrupted: the one they stopped, and the one that followed it (the
// interruptions themselves are markers in the transcript, not turns)
export const markInterruptions = turns =>
	turns.map((turn, index) => ({
		...turn,
		stopped: Boolean(turns[index + 1]?.interrupted),
		redirect: Boolean(turns[index - 1]?.interrupted),
	}));

// The tour from Haiku's reply, each stop placed on its turn; null when the reply holds none
export const parseTour = (reply, turns) => {
	const json = jsonIn(reply);

	if (typeof json?.overview !== 'string' || !json.stops) return null;

	return {
		overview: json.overview.trim(),
		stops: turns.map((turn, index) => ({
			turnId: turn.id,
			prompt: turn.prompt,
			at: turn.at,
			text: String(json.stops[String(index + 1)] ?? '').trim() || turn.prompt,
			...(steeringOf(turn).length && { steered: steeringOf(turn) }),
		})),
	};
};

// Not a keep-warm ping (paude's, or the keep-warm command's), not cut short, and not the same prompt as the turn
// after it (sent again)
const KEEP_WARM_PING = /^keep-?warm ping/i;
const worthTelling = (turn, index, turns) =>
	!turn.interrupted && !KEEP_WARM_PING.test(turn.prompt) && turn.prompt !== turns[index + 1]?.prompt;

// What happened that the tour doesn't tell, so a short tour isn't taken for the whole story: prompts sent again, the
// earliest turns past what one tour holds, and anything older than the end of the transcript it reads. (A turn the
// person stopped is told, and marked so.)
// `read` is every turn read since they looked (or all of them, without a since); `told`, those worth a stop;
// `reachesBack`, whether what was read goes back as far as since.
export const leftOutOf = ({ read, told, picked, since, reachesBack }) => {
	const again = read.filter((turn, index) => !turn.interrupted && turn.prompt === read[index + 1]?.prompt).length;
	const earlier = since ? told.length - picked.length : 0;

	return [
		earlier &&
			`The ${plural(earlier, 'earliest turn')} since then ${earlier === 1 ? "isn't" : "aren't"} in it; Activity has every turn.`,
		again && `${plural(again, 'prompt')} sent again ${again === 1 ? 'is' : 'are'} told once.`,
		since && !reachesBack && 'It reads only the latest part of a long session, so anything before that is missing.',
	].filter(Boolean);
};

// What the session settled that waits on the person: the questions filing it asked, and the design documents' claims
// it overrules
export const waitingOf = decisions =>
	decisions.flatMap(decision =>
		[
			decision.question,
			decision.overrules &&
				`"${decision.chose}" overrules what ${decision.overrules.file} still claims: "${decision.overrules.claim}"`,
		].filter(Boolean),
	);

// since: a time (ms); without it, the latest turns. decisions: what the session settled (decisions.js), told with
// the turns that settled them, and the questions about them still waiting
export const catchUp = async (id, cwd, { since, decisions = [] } = {}) => {
	const file = await transcriptFile(id, cwd);
	const all = file ? markInterruptions(timelineFrom(await lastLines(file), cwd)) : [];
	const read = since ? all.filter(turn => Date.parse(turn.at) > since) : all;
	const told = read.filter(worthTelling);
	const picked = (since ? told : told.slice(-RECENT_TURNS)).slice(-MOST_TURNS);
	const leftOut = leftOutOf({
		read,
		told,
		picked,
		since,
		reachesBack: !file || file.size <= TAIL_BYTES || Boolean(all[0] && Date.parse(all[0].at) <= since),
	});

	if (!picked.length) return { overview: 'Nothing has happened here since you last looked.', stops: [], leftOut };

	const settled = turn => decisions.filter(decision => decision.turnId === turn.id);
	const waiting = waitingOf(decisions);
	const [tour, checked] = await Promise.all([
		tellOnce(
			tourPrompt(
				picked.map(turn => ({ ...turn, settled: settled(turn) })),
				{ waiting },
			),
			reply => parseTour(reply, picked),
		),
		verification(id, cwd),
	]);

	return tour && { ...tour, leftOut, ...(checked && { checked: checked.said }) };
};
