import { mkdtemp, realpath } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { beforeEach, expect, test } from 'bun:test';

import gitEnvironment from './utils/gitEnvironment';
import { WorktreeError, checkoutsOf, createWorktree, releaseWorktree, worktreeName } from './worktrees';

let repo;

const git = (args, cwd = repo) => {
	const result = Bun.spawnSync(['git', ...args], { cwd, env: gitEnvironment(), stdout: 'pipe', stderr: 'pipe' });

	if (!result.success) throw new Error(result.stderr.toString());

	return result.stdout.toString().trim();
};

beforeEach(async () => {
	repo = await realpath(await mkdtemp(join(os.tmpdir(), 'paude-worktrees-')));
	git(['init', '-q', '-b', 'main']);
	git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start']);
});

test('a folder outside git has no checkouts; a repo has its main one', async () => {
	expect(await checkoutsOf(await mkdtemp(join(os.tmpdir(), 'paude-plain-')))).toBeNull();
	expect(await checkoutsOf(repo)).toEqual([
		{ name: null, path: repo, branch: 'main', main: true, paude: false, active: 0 },
	]);
});

test('a new worktree lives in .paude/worktrees on its own branch, unseen by the main checkout', async () => {
	const path = await createWorktree(repo, 'login-fix');

	expect(path).toBe(join(repo, '.paude', 'worktrees', 'login-fix'));
	expect(git(['branch', '--show-current'], path)).toBe('login-fix');
	expect(git(['status', '--porcelain'])).toBe('');
	expect(worktreeName(repo, join(path, 'src'))).toBe('login-fix');
	expect(worktreeName(repo, join(repo, 'src'))).toBeNull();
});

test('running sessions are counted in the checkout that holds them, the deepest one', async () => {
	const path = await createWorktree(repo, 'feature');
	const checkouts = await checkoutsOf(repo, [repo, join(repo, 'src'), path, join(path, 'docs')]);

	expect(checkouts.map(({ name, active, paude }) => ({ name, active, paude }))).toEqual([
		{ name: null, active: 2, paude: false },
		{ name: 'feature', active: 2, paude: true },
	]);
});

test('a name that exists, or would be a bad branch name, is refused; an existing free branch is used', async () => {
	await createWorktree(repo, 'feature');

	await expect(createWorktree(repo, 'feature')).rejects.toThrow(WorktreeError);
	await expect(createWorktree(repo, '../escape')).rejects.toThrow(WorktreeError);
	await expect(createWorktree(repo, '')).rejects.toThrow(WorktreeError);

	git(['branch', 'already-there']);
	const path = await createWorktree(repo, 'already-there');

	expect(git(['branch', '--show-current'], path)).toBe('already-there');
});

test("a deleted session's worktree goes when nothing else uses it, stays while something does or it has changes", async () => {
	const used = await createWorktree(repo, 'used');
	const free = await createWorktree(repo, 'free');
	const dirty = await createWorktree(repo, 'dirty');

	await Bun.write(join(dirty, 'notes.txt'), 'work in progress');

	expect(await releaseWorktree(repo, used, [join(used, 'src')])).toBeNull();
	expect(await Bun.file(join(used, '.git')).exists()).toBe(true);

	expect(await releaseWorktree(repo, free, [repo])).toEqual({ worktree: 'free', removed: true });
	expect(await Bun.file(join(free, '.git')).exists()).toBe(false);
	expect(git(['branch', '--list', 'free'])).toContain('free');

	const kept = await releaseWorktree(repo, dirty, []);

	expect(kept).toMatchObject({ worktree: 'dirty', removed: false });
	expect(kept.why).toContain('untracked');
});

test("the main checkout, and worktrees paude didn't make, are never removed", async () => {
	const theirs = join(repo, '.claude', 'worktrees', 'theirs');

	git(['worktree', 'add', '-q', '-b', 'theirs', theirs]);

	expect(await releaseWorktree(repo, repo, [])).toBeNull();
	expect(await releaseWorktree(repo, theirs, [])).toBeNull();
	expect(await Bun.file(join(theirs, '.git')).exists()).toBe(true);
	expect(worktreeName(repo, theirs)).toBe('theirs');
});
