import { mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
	gitAction,
	gitBlame,
	gitBranches,
	gitCommit,
	gitLog,
	gitStashes,
	gitStatus,
	parseStatus,
	repoRoot,
	splitPatch,
} from './git';

let dir;
let repo;

// Without what a git hook running these tests sets (GIT_AUTHOR_NAME and the like), which would outrank the repo's own
const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_')));

const git = (...args) => {
	const { exitCode, stdout } = Bun.spawnSync(['git', ...args], { cwd: repo, env });

	if (exitCode !== 0) throw new Error(`git ${args.join(' ')} failed`);

	return stdout.toString().trim();
};

const write = (name, text) => writeFile(path.join(repo, name), text);

beforeEach(async () => {
	dir = await mkdtemp(path.join(os.tmpdir(), 'paude-git-'));
	repo = path.join(dir, 'repo');
	Bun.spawnSync(['git', 'init', '-q', '-b', 'main', repo], { env });
	git('config', 'user.name', 'Ana');
	git('config', 'user.email', 'ana@example.com');
	git('config', 'commit.gpgsign', 'false');
});

afterEach(() => rm(dir, { recursive: true, force: true }));

const firstCommit = async () => {
	await write('a.txt', 'one\n');
	git('add', '-A');
	git('commit', '-q', '-m', 'first');
};

test('the repository is found from its folder; outside git there is none', async () => {
	expect(await repoRoot(repo)).toBe(repo);
	expect(await repoRoot(dir)).toBeNull();
});

test('reads porcelain status: branch, tracking, staged, unstaged, renamed, untracked', () => {
	const text = [
		'# branch.oid abc',
		'# branch.head main',
		'# branch.upstream origin/main',
		'# branch.ab +2 -1',
		'1 M. N... 100644 100644 100644 aaa bbb staged.txt',
		'1 .M N... 100644 100644 100644 aaa bbb edited file.txt',
		'2 R. N... 100644 100644 100644 aaa bbb R100 new.txt',
		'old.txt',
		'? loose.txt',
		'',
	].join('\0');

	expect(parseStatus(text)).toMatchObject({
		branch: 'main',
		upstream: 'origin/main',
		ahead: 2,
		behind: 1,
		staged: [
			{ path: 'staged.txt', status: 'modified' },
			{ path: 'new.txt', status: 'renamed', from: 'old.txt' },
		],
		unstaged: [{ path: 'edited file.txt', status: 'modified' }],
		untracked: [{ path: 'loose.txt', status: 'untracked' }],
	});
});

describe('changes', () => {
	test('stage, unstage and commit, in a repository with no commits yet too', async () => {
		await write('a.txt', 'one\n');
		expect((await gitStatus(repo)).hasCommits).toBe(false);

		expect((await gitAction(repo, 'stage', { paths: ['a.txt'] })).ok).toBe(true);
		expect((await gitStatus(repo)).staged).toEqual([{ path: 'a.txt', status: 'added' }]);

		expect((await gitAction(repo, 'unstage', { paths: ['a.txt'] })).ok).toBe(true);
		expect((await gitStatus(repo)).untracked).toEqual([{ path: 'a.txt', status: 'untracked' }]);

		await gitAction(repo, 'stage', { all: true });
		expect((await gitAction(repo, 'commit', { message: 'first' })).ok).toBe(true);
		expect(git('log', '--format=%s')).toBe('first');
	});

	test('a commit needs a message, unless it amends', async () => {
		await firstCommit();
		await write('a.txt', 'two\n');
		await gitAction(repo, 'stage', { all: true });

		expect(await gitAction(repo, 'commit', { message: ' ' })).toEqual({
			ok: false,
			output: 'Write a message for the commit',
		});
		expect((await gitAction(repo, 'commit', { amend: true })).ok).toBe(true);
		expect(git('log', '--format=%s')).toBe('first');
	});

	test('discarding undoes edits and deletes untracked files', async () => {
		await firstCommit();
		await write('a.txt', 'changed\n');
		await write('b.txt', 'new\n');

		expect((await gitAction(repo, 'discard', { paths: ['a.txt', 'b.txt'] })).ok).toBe(true);
		expect(await Bun.file(path.join(repo, 'a.txt')).text()).toBe('one\n');
		expect(await Bun.file(path.join(repo, 'b.txt')).exists()).toBe(false);
	});

	test('paths that look like options are refused', async () => {
		expect((await gitAction(repo, 'stage', { paths: ['--all'] })).ok).toBe(false);
		await expect(gitAction(repo, 'nonsense')).rejects.toThrow('Unknown git action');
	});
});

describe('history', () => {
	test('the log, a commit with its files, and blame', async () => {
		await firstCommit();
		await write('a.txt', 'one\ntwo\n');
		git('mv', 'a.txt', 'b.txt');
		git('add', '-A');
		git('commit', '-q', '-m', 'second', '-m', 'with a body');

		const log = await gitLog(repo);

		expect(log.map(({ subject }) => subject)).toEqual(['second', 'first']);
		expect(log[0]).toMatchObject({ author: 'Ana', parents: [log[1].hash] });
		expect(log[0].refs).toContain('HEAD -> main');

		const commit = await gitCommit(repo, log[0].hash);

		expect(commit).toMatchObject({ title: 'second', body: 'with a body', author: 'Ana' });
		expect(commit.files).toMatchObject([{ path: 'b.txt', from: 'a.txt', status: 'renamed' }]);

		expect((await gitLog(repo, { path: 'b.txt' })).length).toBe(2);
		expect((await gitBlame(repo, 'b.txt')).map(({ line, summary }) => [line, summary])).toEqual([
			[1, 'first'],
			[2, 'second'],
		]);
	});

	test('a ref that looks like an option is not a commit', async () => {
		await firstCommit();
		await expect(gitCommit(repo, '--all')).rejects.toThrow('That is not a commit');
	});

	test('splits a patch into its files', () => {
		const patch = [
			'diff --git a/x.js b/x.js',
			'new file mode 100644',
			'--- /dev/null',
			'+++ b/x.js',
			'@@ -0,0 +1 @@',
			'+hi',
			'diff --git a/y.js b/y.js',
			'deleted file mode 100644',
			'',
		].join('\n');

		expect(splitPatch(patch).map(({ path, status }) => [path, status])).toEqual([
			['x.js', 'added'],
			['y.js', 'deleted'],
		]);
	});
});

describe('branches and stashes', () => {
	test('create, switch and delete a branch; deleting unmerged work is refused', async () => {
		await firstCommit();

		expect((await gitAction(repo, 'createBranch', { name: 'idea' })).ok).toBe(true);
		expect((await gitBranches(repo)).current).toBe('idea');

		await write('a.txt', 'idea\n');
		git('commit', '-qam', 'idea');
		await gitAction(repo, 'switch', { branch: 'main' });

		const refused = await gitAction(repo, 'deleteBranch', { name: 'idea' });

		expect(refused.ok).toBe(false);
		expect(refused.output).toContain('not fully merged');
		expect((await gitBranches(repo)).local.map(({ name }) => name).sort()).toEqual(['idea', 'main']);
	});

	test('stash and unstash, untracked files included', async () => {
		await firstCommit();
		await write('a.txt', 'wip\n');
		await write('new.txt', 'wip\n');

		expect((await gitAction(repo, 'stash', { message: 'half done' })).ok).toBe(true);
		expect((await gitStatus(repo)).untracked).toEqual([]);
		expect((await gitStashes(repo))[0].subject).toContain('half done');

		expect((await gitAction(repo, 'unstash', {})).ok).toBe(true);
		expect(await Bun.file(path.join(repo, 'new.txt')).text()).toBe('wip\n');
	});
});

test('push sets the upstream the first time; pull only fast-forwards', async () => {
	const remote = path.join(dir, 'remote.git');

	Bun.spawnSync(['git', 'init', '-q', '--bare', '-b', 'main', remote], { env });
	await firstCommit();
	git('remote', 'add', 'origin', remote);

	expect((await gitAction(repo, 'push')).ok).toBe(true);
	expect((await gitStatus(repo)).upstream).toBe('origin/main');

	// Someone else pushes; this checkout pulls their commit
	const other = path.join(dir, 'other');

	Bun.spawnSync(['git', 'clone', '-q', remote, other], { env });
	Bun.spawnSync(
		[
			'git',
			'-C',
			other,
			'-c',
			'user.name=Ben',
			'-c',
			'user.email=b@e.c',
			'commit',
			'-q',
			'--allow-empty',
			'-m',
			'theirs',
		],
		{ env },
	);
	Bun.spawnSync(['git', '-C', other, 'push', '-q'], { env });

	expect((await gitAction(repo, 'fetch')).ok).toBe(true);
	expect((await gitStatus(repo)).behind).toBe(1);
	expect((await gitAction(repo, 'pull')).ok).toBe(true);
	expect(git('log', '-1', '--format=%s')).toBe('theirs');
});
