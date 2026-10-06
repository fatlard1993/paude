import { mkdir, mkdtemp, realpath, rm } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { beforeEach, expect, test } from 'bun:test';

import { initProjects, listProjects, projectOf, setProjectsRoot } from './projects';
import gitEnvironment from './utils/gitEnvironment';
import {
	WorktreeError,
	checkoutsOf,
	createWorktree,
	joinWorktree,
	normalizeRemote,
	releaseWorktree,
	worktreeName,
} from './worktrees';

let root;
let repo;

const git = (args, cwd = repo) => {
	const result = Bun.spawnSync(['git', ...args], { cwd, env: gitEnvironment(), stdout: 'pipe', stderr: 'pipe' });

	if (!result.success) throw new Error(result.stderr.toString());

	return result.stdout.toString().trim();
};

const exists = path => Bun.file(join(path, '.git')).exists();

// The repo's own worktree commands, the way a workspace tool might have them: it prints its setup, renames the
// worktree, and puts it beside the project rather than in it
const useWorkspaceTool = async ({ create, remove }) => {
	process.env.XDG_CONFIG_HOME = join(root, 'config');
	await mkdir(join(root, 'config', 'paude'), { recursive: true });
	await Bun.write(
		join(root, 'config', 'paude', 'worktrees.json'),
		JSON.stringify({ 'example.com/org/app': { create, remove } }),
	);
	if (!git(['remote']).includes('origin')) git(['remote', 'add', 'origin', 'git@example.com:org/app.git']);
};

const WORKSPACE_CREATE =
	'echo setting up {name}; git worktree add -q -b "ws/$PAUDE_WORKTREE_NAME" "../app-ws-$(echo {name} | tr A-Z a-z)" && echo ready';

beforeEach(async () => {
	root = await realpath(await mkdtemp(join(os.tmpdir(), 'paude-worktrees-')));
	repo = join(root, 'projects', 'app');
	await mkdir(repo, { recursive: true });
	delete process.env.XDG_CONFIG_HOME;
	setProjectsRoot(join(root, 'projects'));
	await initProjects(join(root, 'data'));
	git(['init', '-q', '-b', 'main']);
	git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'start']);
});

test('remotes compare the same however they are written', () => {
	for (const remote of [
		'git@github.com:higharc/product.git',
		'https://github.com/higharc/product',
		'ssh://git@github.com/higharc/product.git',
		'https://user@github.com/higharc/product.git/',
	])
		expect(normalizeRemote(remote)).toBe('github.com/higharc/product');
	expect(normalizeRemote('ssh://git@host:2222/org/repo.git')).toBe('host:2222/org/repo');
});

test('a folder outside git has no checkouts', async () => {
	await rm(join(repo, '.git'), { recursive: true });
	expect(await checkoutsOf(repo)).toBeNull();
});

test('without a command of its own, a new worktree is in .paude/worktrees on its own branch, unseen by main', async () => {
	const path = await createWorktree(repo, 'app', 'login-fix');

	expect(path).toBe(join(repo, '.paude', 'worktrees', 'login-fix'));
	expect(git(['branch', '--show-current'], path)).toBe('login-fix');
	expect(git(['status', '--porcelain'])).toBe('');
	expect(worktreeName(repo, join(path, 'src'))).toBe('login-fix');
	expect(worktreeName(repo, join(repo, 'src'))).toBeNull();
});

test('running sessions are counted in the checkout that holds them, the deepest one', async () => {
	const path = await createWorktree(repo, 'app', 'feature');
	const checkouts = await checkoutsOf(repo, [repo, join(repo, 'src'), path, join(path, 'docs')]);

	expect(checkouts.map(({ name, active, paude }) => ({ name, active, paude }))).toEqual([
		{ name: null, active: 2, paude: false },
		{ name: 'feature', active: 2, paude: true },
	]);
});

test('a name that exists, or would be a bad branch name, is refused; an existing free branch is used', async () => {
	await createWorktree(repo, 'app', 'feature');

	await expect(createWorktree(repo, 'app', 'feature')).rejects.toThrow(WorktreeError);
	await expect(createWorktree(repo, 'app', '../escape')).rejects.toThrow(WorktreeError);
	await expect(createWorktree(repo, 'app', '')).rejects.toThrow(WorktreeError);

	git(['branch', 'already-there']);
	expect(git(['branch', '--show-current'], await createWorktree(repo, 'app', 'already-there'))).toBe('already-there');
});

test("a repo with its own create command gets the worktree it makes, wherever it puts it, as the project's", async () => {
	await useWorkspaceTool({ create: WORKSPACE_CREATE });

	let output = '';
	const path = await createWorktree(repo, 'app', 'Login-Fix', { onOutput: text => (output += text) });

	expect(output).toContain('setting up Login-Fix');
	expect(output).toContain('ready');
	expect(path).toBe(join(root, 'projects', 'app-ws-login-fix'));
	expect(git(['branch', '--show-current'], path)).toBe('ws/Login-Fix');
	expect(projectOf(join(path, 'src'))).toBe('app');
	expect(worktreeName(repo, path)).toBe('app-ws-login-fix');
	expect(await listProjects()).toEqual(['app']);
	expect((await checkoutsOf(repo)).find(checkout => checkout.path === path)).toMatchObject({ paude: true });
});

test('a create command that fails, or makes nothing, says so and claims nothing', async () => {
	await useWorkspaceTool({ create: 'echo "no disk"; exit 3' });
	await expect(createWorktree(repo, 'app', 'x')).rejects.toThrow('failed');

	await useWorkspaceTool({ create: 'echo "did nothing"' });
	await expect(createWorktree(repo, 'app', 'x')).rejects.toThrow('no new worktree appeared');
});

test("a deleted session's worktree goes when nothing else uses it, stays while something does or it has changes", async () => {
	const used = await createWorktree(repo, 'app', 'used');
	const free = await createWorktree(repo, 'app', 'free');
	const dirty = await createWorktree(repo, 'app', 'dirty');

	await Bun.write(join(dirty, 'notes.txt'), 'work in progress');

	expect(await releaseWorktree(repo, used, [join(used, 'src')])).toBeNull();
	expect(await exists(used)).toBe(true);

	expect(await releaseWorktree(repo, free, [repo])).toEqual({ worktree: 'free', removed: true });
	expect(await exists(free)).toBe(false);
	expect(git(['branch', '--list', 'free'])).toContain('free');

	const kept = await releaseWorktree(repo, dirty, []);

	expect(kept).toMatchObject({ worktree: 'dirty', removed: false });
	expect(kept.why).toContain('untracked');
});

test("the repo's own remove command takes its worktree away, unless there are changes", async () => {
	await useWorkspaceTool({ create: WORKSPACE_CREATE, remove: 'git worktree remove {path} && echo "removed {name}"' });

	const done = await createWorktree(repo, 'app', 'done');
	const busy = await createWorktree(repo, 'app', 'busy');

	await Bun.write(join(busy, 'draft.txt'), 'unsaved thought');

	expect(await releaseWorktree(repo, done, [])).toEqual({ worktree: 'app-ws-done', removed: true });
	expect(await exists(done)).toBe(false);
	expect(await releaseWorktree(repo, busy, [])).toEqual({
		worktree: 'app-ws-busy',
		removed: false,
		why: 'it has uncommitted changes.',
	});
	expect(await exists(busy)).toBe(true);
});

test("joining a worktree from elsewhere makes it the project's; worktrees paude didn't make are never removed", async () => {
	const theirs = join(root, 'projects', 'app-theirs');

	git(['worktree', 'add', '-q', '-b', 'theirs', theirs]);
	expect(projectOf(theirs)).toBe('app-theirs');

	await joinWorktree(theirs, 'app');

	expect(projectOf(join(theirs, 'src'))).toBe('app');
	expect(await listProjects()).toEqual(['app']);
	expect(await releaseWorktree(repo, theirs, [])).toBeNull();
	expect(await releaseWorktree(repo, repo, [])).toBeNull();
	expect(await exists(theirs)).toBe(true);
});
