import { PAUDE_NOTES, headCommit, repoRoot } from './git';
import gitEnvironment from './utils/gitEnvironment';

// Which commits each session turn made, for paude's own use: a note on the commit naming the turn, on a notes ref of
// paude's that stays local. With notes.rewriteRef naming that ref, git carries the note through --amend and rebase,
// joining a fixup's to its target's: settling rewrites every sha in the stack, and the link comes through it. Commits
// a turn made are those new between its prompt and its end that carry no note yet; one rewritten keeps the note it had.

const MOST_A_TURN_MAKES = 50;
const LINKED_COMMITS = 2000;
// { [session id]: { root, head } } as each turn started
const started = new Map();

const git = async (args, cwd, input) => {
	const child = Bun.spawn(['git', ...args], {
		cwd,
		env: gitEnvironment(),
		stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
		stdout: 'pipe',
		stderr: 'ignore',
	});
	const out = await new Response(child.stdout).text();

	return (await child.exited) === 0 ? out : null;
};

export const turnNote = (sessionId, turnId) => `turn ${sessionId} ${turnId}`;

// Set once per repository: what carries the notes through a rewrite
const trackRewrites = async root => {
	const refs = (await git(['config', '--get-all', 'notes.rewriteRef'], root)) ?? '';

	if (!refs.split('\n').includes(PAUDE_NOTES)) await git(['config', '--add', 'notes.rewriteRef', PAUDE_NOTES], root);
};

export const turnStarted = async (sessionId, cwd) => {
	const root = await repoRoot(cwd);

	if (root) started.set(sessionId, { root, head: await headCommit(root) });
};

// At the turn's end: its note on what it made, and on what it amended (a commit --amend in its commands leaves HEAD a
// rewrite of a commit that has a note already)
export const turnEnded = async (sessionId, turn) => {
	const start = started.get(sessionId);

	started.delete(sessionId);
	if (!start || !turn) return;

	const { root, head } = start;
	const now = await headCommit(root);

	if (!now || now === head) return;
	await trackRewrites(root);

	const made = (
		(await git(['rev-list', `--max-count=${MOST_A_TURN_MAKES}`, now, ...(head ? ['--not', head] : [])], root)) ?? ''
	)
		.split('\n')
		.filter(Boolean);
	const note = turnNote(sessionId, turn.id);
	const amended = turn.steps.some(step => /\bcommit\b[^\n]*--amend/.test(step.command ?? ''));

	for (const hash of made) {
		const had = await git(['notes', '--ref', PAUDE_NOTES, 'show', hash], root);

		if (had === null) await git(['notes', '--ref', PAUDE_NOTES, 'add', '-m', note, hash], root);
		else if (amended && hash === now && !had.split('\n').includes(note))
			await git(['notes', '--ref', PAUDE_NOTES, 'append', '-m', note, hash], root);
	}
};

// { [turn note]: [hash] }: the commits on this branch each turn is linked to, newest first
export const linkedCommits = async root => {
	const out =
		(await git(
			[
				'log',
				`--max-count=${LINKED_COMMITS}`,
				'--no-standard-notes',
				`--notes=${PAUDE_NOTES}`,
				'--format=%H%x1f%N%x1e',
				'HEAD',
			],
			root,
		)) ?? '';
	const links = {};

	for (const record of out.split('\x1e')) {
		const [hash, notes = ''] = record.trim().split('\x1f');

		for (const line of notes.split('\n').filter(text => text.startsWith('turn ')))
			links[line] = [...(links[line] ?? []), hash.trim()];
	}

	return links;
};
