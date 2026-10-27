import { listChanges } from './changes';
import { listFiles } from './files';
import { gitLog, repoRoot } from './git';
import askHaiku, { jsonIn } from './haiku';
import { outline } from './symbols';
import { sessionTurns } from './timeline';

// What to open for a few words asked aside ("the test for this", "what Claude changed in the login"): Haiku picks
// files, changes, commits and turns from what the session is working on, and only those that are there are opened.
const RECENT_TURNS = 12;
const RECENT_COMMITS = 20;
const MAX_CHANGES = 80;
const MAX_PATHS = 1500;
const MAX_OPENED = 6;
const SCREEN_CHARACTERS = 4000;
const PROMPT_CHARACTERS = 200;
// A word of the request this long or longer narrows a big project's paths to those holding it
const WORD = 3;

const unique = items => [...new Set(items.filter(Boolean))];

// A big project's paths cut to what the request could mean: those already part of the work, then those naming a word
// of it, then the rest, as many as fit
export const pathsFor = (files, ask, known) => {
	if (files.length <= MAX_PATHS) return files;

	const words = unique(ask.toLowerCase().split(/[^a-z0-9_]+/)).filter(word => word.length >= WORD);
	const named = files.filter(path => words.some(word => path.toLowerCase().includes(word)));

	return unique([...known.filter(path => files.includes(path)), ...named, ...files]).slice(0, MAX_PATHS);
};

// The session's work as Haiku is shown it: what's open, what changed, the latest turns and commits, the project's
// paths and the end of the screen
export const surfaceOf = async (id, cwd, { ask, viewing, screen }) => {
	const root = await repoRoot(cwd);
	const [changes, turns, commits, files] = await Promise.all([
		listChanges(cwd).then(found => (found ?? []).slice(0, MAX_CHANGES)),
		sessionTurns(id, cwd).then(all => all.filter(turn => !turn.summary && !turn.interrupted).slice(-RECENT_TURNS)),
		root ? gitLog(root, { limit: RECENT_COMMITS }) : [],
		listFiles(cwd),
	]);
	const touched = turns.map(turn => ({
		id: turn.id,
		prompt: turn.prompt.slice(0, PROMPT_CHARACTERS),
		edited: unique(turn.steps.filter(step => step.edits).map(step => step.file)),
		read: unique(turn.steps.filter(step => step.tool === 'Read').map(step => step.file)),
	}));
	const known = unique([viewing, ...changes.map(change => change.path), ...touched.flatMap(turn => turn.edited)]);

	return {
		viewing: files.includes(viewing) ? viewing : null,
		changes,
		turns: touched,
		commits: commits.map(({ hash, short, subject }) => ({ hash, short, subject })),
		files,
		paths: pathsFor(files, ask, known),
		screen: String(screen ?? '').slice(-SCREEN_CHARACTERS),
	};
};

export const openPrompt = (ask, { viewing, changes, turns, commits, paths, screen }) =>
	[
		`Someone working in a coding session with Claude asks to open something: "${ask}"`,
		'Pick what to open from what is listed below, most wanted first, at most 6. Open only what the ask points to; one thing is often right. When nothing listed fits, open nothing and say why.',
		'Each thing to open is one of:',
		'{"file": "path"} a file, or {"file": "path", "symbol": "name"} at a function, class or other name defined in it',
		'{"change": "path"} what changed in a file not yet committed',
		'{"commit": "short hash"} a commit',
		'{"turn": 3} what Claude changed in a numbered turn of the session',
		'Paths exactly as listed. "This" or "it" means what is open now, if anything is.',
		'Reply with only a JSON object: {"said": "a few plain words on what you opened, or why nothing", "open": [...]}',
		viewing && `Open now: ${viewing}`,
		changes.length &&
			`Not committed yet:\n${changes.map(({ path, status, from }) => `${path} (${status}${from ? ` from ${from}` : ''})`).join('\n')}`,
		turns.length &&
			`The latest turns, oldest first:\n${turns
				.map((turn, index) =>
					[
						`Turn ${index + 1}: ${turn.prompt}`,
						turn.edited.length && `  changed ${turn.edited.join(', ')}`,
						turn.read.length && `  read ${turn.read.join(', ')}`,
					]
						.filter(Boolean)
						.join('\n'),
				)
				.join('\n')}`,
		commits.length && `The latest commits:\n${commits.map(({ short, subject }) => `${short} ${subject}`).join('\n')}`,
		screen.trim() && `The end of the session's screen:\n${screen.trim()}`,
		`The project's files:\n${paths.join('\n')}`,
	]
		.filter(Boolean)
		.join('\n\n');

// Haiku's picks as what the files panel opens, each checked against the surface: { file, line } for a file (at a
// symbol's line when it names one defined there), { diff: source, title } for a diff; the rest dropped, and counted.
// `lineOf(path, name)` finds a symbol; null when it isn't there.
export const parseOpenings = async (reply, surface, lineOf) => {
	const json = jsonIn(reply);

	if (!json || !Array.isArray(json.open)) return null;

	const opened = [];
	let dropped = 0;
	const keep = async pick => {
		if (typeof pick?.file === 'string' && surface.files.includes(pick.file)) {
			const line = typeof pick.symbol === 'string' ? await lineOf(pick.file, pick.symbol) : null;

			return { file: pick.file, ...(line && { line }), title: line ? `${pick.symbol} in ${pick.file}` : pick.file };
		}
		if (typeof pick?.change === 'string' && surface.changes.some(change => change.path === pick.change))
			return { diff: { source: 'changes', path: pick.change }, title: `Changes to ${pick.change}` };

		const commit =
			typeof pick?.commit === 'string' &&
			pick.commit.length >= 4 &&
			surface.commits.find(({ hash }) => hash.startsWith(pick.commit));

		if (commit) return { diff: { source: 'commit', ref: commit.hash }, title: `${commit.short} ${commit.subject}` };

		const turn = surface.turns[Number(pick?.turn) - 1];

		if (turn?.edited.length) return { diff: { source: 'turn', turn: turn.id }, title: `Turn: ${turn.prompt}` };

		return null;
	};

	for (const pick of json.open.slice(0, MAX_OPENED)) {
		const found = await keep(pick);
		const again = found && opened.some(other => JSON.stringify(other) === JSON.stringify(found));

		if (!found) dropped += 1;
		else if (!again) opened.push(found);
	}

	return { said: String(json.said ?? '').trim(), opened, dropped };
};

// `ask` is Haiku but in tests
export const whatToOpen = async (id, cwd, { ask, viewing, screen }, askModel = askHaiku) => {
	const surface = await surfaceOf(id, cwd, { ask, viewing, screen });
	const lineOf = async (path, name) => (await outline(cwd, path)).find(symbol => symbol.name === name)?.line ?? null;

	return parseOpenings(await askModel(openPrompt(ask, surface)), surface, lineOf);
};
