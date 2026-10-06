import { mkdir, readFile, realpath, writeFile } from 'fs/promises';
import { basename, dirname, join, relative, sep } from 'path';

// paude's own worktrees: inside the project, so their sessions are the project's, and outside .claude/worktrees,
// which Claude Code keeps for itself and may clean up on its own
export const WORKTREES_DIR = join('.paude', 'worktrees');
const NAME = /^[A-Za-z0-9][\w.-]{0,63}$/;
const NESTED_WORKTREE = /(?:^|\/)\.(?:paude|claude)\/worktrees\/([^/]+)/;

export class WorktreeError extends Error {}

const git = async (args, cwd) => {
	const child = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe' });
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

// The worktree a session's folder is in, by name, when it's one nested in the project (paude's or Claude Code's)
export const worktreeName = (projectDir, cwd) =>
	(projectDir && cwd && relative(projectDir, cwd).split(sep).join('/').match(NESTED_WORKTREE)?.[1]) ?? null;

// The project's main checkout and the worktrees inside it, each with its running sessions counted; null when the
// project isn't the top of a git repository
export const checkoutsOf = async (projectDir, runningFolders = []) => {
	const top = await git(['rev-parse', '--show-toplevel'], projectDir);
	const project = await realpath(projectDir).catch(() => projectDir);

	if (!top.ok || top.out.trim() !== project) return null;

	const listed = await git(['worktree', 'list', '--porcelain'], project);
	const checkouts = [];
	let current = null;

	for (const line of `${listed.out}\n`.split('\n')) {
		if (line.startsWith('worktree ')) current = { path: line.slice('worktree '.length), branch: null };
		else if (line.startsWith('branch ')) current.branch = line.slice('branch refs/heads/'.length);
		else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true;
		else if (line === '' && current) {
			if (!current.prunable && contains(project, current.path)) checkouts.push(current);
			current = null;
		}
	}

	const resolved = await Promise.all(runningFolders.map(cwd => realpath(cwd).catch(() => cwd)));
	// A worktree sits inside the main checkout, so a session belongs to the deepest checkout holding it
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
		paude: contains(join(project, WORKTREES_DIR), path) && path !== join(project, WORKTREES_DIR),
		active: active.get(path) ?? 0,
	}));
};

// Keeps the main checkout from listing paude's worktrees as untracked files
const excludeWorktrees = async projectDir => {
	const { out } = await git(['rev-parse', '--path-format=absolute', '--git-common-dir'], projectDir);
	const file = join(out.trim(), 'info', 'exclude');
	const existing = await readFile(file, 'utf8').catch(() => '');

	if (existing.split('\n').includes('/.paude/')) return;

	await mkdir(dirname(file), { recursive: true });
	await writeFile(file, `${existing}${existing && !existing.endsWith('\n') ? '\n' : ''}/.paude/\n`);
};

// A new worktree on a new branch of the same name, or on that branch if it exists and is free
export const createWorktree = async (projectDir, name) => {
	if (!NAME.test(name ?? ''))
		throw new WorktreeError('Name it with letters, digits, dots, dashes and underscores (up to 64).');

	const path = join(projectDir, WORKTREES_DIR, name);

	if (await Bun.file(join(path, '.git')).exists())
		throw new WorktreeError(`There is already a worktree named ${name}; join it instead.`);

	await excludeWorktrees(projectDir);

	const created = await git(['worktree', 'add', '-b', name, path], projectDir);

	if (created.ok) return path;

	const onExisting = await git(['worktree', 'add', path, name], projectDir);

	if (onExisting.ok) return path;

	throw new WorktreeError(onExisting.err || created.err || 'git could not create the worktree.');
};

// After a session is deleted: the paude worktree it was in goes too, unless another session (running or saved)
// still uses it. git refuses to remove one with changes, which keeps them; the branch always stays.
export const releaseWorktree = async (projectDir, cwd, remainingFolders) => {
	const checkouts = await checkoutsOf(projectDir);
	const project = await realpath(projectDir).catch(() => projectDir);
	const folder = await realpath(cwd).catch(() => cwd);
	const worktree = checkouts?.find(checkout => checkout.paude && contains(checkout.path, folder));

	if (!worktree) return null;

	const remaining = await Promise.all(remainingFolders.map(other => realpath(other).catch(() => other)));

	if (remaining.some(other => contains(worktree.path, other))) return null;

	const removed = await git(['worktree', 'remove', worktree.path], project);

	return removed.ok
		? { worktree: worktree.name, removed: true }
		: { worktree: worktree.name, removed: false, why: removed.err };
};
