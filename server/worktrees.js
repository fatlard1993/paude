import { mkdir, readFile, realpath, writeFile } from 'fs/promises';
import os from 'os';
import { basename, dirname, join, relative, sep } from 'path';

import readJsonFile from '../shared/readJsonFile';
import { claimWorktree, forgetWorktree, worktreeClaim } from './projects';
import gitEnvironment from './utils/gitEnvironment';

// paude's own worktrees, when the repo has no command of its own: inside the project, and outside .claude/worktrees,
// which Claude Code keeps for itself and may clean up on its own
export const WORKTREES_DIR = join('.paude', 'worktrees');
const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;
const NESTED_WORKTREE = /(?:^|\/)\.(?:paude|claude)\/worktrees\/([^/]+)/;
// A repo's own setup (installing dependencies, say) can take a while
const COMMAND_TIMEOUT_MS = 20 * 60_000;

export class WorktreeError extends Error {}

export const validWorktreeName = name => NAME.test(name ?? '');

const git = async (args, cwd) => {
	const child = Bun.spawn(['git', ...args], { cwd, env: gitEnvironment(), stdout: 'pipe', stderr: 'pipe' });
	const [out, err, code] = await Promise.all([
		new Response(child.stdout).text(),
		new Response(child.stderr).text(),
		child.exited,
	]);

	return { ok: code === 0, out, err: err.trim() };
};

const contains = (folder, path) => {
	const within = relative(folder, path);

	return within === '' || (!within.startsWith('..') && !within.startsWith(sep));
};

const settingsFile = () =>
	join(process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'), 'paude', 'worktrees.json');

// git@github.com:org/repo.git, https://github.com/org/repo, ssh://git@github.com/org/repo.git: github.com/org/repo
export const normalizeRemote = url =>
	String(url ?? '')
		.trim()
		.replace(/^[a-z+]+:\/\//i, '')
		.replace(/^[^@/]+@/, '')
		.replace(/^([^/:]+):(?!\d)/, '$1/')
		.replace(/\/+$/, '')
		.replace(/\.git$/, '');

// A repo's own way of making and removing worktrees, from ~/.config/paude/worktrees.json, keyed by its remote (so
// one entry serves every machine) or by the main checkout's path:
// { "github.com/org/repo": { "create": "yarn tool workspace create {name}", "remove": "... {name} {path}" } }
export const worktreeSettings = async projectDir => {
	const settings = await readJsonFile(settingsFile(), {}).catch(() => ({}));
	const remote = normalizeRemote((await git(['remote', 'get-url', 'origin'], projectDir)).out);

	return (remote && settings[remote]) || settings[projectDir] || {};
};

const quoted = value => `'${String(value).replace(/'/g, `'\\''`)}'`;
const fill = (command, values) => command.replace(/\{(name|path)\}/g, (match, key) => quoted(values[key] ?? ''));

// Runs a repo's command in its main checkout, passing everything it prints along as it prints it
const runCommand = async (command, cwd, values, onOutput) => {
	const child = Bun.spawn(['sh', '-c', fill(command, values)], {
		cwd,
		env: { ...gitEnvironment(), PAUDE_WORKTREE_NAME: values.name ?? '', PAUDE_WORKTREE_PATH: values.path ?? '' },
		stdout: 'pipe',
		stderr: 'pipe',
		timeout: COMMAND_TIMEOUT_MS,
	});
	let output = '';
	const pass = async stream => {
		const decoder = new TextDecoder();

		for await (const chunk of stream) {
			const text = decoder.decode(chunk, { stream: true });

			output += text;
			onOutput(text);
		}
	};

	await Promise.all([pass(child.stdout), pass(child.stderr)]);

	return { ok: (await child.exited) === 0, output };
};

const listWorktrees = async project => {
	const listed = await git(['worktree', 'list', '--porcelain'], project);
	const found = [];
	let current = null;

	for (const line of `${listed.out}\n`.split('\n')) {
		if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length), branch: null };
		else if (line.startsWith('branch ')) current.branch = line.slice('branch refs/heads/'.length);
		else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
		else if (line === '' && current) {
			if (!current.prunable) found.push(current);
			current = null;
		}
	}

	return found;
};

// The worktree a session's folder is in, by name: one a project claims, or one nested in the project
export const worktreeName = (projectDir, cwd) => {
	const claimed = worktreeClaim(cwd);

	if (claimed) return basename(claimed.path);

	return (projectDir && cwd && relative(projectDir, cwd).split(sep).join('/').match(NESTED_WORKTREE)?.[1]) ?? null;
};

// paude made it, so paude may remove it
const madeByPaude = (project, path) =>
	Boolean(worktreeClaim(path)?.made && worktreeClaim(path).path === path) ||
	(contains(join(project, WORKTREES_DIR), path) && path !== join(project, WORKTREES_DIR));

// The repo's main checkout and every worktree it has, wherever they are, each with its running sessions counted;
// null when the project isn't the top of a git repository
export const checkoutsOf = async (projectDir, runningFolders = []) => {
	const top = await git(['rev-parse', '--show-toplevel'], projectDir);
	const project = await realpath(projectDir).catch(() => projectDir);

	if (!top.ok || top.out.trim() !== project) return null;

	const checkouts = await listWorktrees(project);
	const resolved = await Promise.all(runningFolders.map(cwd => realpath(cwd).catch(() => cwd)));
	// A worktree can sit inside the main checkout, so a session belongs to the deepest checkout holding it
	const ownerOf = cwd =>
		checkouts.filter(({ path }) => contains(path, cwd)).sort((a, b) => b.path.length - a.path.length)[0];
	const active = new Map();

	for (const cwd of resolved) {
		const owner = ownerOf(cwd);

		if (owner) active.set(owner.path, (active.get(owner.path) ?? 0) + 1);
	}

	return checkouts.map(({ path, branch }) => ({
		name: path === project ? null : basename(path),
		path,
		branch,
		main: path === project,
		paude: madeByPaude(project, path),
		active: active.get(path) ?? 0,
	}));
};

// Keeps the main checkout from listing paude's worktrees as untracked files
const excludeWorktrees = async projectDir => {
	const common = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], projectDir);

	if (!common.ok || !common.out.trim()) return;

	const file = join(common.out.trim(), 'info', 'exclude');
	const existing = await readFile(file, 'utf8').catch(() => '');

	if (existing.split('\n').includes('/.paude/')) return;

	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}/.paude/\n`);
};

// With the repo's own create command; the new worktree is whichever one appears, since the command may rename or
// place it as it likes
const createWithCommand = async (project, command, name, onOutput) => {
	const before = new Set((await listWorktrees(project)).map(({ path }) => path));
	const { ok } = await runCommand(command, project, { name }, onOutput);

	if (!ok) throw new WorktreeError("The repo's create command failed; its output is above.");

	const created = (await listWorktrees(project)).filter(({ path }) => !before.has(path));

	if (created.length !== 1)
		throw new WorktreeError("The repo's create command finished, but no new worktree appeared.");

	return created[0].path;
};

// A plain worktree in .paude/worktrees on a new branch of the same name, or on that branch if it exists and is free
const createWithGit = async (project, name, onOutput) => {
	const path = join(project, WORKTREES_DIR, name);

	if (await Bun.file(join(path, '.git')).exists())
		throw new WorktreeError(`There is already a worktree named ${name}; join it instead.`);

	await excludeWorktrees(project);

	const created = await git(['worktree', 'add', '-b', name, path], project);

	if (created.ok) {
		onOutput(created.err ? `${created.err}\n` : '');

		return path;
	}

	const onExisting = await git(['worktree', 'add', path, name], project);

	if (onExisting.ok) return path;

	throw new WorktreeError(onExisting.err || created.err || 'git could not create the worktree.');
};

export const createWorktree = async (projectDir, projectName, name, { onOutput = () => {} } = {}) => {
	if (!validWorktreeName(name))
		throw new WorktreeError('Name it with letters, digits, dots, dashes and underscores (up to 64).');

	const project = await realpath(projectDir).catch(() => projectDir);
	const top = await git(['rev-parse', '--show-toplevel'], project);

	if (!top.ok || top.out.trim() !== project) throw new WorktreeError("This project isn't the top of a git repository.");

	const { create } = await worktreeSettings(project);
	const path = create
		? await createWithCommand(project, create, name, onOutput)
		: await createWithGit(project, name, onOutput);

	await claimWorktree(path, projectName, { made: true });

	return path;
};

// A worktree joined from outside the project folder becomes the project's, so its sessions list with it
export const joinWorktree = (path, projectName) => claimWorktree(path, projectName);

// After a session is deleted: the worktree paude made for it goes too, unless another session (running or saved)
// still uses it. One with uncommitted changes stays; so does its branch, unless the repo's own remove command
// says otherwise.
export const releaseWorktree = async (projectDir, cwd, remainingFolders) => {
	const project = await realpath(projectDir).catch(() => projectDir);
	const checkouts = await checkoutsOf(project);
	const folder = await realpath(cwd).catch(() => cwd);
	const worktree = checkouts?.find(checkout => checkout.paude && contains(checkout.path, folder));

	if (!worktree) return null;

	const remaining = await Promise.all(remainingFolders.map(other => realpath(other).catch(() => other)));

	if (remaining.some(other => contains(worktree.path, other))) return null;

	const kept = why => ({ worktree: worktree.name, removed: false, why });
	const { remove } = await worktreeSettings(project);

	if (remove) {
		const status = await git(['status', '--porcelain'], worktree.path);

		if (!status.ok || status.out.trim()) return kept('it has uncommitted changes.');

		const { ok, output } = await runCommand(remove, project, { name: worktree.name, path: worktree.path }, () => {});

		if (!ok) return kept(`the repo's remove command failed: ${output.trim().split('\n').slice(-3).join(' ')}`);
	} else {
		const removed = await git(['worktree', 'remove', worktree.path], project);

		if (!removed.ok) return kept(removed.err);
	}

	await forgetWorktree(worktree.path);

	return { worktree: worktree.name, removed: true };
};
