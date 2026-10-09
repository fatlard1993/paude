import askHaiku, { jsonIn } from './haiku';
import { transcriptFile } from './sessions/transcript';
import { lastLines, timelineFrom } from './timeline';

// Catching someone up on a session: the turns since they last looked (or the latest few), told by Haiku as a short
// overview and a stop per turn, for a tour through the scrollback. Asked only when someone asks, and kept, so everyone
// shown the same turns is shown the same tour.
const RECENT_TURNS = 10;
const MOST_TURNS = 25;
const SAID_IN_PROMPT = 400;
const tours = new Map();

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// What a turn did, in a line: the files it changed, the commands it ran, what else it used
export const didOf = steps => {
	const edited = [...new Set(steps.filter(step => step.edits).map(step => step.file))];
	const commands = steps.filter(step => step.tool === 'Bash');
	const reads = steps.filter(step => step.tool === 'Read').length;
	const failed = steps.filter(step => step.ok === false).length;

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
	]
		.filter(Boolean)
		.join('; ');
};

export const tourPrompt = turns =>
	[
		'You are catching someone up on a coding session between a person and Claude, a coding assistant.',
		'Write an overview of 2 or 3 sentences: where things stand now, and anything left waiting on them. Then one stop per turn: 1 or 2 sentences on what was asked and what came of it.',
		'Plain words, past tense, no markdown, no filler, no praise. The reader may not be who asked: never say "you"; start a stop with what was asked, like "Asked for a smaller icon; Claude…".',
		'Reply with only a JSON object: {"overview": "…", "stops": {"1": "…", "2": "…"}}, one stop for each numbered turn.',
		turns
			.map((turn, index) =>
				[
					`Turn ${index + 1}, ${turn.at}`,
					`  Asked: ${turn.prompt}`,
					turn.steps.length && `  Did: ${didOf(turn.steps)}`,
					turn.said && `  Claude ended with: ${turn.said.slice(-SAID_IN_PROMPT)}`,
				]
					.filter(Boolean)
					.join('\n'),
			)
			.join('\n\n'),
	].join('\n\n');

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
		})),
	};
};

// Not a keep-warm ping (paude's, or the keep-warm command's), not cut short, and not the same prompt as the turn
// after it (sent again)
const KEEP_WARM_PING = /^keep-?warm ping/i;
const worthTelling = (turn, index, turns) =>
	!turn.interrupted && !KEEP_WARM_PING.test(turn.prompt) && turn.prompt !== turns[index + 1]?.prompt;

// since: a time (ms); without it, the latest turns
export const catchUp = async (id, cwd, { since } = {}) => {
	const file = await transcriptFile(id, cwd);
	const turns = file ? timelineFrom(await lastLines(file), cwd).filter(worthTelling) : [];
	const picked = (since ? turns.filter(turn => Date.parse(turn.at) > since) : turns.slice(-RECENT_TURNS)).slice(
		-MOST_TURNS,
	);

	if (!picked.length) return { overview: 'Nothing has happened here since you last looked.', stops: [] };

	const key = `${id} ${picked[0].id} ${picked.at(-1).id} ${picked.at(-1).endedAt}`;

	if (!tours.has(key)) {
		const tour = askHaiku(tourPrompt(picked)).then(reply => parseTour(reply, picked));

		tours.set(key, tour);
		// Nothing came back: asked again next time
		tour.then(found => !found && tours.delete(key));
	}

	return tours.get(key);
};
