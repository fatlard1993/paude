import { mkdir, mkdtemp, realpath, rm } from 'fs/promises';
import os from 'os';
import { delimiter, join } from 'path';
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { initProjects, listProjects, projectOf, setProjectsRoot } from './projects';
import gitEnvironment from './utils/gitEnvironment';
import {
	WorktreeError,
	checkoutsOf,
	createWorktree,
	joinWorktree,
	normalizeRemote,
	pullRequestStartFiles,
	readOnStart,
	releaseWorktree,
	startFilesWarning,
	startingPoint,
	worktreeName,
	worktreeNameFrom,
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

// The way the product repo's tool lays them out: every workspace in one folder beside the repo
const WORKTREES_FOLDER_CREATE = 'mkdir -p ../app-worktrees && git worktree add -q -b {name} ../app-worktrees/{name}';

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

test("a folder of the project's worktrees beside it isn't listed as a project either", async () => {
	await useWorkspaceTool({ create: WORKTREES_FOLDER_CREATE });

	expect(await createWorktree(repo, 'app', 'feature-a')).toBe(join(root, 'projects', 'app-worktrees', 'feature-a'));
	expect(await listProjects()).toEqual(['app']);
	expect(projectOf(join(root, 'projects', 'app-worktrees', 'feature-a', 'src'))).toBe('app');
});

test('a start is a pull request or a ref, and names its folder', () => {
	expect(startingPoint('#12')).toEqual({ pr: 12 });
	expect(startingPoint(' 12 ')).toEqual({ pr: 12 });
	expect(startingPoint('https://github.com/org/app/pull/34/files')).toEqual({ pr: 34 });
	expect(startingPoint('alice/fix-auth')).toEqual({ ref: 'alice/fix-auth' });
	expect(startingPoint('v1.2.0')).toEqual({ ref: 'v1.2.0' });
	for (const bad of ['', '--force', 'origin/-x', 'a b', 'main..dev', 'HEAD~2', 'x:y'])
		expect(startingPoint(bad)).toBeNull();

	expect(worktreeNameFrom({ pr: 12 })).toBe('pr-12');
	expect(worktreeNameFrom({ ref: 'origin/alice/fix-auth' })).toBe('alice-fix-auth');
	expect(worktreeNameFrom({ ref: '_odd' })).toBe('odd');
});

test('the files Claude Code reads on start are its settings, MCP servers and memory, at any depth', () => {
	for (const file of [
		'.claude/settings.json',
		'.claude/settings.local.json',
		'packages/web/.claude/hooks/start.sh',
		'.mcp.json',
		'tools/.mcp.json',
		'CLAUDE.md',
		'docs/CLAUDE.local.md',
		'src/claude.md',
	])
		expect(readOnStart(file)).toBe(true);
	for (const file of ['README.md', 'src/claude.js', 'claude/settings.json', 'docs/CLAUDE.md.bak', 'my.claude/x'])
		expect(readOnStart(file)).toBe(false);
});

test('the warning names the files, a few at most', () => {
	expect(startFilesWarning(['.claude/settings.json', 'CLAUDE.md'])).toBe(
		'This pull request adds or changes files Claude Code reads and can run on start: .claude/settings.json, CLAUDE.md. Look at them before starting Claude here.',
	);
	expect(startFilesWarning(Array.from({ length: 10 }, (_, index) => `${index}/CLAUDE.md`))).toContain(
		'7/CLAUDE.md, and 2 more.',
	);
});

test("a repo tool's worktree whose start can't be checked out goes again, by its remove command when there is one", async () => {
	// Keyed by the project's folder, with no origin to fetch
	const useWorkspaceTool = async commands => {
		process.env.XDG_CONFIG_HOME = join(root, 'config');
		await mkdir(join(root, 'config', 'paude'), { recursive: true });
		await Bun.write(join(root, 'config', 'paude', 'worktrees.json'), JSON.stringify({ [repo]: commands }));
	};

	await useWorkspaceTool({ create: WORKSPACE_CREATE });
	await expect(createWorktree(repo, 'app', 'nope', { start: startingPoint('nope') })).rejects.toThrow(
		"There's no nope",
	);
	expect(await exists(join(root, 'projects', 'app-ws-nope'))).toBe(false);

	await useWorkspaceTool({
		create: WORKSPACE_CREATE,
		remove: 'git worktree remove --force {path} && touch ../removed',
	});
	await expect(createWorktree(repo, 'app', 'gone', { start: startingPoint('gone') })).rejects.toThrow(
		"There's no gone",
	);
	expect(await exists(join(root, 'projects', 'app-ws-gone'))).toBe(false);
	expect(await Bun.file(join(root, 'projects', 'removed')).exists()).toBe(true);

	await useWorkspaceTool({ create: WORKSPACE_CREATE, remove: 'exit 1' });
	await expect(createWorktree(repo, 'app', 'stuck', { start: startingPoint('stuck') })).rejects.toThrow(
		`The worktree is still at ${join(root, 'projects', 'app-ws-stuck')}.`,
	);
});

describe('a worktree from where someone else is', () => {
	let fix;

	beforeEach(async () => {
		const origin = join(root, 'origin.git');

		git(['init', '-q', '--bare', origin], root);
		git(['remote', 'add', 'origin', origin]);
		git(['push', '-q', 'origin', 'main']);
		git(['switch', '-q', '-c', 'alice/fix']);
		git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '--allow-empty', '-m', 'the fix']);
		fix = git(['rev-parse', 'HEAD']);
		git(['tag', 'v1']);
		git(['push', '-q', 'origin', 'alice/fix', 'v1']);
		git(['switch', '-q', 'main']);
		git(['branch', '-q', '-D', 'alice/fix']);
	});

	test('starts on a branch only origin has, tracking it', async () => {
		const path = await createWorktree(repo, 'app', 'alice-fix', { start: startingPoint('alice/fix') });

		expect(git(['rev-parse', 'HEAD'], path)).toBe(fix);
		expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).toBe('alice/fix');
		expect(git(['rev-parse', '--abbrev-ref', '@{upstream}'], path)).toBe('origin/alice/fix');
	});

	test('starts detached on a tag', async () => {
		const path = await createWorktree(repo, 'app', 'v1', { start: startingPoint('v1') });

		expect(git(['rev-parse', 'HEAD'], path)).toBe(fix);
		expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).toBe('HEAD');
	});

	test('says so, and leaves nothing behind, for a start that is nowhere', async () => {
		await expect(createWorktree(repo, 'app', 'nope', { start: startingPoint('nope') })).rejects.toThrow(
			"There's no nope here or on origin.",
		);
		expect(await exists(join(repo, '.paude', 'worktrees', 'nope'))).toBe(false);
		expect(git(['branch', '--list'])).not.toContain('nope');
	});

	test('starts detached on a branch another checkout has, saying so', async () => {
		let output = '';
		const path = await createWorktree(repo, 'app', 'on-main', {
			start: startingPoint('origin/main'),
			onOutput: text => (output += text),
		});

		expect(git(['rev-parse', 'HEAD'], path)).toBe(git(['rev-parse', 'main']));
		expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], path)).toBe('HEAD');
		expect(output).toContain(`main is checked out in ${repo}, so this worktree is on its commit, detached.`);
	});

	describe('a pull request', () => {
		const commit = (message, files, parent = 'main') => {
			git(['switch', '-q', '--detach', parent]);
			for (const [file, text] of Object.entries(files)) {
				Bun.spawnSync(['mkdir', '-p', join(repo, file, '..')]);
				Bun.spawnSync(['sh', '-c', `printf %s "$1" > "$2"`, 'sh', text, join(repo, file)]);
			}
			git(['add', '-A']);
			git(['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', message]);

			const made = git(['rev-parse', 'HEAD']);

			git(['switch', '-q', 'main']);

			return made;
		};
		const pullRequest = (number, files) => {
			const head = commit(`pr ${number}`, files);

			git(['push', '-q', 'origin', `${head}:refs/pull/${number}/head`]);

			return head;
		};

		const searchPath = process.env.PATH;

		// Pull requests come from GitHub's own refs on origin, as they do where gh isn't installed
		beforeEach(() => {
			process.env.PATH = searchPath
				.split(delimiter)
				.filter(folder => !Bun.spawnSync(['test', '-e', join(folder, 'gh')]).success)
				.join(delimiter);
		});
		afterEach(() => (process.env.PATH = searchPath));

		beforeEach(() => {
			// The repo's own memory and settings, there before any pull request
			const base = commit('base', { 'CLAUDE.md': 'house rules', '.claude/settings.json': '{}' });

			git(['merge', '-q', '--ff-only', base]);
			git(['push', '-q', 'origin', 'main']);
		});

		test('starts on pr-N, naming the files it brings that Claude Code reads on start', async () => {
			const head = pullRequest(7, {
				'.claude/settings.json': '{"hooks":{}}',
				'web/CLAUDE.md': 'more rules',
				'.mcp.json': '{}',
				'src/app.js': 'run()',
			});
			const path = await createWorktree(repo, 'app', 'pr-7', { start: startingPoint('#7') });

			expect(git(['rev-parse', 'HEAD'], path)).toBe(head);
			expect(git(['branch', '--show-current'], path)).toBe('pr-7');
			expect((await pullRequestStartFiles(path, 7)).sort()).toEqual([
				'.claude/settings.json',
				'.mcp.json',
				'web/CLAUDE.md',
			]);
		});

		test("names nothing when it doesn't touch them, though the repo has its own", async () => {
			pullRequest(8, { 'src/app.js': 'run()' });

			expect(await pullRequestStartFiles(await createWorktree(repo, 'app', 'pr-8', { start: { pr: 8 } }), 8)).toEqual(
				[],
			);
		});

		test('reviewed again with its pr-N branch still here, it starts detached on the head', async () => {
			const head = pullRequest(9, { 'src/app.js': 'run()' });
			let output = '';

			await createWorktree(repo, 'app', 'pr-9', { start: { pr: 9 } });
			const again = await createWorktree(repo, 'app', 'pr-9-again', {
				start: { pr: 9 },
				onOutput: text => (output += text),
			});

			expect(git(['rev-parse', 'HEAD'], again)).toBe(head);
			expect(git(['rev-parse', '--abbrev-ref', 'HEAD'], again)).toBe('HEAD');
			expect(output).toContain("There's a pr-9 branch here already");
		});
	});
});
