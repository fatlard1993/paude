import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import {
	fileDocument,
	gitAction,
	gitBlame,
	gitBranches,
	gitCommit,
	gitCompare,
	gitLog,
	gitStack,
	gitStashes,
	gitSince,
	blobOf,
	gitStatus,
	inRepository,
	keepFile,
	keepText,
	linesBetween,
	linesInDiff,
	linesNow,
	movedSince,
	parseStack,
	parseStatus,
	pathsFromFolder,
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

test("a design document's new text is a commit of its own, made beside the person's work, which it leaves alone", async () => {
	await write('a.lld.md', '# A\n- one\n');
	await firstCommit();
	await write('a.txt', 'one\nmine, not committed\n');
	await write('b.txt', 'staged\n');
	git('add', 'b.txt');

	const filed = await fileDocument(repo, 'a.lld.md', '# A\n- one\n- two\n', 'a: two\n\nBecause.');

	expect(git('rev-parse', 'HEAD')).toBe(filed);
	expect(git('log', '-1', '--format=%B')).toBe('a: two\n\nBecause.');
	expect(git('show', '--format=', '--name-only', 'HEAD')).toBe('a.lld.md');
	expect(await Bun.file(path.join(repo, 'a.lld.md')).text()).toBe('# A\n- one\n- two\n');
	// The document's change is committed in the index and the working tree alike; theirs stays as it was
	expect(git('status', '--porcelain')).toBe('M a.txt\nA  b.txt');
});

test('a design document someone is changing is not filed into', async () => {
	await write('a.lld.md', '# A\n- one\n');
	await firstCommit();
	await write('a.lld.md', '# A\n- one\n- theirs\n');

	const head = git('rev-parse', 'HEAD');

	await expect(fileDocument(repo, 'a.lld.md', '# A\n- one\n- two\n', 'a: two')).rejects.toThrow('being changed');
	expect(git('rev-parse', 'HEAD')).toBe(head);
	expect(await Bun.file(path.join(repo, 'a.lld.md')).text()).toBe('# A\n- one\n- theirs\n');
});

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
		expect(log[0].body).toBeUndefined();
		expect((await gitLog(repo, { bodies: true })).map(({ body }) => body)).toEqual(['with a body', '']);

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

describe('reviewing a branch, and conflicts', () => {
	test('a branch compared with main: its own commits and changes', async () => {
		await firstCommit();
		git('switch', '-q', '-c', 'idea');
		await write('b.txt', 'new\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'add b');

		const compared = await gitCompare(repo, {});

		expect(compared.base).toBe('main');
		expect(compared.commits.map(({ subject }) => subject)).toEqual(['add b']);
		expect(compared.files).toMatchObject([{ path: 'b.txt', status: 'added' }]);

		// With the work not committed yet: an edit and a new file join what the commits change
		await write('a.txt', 'changed\n');
		await write('c.txt', 'brand new\n');

		const working = await gitCompare(repo, { working: true });

		expect(working.uncommitted).toBe(2);
		expect(working.files.map(({ path: file, status }) => [file, status])).toEqual([
			['a.txt', 'modified'],
			['b.txt', 'added'],
			['c.txt', 'added'],
		]);
		expect((await gitCompare(repo, {})).files.map(({ path: file }) => file)).toEqual(['b.txt']);
	});

	test('with the work not committed: a file deleted in a commit and back on disk is shown once; a new file with a name past ASCII, and one too big to show, are named', async () => {
		await write('gone.txt', 'old\n');
		await firstCommit();
		git('switch', '-q', '-c', 'idea');
		git('rm', '-q', 'gone.txt');
		git('commit', '-q', '-m', 'drop gone');
		await write('gone.txt', 'back\n');
		await write('café.txt', 'new\n');
		await write('big.txt', 'x'.repeat(600 * 1024));

		const working = await gitCompare(repo, { working: true });

		expect(working.files.map(({ path: file, status, note }) => [file, status, note])).toEqual([
			['café.txt', 'added', undefined],
			['gone.txt', 'modified', undefined],
			['big.txt', 'added', 'Too big to show here'],
		]);
		expect(working.files[1].diff).toContain('+back');
		expect(working.uncommitted).toBe(3);
		expect(working.leftOut).toBe(0);
		// The checkout's own index is as it was: the new files are still untracked
		expect((await gitStatus(repo)).untracked.map(({ path: file }) => file).sort()).toEqual([
			'big.txt',
			'café.txt',
			'gone.txt',
		]);
	});

	test('with the work not committed: new files past what is shown are counted as left out', async () => {
		await firstCommit();
		git('switch', '-q', '-c', 'idea');
		await Promise.all(
			Array.from({ length: 203 }, (_, index) => write(`n${String(index).padStart(3, '0')}.txt`, 'n\n')),
		);

		const working = await gitCompare(repo, { working: true });

		expect(working.files).toHaveLength(200);
		expect(working.uncommitted).toBe(200);
		expect(working.leftOut).toBe(3);
	});

	test('since a rewritten review, a file named like a pattern is only itself', async () => {
		await firstCommit();
		git('switch', '-q', '-c', 'idea');
		await write('*.txt', 'one\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'add star');

		const reviewed = git('rev-parse', 'HEAD');

		git('switch', '-q', 'main');
		await write('a.txt', 'main changed it\n');
		git('commit', '-qam', 'main moves');
		git('switch', '-q', 'idea');
		git('rebase', '-q', 'main');
		await write('*.txt', 'two\n');
		git('commit', '-qam', 'change star');

		const since = await gitSince(repo, reviewed);

		expect(since.rewritten).toBe(true);
		expect(since.files.map(({ path: file }) => file)).toEqual(['*.txt']);
	});

	test('a comment can only keep a plain file of the repository, not a secret, a pipe, a link out or a huge one', async () => {
		await firstCommit();
		await mkdir(path.join(repo, 'sub'));
		await write('.env', 'TOKEN=1\n');
		await writeFile(path.join(dir, 'outside.txt'), 'private\n');
		await write('huge.txt', 'x'.repeat(5 * 1024 * 1024));
		Bun.spawnSync(['mkfifo', path.join(repo, 'pipe')]);
		Bun.spawnSync(['ln', '-s', path.join(dir, 'outside.txt'), path.join(repo, 'link.txt')]);
		Bun.spawnSync(['ln', '-s', dir, path.join(repo, 'out')]);

		const sub = path.join(repo, 'sub');

		expect(await inRepository(sub, '../a.txt')).toBe(true);
		expect(await keepFile(sub, '../a.txt')).toBe(git('hash-object', 'a.txt'));
		for (const file of [path.join(dir, 'outside.txt'), '../outside.txt', '../../outside.txt', '.env', 'sub/../.env']) {
			expect(await inRepository(repo, file)).toBe(false);
			expect(await keepFile(repo, file)).toBeUndefined();
		}
		for (const file of ['pipe', 'link.txt', 'out/outside.txt', 'huge.txt', 'missing.txt'])
			expect(await keepFile(repo, file)).toBeUndefined();

		const kept = hash => Bun.spawnSync(['git', 'cat-file', '-e', hash], { cwd: repo, env }).exitCode === 0;

		// Its id alone writes nothing; keeping it writes it, and only when it is still the text wanted
		await write('a.txt', 'on disk now\n');

		const id = await blobOf(repo, 'a.txt');

		expect(kept(id)).toBe(false);
		expect(await keepFile(repo, 'a.txt', 'f'.repeat(40))).toBeUndefined();
		expect(kept(id)).toBe(false);
		expect(await keepFile(repo, 'a.txt', id)).toBe(id);
		expect(kept(id)).toBe(true);

		const text = 'a turn wrote this\n';
		const textId = Bun.spawnSync(['git', 'hash-object', '--stdin'], { cwd: repo, env, stdin: Buffer.from(text) })
			.stdout.toString()
			.trim();

		expect(await keepText(repo, text, 'f'.repeat(40))).toBeUndefined();
		expect(kept(textId)).toBe(false);
		expect(await keepText(repo, text, textId)).toBe(textId);
		expect(kept(textId)).toBe(true);
		expect(await keepText(repo, 'x'.repeat(5 * 1024 * 1024), 'f'.repeat(40))).toBeUndefined();
	});

	test("a comment's lines are lost, not kept as they were, when its file is gone or the commit to carry them to isn't here", async () => {
		await write('a.txt', 'one\ntwo\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'first');

		const anchor = {
			path: 'a.txt',
			from: 2,
			to: 2,
			commit: git('rev-parse', 'HEAD'),
			blob: await keepFile(repo, 'a.txt'),
		};

		expect(await linesNow(repo, anchor)).toEqual({ from: 2, to: 2 });
		expect(await linesNow(repo, anchor, 'f'.repeat(40))).toBeNull();
		expect(await linesNow(repo, { ...anchor, blob: undefined }, 'f'.repeat(40))).toBeNull();
		await rm(path.join(repo, 'a.txt'));
		expect(await linesNow(repo, anchor)).toBeNull();
		expect(await linesNow(repo, { ...anchor, blob: undefined })).toBeNull();
	});

	test('since a reviewed commit: the commits after it, or how its files differ once the branch was rewritten', async () => {
		await firstCommit();
		git('switch', '-q', '-c', 'idea');
		await write('b.txt', 'one\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'add b');

		const reviewed = git('rev-parse', 'HEAD');

		expect(await movedSince(repo, reviewed)).toEqual({ count: 0 });

		await write('b.txt', 'two\n');
		git('commit', '-qam', 'change b');
		expect(await movedSince(repo, reviewed)).toEqual({ count: 1 });

		const since = await gitSince(repo, reviewed);

		expect(since.rewritten).toBe(false);
		expect(since.commits.map(({ subject }) => subject)).toEqual(['change b']);
		expect(since.files).toMatchObject([{ path: 'b.txt', status: 'modified' }]);

		// main moves on elsewhere, and the branch is rebased onto it: only the branch's own file shows
		git('switch', '-q', 'main');
		await write('c.txt', 'main\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'main moves');
		git('switch', '-q', 'idea');
		git('rebase', '-q', 'main');
		expect(await movedSince(repo, reviewed)).toEqual({ rewritten: true });

		const rewritten = await gitSince(repo, reviewed);

		expect(rewritten.rewritten).toBe(true);
		expect(rewritten.files.map(({ path: file }) => file)).toEqual(['b.txt']);

		expect(await movedSince(repo, 'f'.repeat(40))).toEqual({ missing: true });
		await expect(gitSince(repo, 'nope')).rejects.toThrow('That is not a commit');
	});

	test("a comment's lines are carried to the files as they are, or to a commit, and lost when changed", async () => {
		await write('a.txt', 'one\ntwo\nthree\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'first');

		const written = git('rev-parse', 'HEAD');
		const anchor = { path: 'a.txt', from: 2, to: 3, commit: written };

		await write('a.txt', 'zero\none\ntwo\nthree\n');
		expect(await linesNow(repo, anchor)).toEqual({ from: 3, to: 4 });
		git('commit', '-qam', 'zero');
		expect(await linesNow(repo, anchor, git('rev-parse', 'HEAD'))).toEqual({ from: 3, to: 4 });

		await write('a.txt', 'zero\none\nTWO\nthree\n');
		expect(await linesNow(repo, anchor)).toBeNull();
		expect(await linesNow(repo, { ...anchor, commit: undefined })).toEqual({ from: 2, to: 3 });
		expect(await linesNow(repo, { ...anchor, commit: 'f'.repeat(40) })).toEqual({ from: 2, to: 3 });
	});

	test('a comment on a file with uncommitted changes stays on the lines it was read in, through edits and a commit', async () => {
		await write('a.txt', 'one\ntwo\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'first');
		// Lines added on disk, not committed: the comment is on line 3 of the file as read, not of HEAD
		await write('a.txt', 'one\nnew\nthree\ntwo\n');

		const anchor = {
			path: 'a.txt',
			from: 3,
			to: 3,
			commit: git('rev-parse', 'HEAD'),
			blob: await keepFile(repo, 'a.txt'),
		};

		expect(await linesNow(repo, anchor)).toEqual({ from: 3, to: 3 });

		await write('a.txt', 'zero\none\nnew\nthree\ntwo\n');
		expect(await linesNow(repo, anchor)).toEqual({ from: 4, to: 4 });
		git('commit', '-qam', 'more');
		expect(await linesNow(repo, anchor, git('rev-parse', 'HEAD'))).toEqual({ from: 4, to: 4 });

		await write('a.txt', 'zero\none\nnew\nTHREE\ntwo\n');
		expect(await linesNow(repo, anchor)).toBeNull();
		expect(await blobOf(repo, 'missing.txt')).toBeUndefined();
	});

	test('a comment picked in a diff is found in other diffs of the file, on the side of the change it is on', async () => {
		await write('a.txt', 'one\ntwo\nthree\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'first');
		await write('a.txt', 'one\nTWO\nthree\n');

		// Picked from the removed "two" down into the "TWO" that replaced it
		const before = await blobOf(repo, 'a.txt', 'HEAD');
		const after = await keepFile(repo, 'a.txt');
		const anchor = { path: 'a.txt', from: 2, to: 2, side: 'new', blob: after, old: { from: 2, to: 2, blob: before } };

		expect(await linesInDiff(repo, anchor, { old: before, new: after })).toEqual({
			new: { from: 2, to: 2 },
			old: { from: 2, to: 2 },
		});

		// A line goes in at the top: the diff of the file as it is now has the comment a line down after the change
		await write('a.txt', 'zero\none\nTWO\nthree\n');
		expect(await linesInDiff(repo, anchor, { old: before, new: await keepFile(repo, 'a.txt') })).toEqual({
			new: { from: 3, to: 3 },
			old: { from: 2, to: 2 },
		});

		// Committed: the next diff starts from it, where the removed line isn't
		git('commit', '-qam', 'second');
		expect(await linesInDiff(repo, anchor, { old: await blobOf(repo, 'a.txt', 'HEAD') })).toEqual({
			new: null,
			old: null,
		});

		// On removed lines alone, it's on that side only; a thread from GitHub, numbered by its commit
		expect(await linesInDiff(repo, { ...anchor, side: 'old', blob: before, old: undefined }, { old: before })).toEqual({
			old: { from: 2, to: 2 },
			new: null,
		});
		expect(
			await linesInDiff(
				repo,
				{ path: 'a.txt', from: 3, to: 3, side: 'new', commit: git('rev-parse', 'HEAD') },
				{ new: await blobOf(repo, 'a.txt', 'HEAD') },
			),
		).toEqual({ new: { from: 3, to: 3 }, old: null });
		expect(await linesBetween(repo, { from: 1, to: 1 }, before, 'f'.repeat(40))).toBeNull();
	});

	test("paths git names from the repository's top are named from a folder in it", async () => {
		await write('a.txt', 'one\n');
		git('add', '-A');
		git('commit', '-q', '-m', 'first');
		await mkdir(path.join(repo, 'app', 'src'), { recursive: true });

		const local = await pathsFromFolder(path.join(repo, 'app'));

		expect(local('app/src/x.js')).toBe('src/x.js');
		expect(local('lib/y.js')).toBe('../lib/y.js');
		expect((await pathsFromFolder(repo))('lib/y.js')).toBe('lib/y.js');
	});

	const conflicted = async () => {
		await firstCommit();
		git('switch', '-q', '-c', 'theirs');
		await write('a.txt', 'theirs\n');
		git('commit', '-qam', 'theirs');
		git('switch', '-q', 'main');
		await write('a.txt', 'ours\n');
		git('commit', '-qam', 'ours');
		Bun.spawnSync(['git', 'merge', 'theirs'], { cwd: repo, env });
	};

	test('a conflict settled with one side, then the merge carried on', async () => {
		await conflicted();
		expect((await gitStatus(repo)).inProgress).toBe('merging');
		expect((await gitStatus(repo)).conflicted).toEqual([{ path: 'a.txt' }]);

		expect((await gitAction(repo, 'resolve', { path: 'a.txt', side: 'theirs' })).ok).toBe(true);
		expect(await Bun.file(path.join(repo, 'a.txt')).text()).toBe('theirs\n');
		expect((await gitAction(repo, 'continue')).ok).toBe(true);
		expect((await gitStatus(repo)).inProgress).toBeNull();
	});

	test('a half-done merge given up', async () => {
		await conflicted();
		expect((await gitAction(repo, 'abort')).ok).toBe(true);
		expect(await Bun.file(path.join(repo, 'a.txt')).text()).toBe('ours\n');
		expect((await gitAction(repo, 'abort')).output).toBe('Nothing is half done');
	});
});

describe('the open stack', () => {
	const pushedFirst = async () => {
		const remote = path.join(dir, 'remote.git');

		Bun.spawnSync(['git', 'init', '-q', '--bare', '-b', 'main', remote], { env });
		await firstCommit();
		git('remote', 'add', 'origin', remote);
		git('push', '-q', '-u', 'origin', 'main');
	};
	const concern = async (file, subject, body = '') => {
		await write(file, `${subject}\n`);
		git('add', file);
		git('commit', '-q', '-m', subject, ...(body ? ['-m', body] : []));

		return git('rev-parse', 'HEAD');
	};

	test('folds name their concern by subject (or sha); the latest amend! is the message it will have', () => {
		const stack = parseStack([
			{ hash: 'f3', short: 'f3', subject: 'fixup! b2', body: '' },
			{ hash: 'e5', short: 'e5', subject: 'amend! a: one', body: 'a: one, widened\n\nChose X over Y.' },
			{ hash: 'b2', short: 'b2', subject: 'b: two', body: '' },
			{ hash: 'a1', short: 'a1', subject: 'a: one', body: 'Chose X.' },
		]);

		expect(stack.map(open => [open.subject, open.body, open.folds.map(fold => fold.kind)])).toEqual([
			['b: two', '', ['fixup']],
			['a: one, widened', 'Chose X over Y.', ['amend']],
		]);
	});

	test('is what the upstream lacks; a change filed into a deeper concern folds in at settling', async () => {
		await pushedFirst();

		const one = await concern('one.txt', 'one', 'Chose one.');

		await concern('two.txt', 'two');
		expect((await gitStack(repo)).concerns.map(open => open.subject)).toEqual(['two', 'one']);

		await write('one.txt', 'one, more\n');
		git('add', 'one.txt');
		expect((await gitAction(repo, 'commit', { message: 'one, widened\n\nChose one, and more.', into: one })).ok).toBe(
			true,
		);
		// The reasoning alone, nothing staged
		expect(
			(await gitAction(repo, 'commit', { message: 'one, widened\n\nChose one, and more, and why.', into: one })).ok,
		).toBe(true);

		const stack = await gitStack(repo);

		expect(stack.concerns[1]).toMatchObject({ subject: 'one, widened', body: 'Chose one, and more, and why.' });
		expect(stack.concerns[1].folds).toHaveLength(2);

		await write('loose.txt', 'not filed\n');
		expect((await gitAction(repo, 'settle')).ok).toBe(true);
		expect(git('log', '--format=%s', 'origin/main..HEAD').split('\n')).toEqual(['two', 'one, widened']);
		expect(git('show', '-s', '--format=%b', 'HEAD~1')).toBe('Chose one, and more, and why.');
		expect(git('show', 'HEAD~1:one.txt')).toBe('one, more');
		expect(git('status', '--porcelain')).toBe('?? loose.txt');
	});

	test('a fold names its concern by subject, so a pull --rebase that moves the concern leaves it folding in', async () => {
		await pushedFirst();

		const one = await concern('one.txt', 'one');

		expect((await gitAction(repo, 'commit', { message: 'one, widened\n\nChose one.', into: one })).ok).toBe(true);
		expect(git('log', '-1', '--format=%s')).toBe('amend! one');

		// The upstream gains a commit, and the pull moves the stack onto it: every sha in it changes
		const other = path.join(dir, 'other');

		Bun.spawnSync(['git', 'clone', '-q', path.join(dir, 'remote.git'), other], { env });
		await writeFile(path.join(other, 'theirs.txt'), 'theirs\n');
		for (const args of [
			['add', 'theirs.txt'],
			['-c', 'user.name=Bo', '-c', 'user.email=bo@example.com', 'commit', '-q', '-m', 'theirs'],
			['push', '-q'],
		])
			Bun.spawnSync(['git', ...args], { cwd: other, env });
		git('pull', '-q', '--rebase');
		expect(git('rev-parse', 'HEAD~1')).not.toBe(one);

		expect((await gitStack(repo)).concerns.map(open => [open.subject, open.folds.length])).toEqual([
			['one, widened', 1],
		]);
		expect((await gitAction(repo, 'settle')).ok).toBe(true);
		expect(git('log', '--format=%s', 'origin/main..HEAD')).toBe('one, widened');
		expect(git('log', '-1', '--format=%s', 'origin/main')).toBe('theirs');
	});

	test("settling folds the stack where it left the upstream, and doesn't bring in what the upstream gained since", async () => {
		await pushedFirst();

		const one = await concern('one.txt', 'one');

		await write('one.txt', 'one, more\n');
		git('add', 'one.txt');
		await gitAction(repo, 'commit', { message: 'one, widened', into: one });

		// Someone else pushes; this checkout fetches it but hasn't taken it in
		const other = path.join(dir, 'other');

		Bun.spawnSync(['git', 'clone', '-q', path.join(dir, 'remote.git'), other], { env });
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
		git('fetch', '-q');

		expect((await gitStack(repo)).concerns.map(open => open.subject)).toEqual(['one, widened']);
		expect((await gitAction(repo, 'settle')).ok).toBe(true);
		expect(git('log', '--format=%s').split('\n')).toEqual(['one, widened', 'first']);
	});

	test('a pushed commit takes nothing filed into it', async () => {
		await pushedFirst();

		const pushed = git('rev-parse', 'HEAD');

		expect((await gitAction(repo, 'commit', { message: 'first, again', into: pushed })).ok).toBe(false);
		expect((await gitAction(repo, 'settle')).ok).toBe(true);
	});

	test('without an upstream, it starts where the branch left the default base', async () => {
		await firstCommit();
		git('switch', '-q', '-c', 'feature');
		await concern('f.txt', 'feature work');

		const { concerns } = await gitStack(repo);

		expect(concerns.map(open => open.subject)).toEqual(['feature work']);
	});
});
