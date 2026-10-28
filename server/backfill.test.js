import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, expect, test } from 'bun:test';

import { backfillPrompt, changedFiles, fileInto, openConcerns, parseBackfill, targetFor } from './backfill';
import { answerDecision, designsToFile, fileAll, fileDesigns, initDecisions, lookForPlaces, toFile } from './decisions';
import { fileReasoning, gitAction, gitCommit } from './git';
import { linkedCommits, turnEnded, turnNote, turnStarted } from './turnCommits';

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

test("unlinked, a turn's changes go to the first commit after it to change its files, or past a pushed one to the open concern changing them", async () => {
	const dated = async (subject, date) => {
		await writeFile(path.join(repo, 'auth.js'), `${subject}\n`);
		git('add', 'auth.js');
		git('commit', '-q', '-m', subject, '--date', date);

		return git('rev-parse', 'HEAD');
	};
	await dated('lock accounts', '2026-10-01T00:00:00Z');
	git('push', '-q');

	// A session looked back on weeks later, whose day's commit is pushed: nowhere until a concern changes its files
	expect(await targetFor(repo, { files: ['auth.js'], concerns: [], at: '2026-09-30T00:00:00.000Z' })).toBeNull();

	const open = await dated('lock per user', '2026-10-20T00:00:00Z');
	const concerns = await openConcerns(repo);
	const target = async at => (await targetFor(repo, { files: ['auth.js'], concerns, at })).concern.hash;

	expect(await target('2026-09-30T00:00:00.000Z')).toBe(open);
	expect(await target('2026-10-10T00:00:00.000Z')).toBe(open);
	// After both, as a turn amending the latest would be
	expect(await target('2026-10-21T00:00:00.000Z')).toBe(open);
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
	const where = { cwd: repo, root: repo, sessionId: 's' };

	await lookForPlaces(
		[decision],
		async () => ({ fingerprint: 'a', names: new Set(), text: '' }),
		async () => '{"1": null}',
	);

	const concerns = await openConcerns(repo);
	const asked = [];
	const ask = answer => async prompt => {
		asked.push(prompt);

		return answer;
	};

	await fileAll(repo, await toFile([decision], turns, { concerns, ...where }), {
		ask: ask('{"message": "", "says": [], "ask": {"1": "Five tries, or three?"}}'),
	});
	expect(await toFile([decision], turns, { concerns, ...where })).toEqual([]);
	expect(await answerDecision('t1:0', 'Five: three locked people out on typos')).toBe(true);
	expect(await answerDecision('t1:0', 'again')).toBe(false);

	await fileAll(repo, await toFile([decision], turns, { concerns, ...where }), {
		ask: ask('{"message": "lock accounts\\n\\nFive tries, not three: three locked people out on typos.", "says": [1]}'),
	});
	expect(asked[1]).toContain('You asked the person: Five tries, or three?\n   They answered: Five: three locked');
	expect(git('log', '-1', '--format=%b')).toBe(
		'lock accounts\n\nFive tries, not three: three locked people out on typos.',
	);
	expect(await toFile([decision], turns, { concerns: await openConcerns(repo), ...where })).toEqual([]);
	expect(backfillPrompt({ message: 'm', files: [], decisions: [] })).toContain('Never guess');
	expect(
		backfillPrompt({ message: 'm', files: [], decisions: [{ kind: 'finding', chose: 'Workers leak memory' }] }),
	).toContain('1. Found: Workers leak memory');
});

test('what filing asks is dropped once the decision is written down elsewhere, now or found since', async () => {
	await initDecisions(dir);
	await concern('auth.js', 'lock accounts');

	const decisions = ['t1', 't2'].map(id => ({ id: `${id}:0`, turnId: id, kind: 'decision', chose: 'five tries' }));
	const turns = [turn('t1', 'auth.js'), turn('t2', 'auth.js')];
	const where = { cwd: repo, root: repo, sessionId: 's' };
	const places = fingerprint => async () => ({ fingerprint, names: new Set(['382a290']), text: 'commit 382a290' });

	await lookForPlaces(decisions, places('a'), async () => '{"1": null, "2": null}');
	await fileAll(repo, await toFile(decisions, turns, { concerns: await openConcerns(repo), ...where }), {
		ask: async () => '{"message": "", "says": [], "ask": {"1": "Five tries, or three?", "2": "Why five?"}}',
	});

	// The first is found written down since; the second still waits, then too once paude starts again
	await lookForPlaces(decisions, places('b'), async () => '{"1": "382a290", "2": null}');
	expect(await answerDecision('t1:0', 'five')).toBe(false);
	await writeFile(path.join(dir, 'decision-places.json'), JSON.stringify({ 't2:0': { place: '382a290' } }));
	await initDecisions(dir);
	expect(await answerDecision('t2:0', 'five')).toBe(false);
});

test("one the code didn't hold is filed into a commit, and into its design document once the code holds it", async () => {
	await initDecisions(dir);
	await concern('auth.js', 'lock accounts');
	await writeFile(path.join(repo, 'auth.lld.md'), '# Auth\n> ./auth.js\n- locks\n');

	const decision = { id: 't1:0', turnId: 't1', kind: 'decision', chose: 'five tries' };
	const where = { cwd: repo, root: repo, sessionId: 's' };
	const outcome = (passed, failed) => ({ passed, failed, pending: 0, indirect: 0, shallow: 0 });
	const filed = [];
	const design = holds =>
		designsToFile(repo, [decision]).then(designs =>
			fileDesigns(repo, designs, {
				ask: async () => '{"document": "# Auth\\n> ./auth.js\\n- locks\\n- five tries\\n", "message": "auth: five"}',
				run: async () => [outcome(1, 0), holds ? outcome(2, 0) : outcome(1, 1)],
				file: async (...args) => filed.push(args[1]),
			}),
		);

	await lookForPlaces(
		[decision],
		async () => ({ fingerprint: 'a', names: new Set(['auth.lld.md']), text: '# Auth' }),
		async () => '{"1": {"belongs": "auth.lld.md"}}',
	);
	await design(false);
	await fileAll(
		repo,
		await toFile([decision], [turn('t1', 'auth.js')], { concerns: await openConcerns(repo), ...where }),
		{
			ask: async () => '{"message": "lock accounts\\n\\nFive tries.", "says": [1]}',
		},
	);
	expect(git('log', '-1', '--format=%b')).toContain('Five tries.');
	expect(await designsToFile(repo, [decision])).toEqual([]);

	await writeFile(path.join(repo, 'auth.js'), 'five tries\n');
	await design(true);
	expect(filed).toEqual(['auth.lld.md']);
	expect(await designsToFile(repo, [decision])).toEqual([]);
});

test("a turn's note on the commits it made comes through an amend and a settle, onto the commits they became", async () => {
	const auth = await concern('auth.js', 'lock accounts');

	await turnStarted('s', repo);
	await concern('ui.js', 'show the lock');
	await turnEnded('s', { id: 't1', steps: [] });
	expect((await linkedCommits(repo))[turnNote('s', 't1')]).toEqual([git('rev-parse', 'HEAD')]);
	// Made before any turn was noted: not taken for this one
	expect(Object.values(await linkedCommits(repo)).flat()).not.toContain(auth);

	await turnStarted('s', repo);
	await writeFile(path.join(repo, 'ui.js'), 'show the lock, louder\n');
	git('commit', '-q', '-a', '--amend', '--no-edit');
	await turnEnded('s', { id: 't2', steps: [{ command: 'git commit -a --amend --no-edit' }] });

	const amended = git('rev-parse', 'HEAD');

	expect((await linkedCommits(repo))[turnNote('s', 't1')]).toEqual([amended]);
	expect((await linkedCommits(repo))[turnNote('s', 't2')]).toEqual([amended]);

	await turnStarted('s', repo);
	await writeFile(path.join(repo, 'auth.js'), 'lock accounts, per user\n');
	git('add', 'auth.js');
	git('commit', '-q', '-m', 'fixup! lock accounts');
	await turnEnded('s', { id: 't3', steps: [] });
	expect((await gitAction(repo, 'settle')).ok).toBe(true);

	const links = await linkedCommits(repo);

	// The fixup's turn now names the commit it folded into; the others the rewritten ui commit
	expect(links[turnNote('s', 't3')]).toEqual([git('rev-parse', 'HEAD~1')]);
	expect(links[turnNote('s', 't1')]).toEqual([git('rev-parse', 'HEAD')]);
});

test('a decision goes to the commit its turn made while it is open, and unlinked, to the one its files say', async () => {
	const pushed = await concern('auth.js', 'lock accounts');

	git('push', '-q');

	const open = await concern('ui.js', 'show the lock');
	const concerns = await openConcerns(repo);

	expect((await targetFor(repo, { files: ['ui.js'], linked: [open, pushed], concerns })).concern.hash).toBe(open);
	expect((await targetFor(repo, { files: ['ui.js'], concerns, at: '2000-01-01T00:00:00.000Z' })).concern.hash).toBe(
		open,
	);
	expect(await targetFor(repo, { files: ['other.js'], concerns })).toBeNull();
});

test('what explains a pushed commit waits for an open concern changing its files, and never makes a commit of its own', async () => {
	const pushed = await concern('auth.js', 'lock accounts');

	git('push', '-q');

	const head = git('rev-parse', 'HEAD');

	expect(
		await targetFor(repo, { files: ['auth.js'], linked: [pushed], concerns: await openConcerns(repo) }),
	).toBeNull();
	expect(git('rev-parse', 'HEAD')).toBe(head);

	await writeFile(path.join(repo, 'auth.js'), 'lock accounts after five tries\n');
	git('add', 'auth.js');
	git('commit', '-q', '-m', 'count tries before locking');
	await concern('ui.js', 'show the lock');

	const concerns = await openConcerns(repo);
	const target = await targetFor(repo, { files: ['auth.js'], linked: [pushed], concerns });

	expect(target.concern.subject).toBe('count tries before locking');

	await fileInto(repo, target.concern, [{ kind: 'decision', chose: 'per user' }], {
		ask: async () => '{"message": "count tries before locking\\n\\nPer user, not per session.", "says": [1]}',
	});
	expect((await gitAction(repo, 'settle')).ok).toBe(true);
	expect(git('log', '--format=%s', `${pushed}..HEAD`).split('\n')).toEqual([
		'show the lock',
		'count tries before locking',
	]);
	expect(git('log', '-1', '--format=%B', 'HEAD~1')).toBe('count tries before locking\n\nPer user, not per session.');
	expect((await gitCommit(repo, pushed)).explainedBy).toEqual([]);
});

test('a commit that recorded what explains a pushed one, from before, still shows under it', async () => {
	const pushed = await concern('auth.js', 'lock accounts');

	git('push', '-q');
	await concern('auth.js', 'why accounts lock per user', `A new session would reset the count.\n\nExplains ${pushed}.`);

	expect((await gitCommit(repo, pushed)).explainedBy).toEqual([
		expect.objectContaining({ subject: 'why accounts lock per user', body: 'A new session would reset the count.' }),
	]);
});
