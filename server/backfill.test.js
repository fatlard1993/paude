import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { backfillPrompt, changedFiles, concernFor, fileInto, openConcerns, parseBackfill } from './backfill';
import { answerDecision, fileAll, initDecisions, lookForPlaces, toFile } from './decisions';
import { fileReasoning, gitAction } from './git';

let dir;
let repo;
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));

const git = (...args) => {
	const { exitCode, stdout } = Bun.spawnSync(['git', ...args], { cwd: repo, env });

	if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);

	return stdout.toString().trim();
};

const concern = async (file, subject, body = '') => {
	await writeFile(path.join(repo, file), `${subject}\n`);
	git('add', file);
	git('commit', '-q', '-m', subject, ...(body ? ['-m', body] : []));

	return git('rev-parse', 'HEAD');
};

beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), 'paude-backfill-'));
	repo = path.join(dir, 'repo');
	Bun.spawnSync(['git', 'init', '-q', '-b', 'main', repo], { env });
	Bun.spawnSync(['git', 'init', '-q', '--bare', '-b', 'main', path.join(dir, 'remote.git')], { env });
	git('config', 'user.name', 'Ana');
	git('config', 'user.email', 'ana@example.com');
	git('config', 'commit.gpgsign', 'false');
	await concern('base.txt', 'base');
	git('remote', 'add', 'origin', path.join(dir, 'remote.git'));
	git('push', '-q', '-u', 'origin', 'main');
});

afterEach(() => rm(dir, { recursive: true, force: true }));

const turn = (id, ...files) => ({ id, steps: files.map(file => ({ tool: 'Edit', edits: true, file })) });

test("a decision's files are what its turn and the next one changed, as git names them", () => {
	const turns = [turn('t1', 'a.js'), turn('t2', 'sub/b.js', '../../elsewhere.js'), turn('t3', 'c.js')];

	expect(changedFiles(turns, 't1', { cwd: path.join(repo, 'app'), root: repo })).toEqual(['app/a.js', 'app/sub/b.js']);
	expect(changedFiles(turns, 'gone', { cwd: repo, root: repo })).toEqual([]);
});

test("a turn's changes go to a concern opened at it or after, the oldest on a tie; else the newest it amended", () => {
	// Newest first, as the stack lists them
	const concerns = [
		{ hash: 'c', authored: '2026-10-22T03:00:00.000Z', files: ['y.js', 'z.js'] },
		{ hash: 'b', authored: '2026-10-22T02:00:00.000Z', files: ['x.js', 'y.js'] },
		{ hash: 'a', authored: '2026-10-22T01:00:00.000Z', files: ['y.js', 'w.js'] },
	];

	expect(concernFor(concerns, ['y.js'], '2026-10-22T01:30:00.000Z')?.hash).toBe('b');
	expect(concernFor(concerns, ['y.js', 'z.js'], '2026-10-22T01:30:00.000Z')?.hash).toBe('c');
	expect(concernFor(concerns, ['w.js'], '2026-10-22T01:30:00.000Z')?.hash).toBe('a');
	expect(concernFor(concerns, ['y.js'], '2026-10-22T04:00:00.000Z')?.hash).toBe('c');
	expect(concernFor(concerns, ['other.js'], '2026-10-22T01:30:00.000Z')).toBeNull();
});

test("Claude's reply keeps only questions with words in them", () => {
	const reply = parseBackfill(
		'```json\n{"message": "a\\n\\nwhy", "says": [1, "3"], "ask": {"2": "Which?", "4": " "}}\n```',
	);

	expect(reply.message).toBe('a\n\nwhy');
	expect([...reply.says]).toEqual(['1', '3']);
	expect(reply.ask).toEqual({ 2: 'Which?' });
	expect(parseBackfill('no')).toBeNull();
});

test('filing writes the whole message as an amend! on top, leaving the index and working tree as they were', async () => {
	await concern('auth.js', 'lock accounts');
	await concern('ui.js', 'show the lock');
	await writeFile(path.join(repo, 'wip.js'), 'half done\n');
	git('add', 'wip.js');
	await writeFile(path.join(repo, 'ui.js'), 'edited, not staged\n');

	const auth = (await openConcerns(repo)).find(open => open.subject === 'lock accounts');
	const asked = [];
	const outcomes = await fileInto(
		repo,
		auth,
		[
			{ kind: 'decision', chose: 'per user', rejected: 'per session', because: 'a new session resets it' },
			{ kind: 'decision', chose: 'five tries' },
			{ kind: 'direction', chose: 'tabs, not spaces' },
		],
		{
			ask: async prompt => {
				asked.push(prompt);

				return '{"message": "lock accounts\\n\\nLocks per user, not per session: a new session would reset the count.", "says": [1], "ask": {"2": "Five tries, or three?"}}';
			},
		},
	);

	expect(asked[0]).toContain('The message now:\nlock accounts');
	expect(asked[0]).toContain('The files it changes:\nauth.js');
	expect(asked[0]).toContain('1. Decided: per user\n   Rejected: per session\n   Because: a new session resets it');
	expect(outcomes).toEqual([
		{ into: auth.hash, place: auth.short },
		{ into: auth.hash, question: 'Five tries, or three?' },
		{ into: auth.hash },
	]);
	expect(git('log', '-1', '--format=%s')).toBe('amend! lock accounts');
	expect(git('diff', '--cached', '--name-only')).toBe('wip.js');
	expect(git('diff', '--name-only')).toBe('ui.js');

	git('commit', '-q', '-m', 'wip');
	git('stash', '-q');
	expect((await gitAction(repo, 'settle')).ok).toBe(true);
	expect(git('log', '--format=%s', 'origin/main..HEAD').split('\n')).toEqual(['wip', 'show the lock', 'lock accounts']);
	expect(git('show', '-s', '--format=%b', 'HEAD~2')).toBe(
		'Locks per user, not per session: a new session would reset the count.',
	);
});

test('a message that stays as it is files nothing; a pushed concern is not filed into', async () => {
	const pushed = git('rev-parse', 'HEAD');

	await concern('auth.js', 'lock accounts');

	const [auth] = await openConcerns(repo);
	const before = git('rev-parse', 'HEAD');

	await fileInto(repo, auth, [{ kind: 'decision', chose: 'per user' }], {
		ask: async () => '{"message": "", "says": [1]}',
	});
	expect(git('rev-parse', 'HEAD')).toBe(before);
	await expect(fileReasoning(repo, pushed, 'base\n\nwhy')).rejects.toThrow('pushed or gone');
});

test("what filing asks waits for the person's answer, and is offered again with it", async () => {
	await initDecisions(dir);
	await concern('auth.js', 'lock accounts');

	const decision = { id: 't1:0', turnId: 't1', kind: 'decision', chose: 'five tries' };
	const turns = [turn('t1', 'auth.js')];
	const where = { cwd: repo, root: repo };

	await lookForPlaces([decision], { fingerprint: 'a', names: new Set(), text: '' }, async () => '{"1": null}');

	const concerns = await openConcerns(repo);
	const asked = [];
	const ask = answer => async prompt => {
		asked.push(prompt);

		return answer;
	};

	await fileAll(repo, toFile([decision], turns, concerns, where), {
		ask: ask('{"message": "", "says": [], "ask": {"1": "Five tries, or three?"}}'),
	});
	expect(toFile([decision], turns, concerns, where)).toEqual([]);
	expect(await answerDecision('t1:0', 'Five: three locked people out on typos')).toBe(true);
	expect(await answerDecision('t1:0', 'again')).toBe(false);

	await fileAll(repo, toFile([decision], turns, concerns, where), {
		ask: ask('{"message": "lock accounts\\n\\nFive tries, not three: three locked people out on typos.", "says": [1]}'),
	});
	expect(asked[1]).toContain('You asked the person: Five tries, or three?\n   They answered: Five: three locked');
	expect(git('log', '-1', '--format=%b')).toBe(
		'lock accounts\n\nFive tries, not three: three locked people out on typos.',
	);
	expect(toFile([decision], turns, await openConcerns(repo), where)).toEqual([]);
	expect(backfillPrompt({ message: 'm', files: [], decisions: [] })).toContain('Never guess');
});
