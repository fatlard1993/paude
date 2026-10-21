import { stat } from 'fs/promises';
import { isAbsolute, join } from 'path';

import { relativeTime } from '@vanilla-bean/components/utils/date';
import { listChanges } from './changes';
import { runsOf, testCounts } from './tasks';
import { sessionTurns } from './timeline';

// Whether what changed has been tested since: the session's test runs (the ones Claude ran, and the Tasks panel's)
// against when its files last changed on disk, so an edit counts however it was made (Claude's tools, a command, an
// editor, a person). A claim that tests pass is only as good as the run behind it; this is the run.

// A runner counts only where a command starts (the start, or after ;, &&, ||, |, ( or a newline), perhaps after
// variables set for it, a package runner or time, and only as a whole word: so `bun test` and
// `cd web && CI=1 pytest -x` do, and `cat jest.config.js` and `grep -rn pytest .` don't
const TEST_COMMAND =
	/(?:^|[;&|(\n])\s*(?:\w+=\S*\s+)*(?:(?:npx|bunx|pnpm\s+exec|uv\s+run|poetry\s+run|time)\s+)*(?:(?:bun|npm|pnpm|yarn|deno)\s+(?:run\s+)?test(?::\S+)?|vitest|jest|mocha|ava|playwright\s+test|pytest|py\.test|python3?\s+-m\s+(?:pytest|unittest)|go\s+test|cargo\s+(?:test|nextest)|mix\s+test|rspec|rake\s+test|phpunit|ctest|dotnet\s+test|(?:\.\/)?gradlew?\s+\S*test|mvn\s+\S*test|make\s+(?:test|check)[\w:-]*|tox|nox|swift\s+test)(?=[\s;&|)]|$)/;
const NAMED = 4;

const COMMAND_SHOWN = 60;

// A heredoc's body is text the command writes or feeds in, not what it runs
const HEREDOC = /<<-?\s*(['"]?)(\w+)\1[^\n]*\n[\s\S]*?^\s*\2\s*$/gm;

export const isTestCommand = command => TEST_COMMAND.test((command ?? '').replace(HEREDOC, ''));

// The test command as it ran (from where the runner starts, to the end of its line), so a run of a few tests reads
// as that and not as the whole suite
const testPart = command => {
	const plain = command.replace(HEREDOC, '');
	const found = TEST_COMMAND.exec(plain);
	const line = plain
		.slice(found.index)
		.replace(/^[\s;&|(]+/, '')
		.split('\n')[0]
		.replace(/\s+/g, ' ')
		.trim();

	return line.length > COMMAND_SHOWN ? `${line.slice(0, COMMAND_SHOWN - 1)}…` : line;
};

// Whether a run's counts, where its output has them, say it passed: some tests ran, and none failed or broke
const countsPass = counts => !counts || (counts.failed === 0 && !counts.errors && counts.passed > 0);

// Whether a run passed: it didn't exit failing, and the runner's own counts agree (a command piped through grep exits
// as grep did)
const passed = step => step.ok !== false && countsPass(testCounts(step.output ?? ''));

// Each test run, oldest first: { at, ok, what }
export const testRunsOf = (turns, taskRuns = []) =>
	[
		...turns.flatMap(turn =>
			turn.steps
				.filter(step => step.tool === 'Bash' && step.ok !== undefined && !step.declined && isTestCommand(step.command))
				.map(step => ({ at: Date.parse(step.endedAt ?? step.at), ok: passed(step), what: testPart(step.command) })),
		),
		...taskRuns
			.filter(run => run.code !== undefined && !run.stopped && (run.tests || isTestCommand(run.command)))
			.map(run => ({ at: run.endedAt, ok: run.code === 0 && countsPass(run.tests), what: run.name })),
	]
		.filter(run => Number.isFinite(run.at))
		.sort((a, b) => a.at - b.at);

// Where things stand, from the runs and when each changed file last changed: { state, run, edited }, where state is
// 'current' (a passing run since the last change), 'stale' (changed since the last passing run), 'failing' (the
// latest run failed) or 'untested' (changes, and no run); null with neither changes nor runs
export const verdictOf = ({ runs, edited }) => {
	if (!runs.length && !edited.length) return null;

	const latest = runs.at(-1);
	const passed = runs.findLast(run => run.ok);
	const since = edited
		.filter(file => file.at > (passed?.at ?? -Infinity))
		.sort((a, b) => b.at - a.at)
		.map(file => file.path);

	if (!runs.length) return { state: 'untested', edited: since };
	if (!latest.ok) return { state: 'failing', run: latest, edited: since };
	if (since.length) return { state: 'stale', run: passed, edited: since };

	return { state: 'current', run: passed, edited: [] };
};

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const named = paths =>
	`${paths.slice(0, NAMED).join(', ')}${paths.length > NAMED ? ` and ${paths.length - NAMED} more` : ''}`;

// The verdict in a sentence
export const sayVerdict = verdict => {
	if (!verdict) return null;

	const run = verdict.run && `${verdict.run.what}, ${relativeTime(verdict.run.at)}`;

	if (verdict.state === 'current') return `Tests passed after the last change (${run}).`;
	if (verdict.state === 'stale')
		return `${plural(verdict.edited.length, 'file')} changed since the last passing test run (${run}): ${named(verdict.edited)}.`;
	if (verdict.state === 'failing')
		return `The latest test run failed (${run})${verdict.edited.length ? `, and ${plural(verdict.edited.length, 'file')} changed since a run last passed` : ''}.`;

	return `${plural(verdict.edited.length, 'file')} changed, and no test has run in this session.`;
};

const changedAt = async (cwd, path) => {
	try {
		return (await stat(join(cwd, path))).mtimeMs;
	} catch {
		return null;
	}
};

// The session's verdict: { state, run, edited, said }, or null
export const verification = async (sessionId, cwd) => {
	const turns = await sessionTurns(sessionId, cwd);
	const changed = ((await listChanges(cwd)) ?? [])
		.filter(change => change.status !== 'deleted')
		.map(change => change.path);
	const editedHere = turns.flatMap(turn =>
		turn.steps
			.filter(step => step.edits && step.ok !== false && step.file && !isAbsolute(step.file))
			.map(step => step.file),
	);
	const paths = [...new Set([...changed, ...editedHere])];
	const edited = (await Promise.all(paths.map(async path => ({ path, at: await changedAt(cwd, path) })))).filter(
		file => file.at !== null,
	);
	const verdict = verdictOf({ runs: testRunsOf(turns, runsOf(sessionId)), edited });

	return verdict && { ...verdict, said: sayVerdict(verdict) };
};
