import { mkdir, readFile, realpath, writeFile } from 'fs/promises';
import { basename, dirname, join, relative, sep } from 'path';

import readJsonFile from '../shared/readJsonFile';
import { gh, hasGh } from './gh';
import { claimWorktree, forgetWorktree, worktreeClaim } from './projects';
import { configFile } from './serverSettings';
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

const settingsFile = () => configFile('worktrees.json');

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

// A plain worktree in .paude/worktrees on a new branch of the same name, or on that branch if it exists and is free.
// One that's moved onto a start of its own begins detached, so no branch is made only to be left behind.
const createWithGit = async (project, name, onOutput, { detached = false } = {}) => {
	const path = join(project, WORKTREES_DIR, name);

	if (await Bun.file(join(path, '.git')).exists())
		throw new WorktreeError(`There is already a worktree named ${name}; join it instead.`);

	await excludeWorktrees(project);

	if (detached) {
		const added = await git(['worktree', 'add', '--detach', path], project);

		if (!added.ok) throw new WorktreeError(added.err || 'git could not create the worktree.');

		return path;
	}

	const created = await git(['worktree', 'add', '-b', name, path], project);

	if (created.ok) {
		onOutput(created.err ? `${created.err}\n` : '');

		return path;
	}

	const onExisting = await git(['worktree', 'add', path, name], project);

	if (onExisting.ok) return path;

	throw new WorktreeError(onExisting.err || created.err || 'git could not create the worktree.');
};

// Where a worktree starts, from what someone typed: a pull request (#12, 12, or its URL) or a ref (a branch here or on
// origin, a tag, a commit); null when it can't be either
export const startingPoint = from => {
	const text = String(from ?? '').trim();
	const pr = text.match(/^#?(\d+)$/) ?? text.match(/^https?:\/\/\S+\/pull\/(\d+)(?:[/?#]\S*)?$/);

	if (pr) return { pr: Number(pr[1]) };
	if (!text || text.length > 200 || /^(?:origin\/)?-/.test(text) || /[\s~^:?*[\\]|\.\.|@\{/.test(text)) return null;

	return { ref: text };
};

// A folder name from where it starts: pr-12, or the branch with its slashes as dashes
export const worktreeNameFrom = start =>
	(start.pr
		? `pr-${start.pr}`
		: start.ref
				.replace(/^origin\//, '')
				.replace(/[^\w.-]+/g, '-')
				.replace(/^[^A-Za-z0-9]+/, '')
				.slice(0, 64)) || 'review';

const exists = async (ref, cwd) => (await git(['rev-parse', '--verify', '-q', ref], cwd)).ok;

const say = (onOutput, { out, err }) => onOutput([out.trim(), err].filter(Boolean).join('\n') + '\n');

// A pull request as gh checks it out (a fork's branch included, and set up to push back where gh can), or, without
// gh, GitHub's own ref for it on origin, on a pr-N branch unless an earlier review has that name
const checkOutPullRequest = async (path, number, onOutput) => {
	if (hasGh()) {
		const result = await gh(['pr', 'checkout', String(number)], path);

		say(onOutput, result);
		if (result.code !== 0) throw new WorktreeError(result.err || `gh could not check out #${number}`);

		return;
	}

	const fetched = await git(['fetch', 'origin', `pull/${number}/head`], path);

	if (!fetched.ok) throw new WorktreeError(fetched.err || `origin has no pull request #${number}`);

	const branch = `pr-${number}`;

	if (await exists(`refs/heads/${branch}`, path)) {
		const detached = await git(['switch', '--detach', 'FETCH_HEAD'], path);

		if (!detached.ok) throw new WorktreeError(detached.err);
		onOutput(`There's a ${branch} branch here already, so this worktree is on the pull request's commit, detached.\n`);

		return;
	}

	const switched = await git(['switch', '-c', branch, 'FETCH_HEAD'], path);

	if (!switched.ok) throw new WorktreeError(switched.err);
};

// A ref, as fresh as origin has it: a branch here (brought up to its upstream when that's only ahead), a branch on
// origin (tracked by one of the same name here), or anything else git can find a commit by, detached. A branch
// another checkout has is detached at its commit too, since git won't check out one branch twice.
const checkOutRef = async (path, ref, onOutput) => {
	if ((await git(['remote'], path)).out.split('\n').includes('origin')) {
		const fetched = await git(['fetch', '--quiet', 'origin'], path);

		if (!fetched.ok) onOutput(`Could not fetch origin, so this is what was here already: ${fetched.err}\n`);
	}

	const branch = ref.replace(/^origin\//, '');
	let switched;

	if (branch.startsWith('-')) throw new WorktreeError(`${ref} can't be a branch name.`);

	if (await exists(`refs/heads/${branch}`, path)) {
		const elsewhere = (await listWorktrees(path)).find(other => other.branch === branch);
		const upstream = `${branch}@{upstream}`;

		if (elsewhere) {
			const behind =
				(await exists(upstream, path)) && (await git(['merge-base', '--is-ancestor', branch, upstream], path)).ok;

			switched = await git(['switch', '--detach', behind ? upstream : `refs/heads/${branch}`], path);
			if (switched.ok)
				onOutput(`${branch} is checked out in ${elsewhere.path}, so this worktree is on its commit, detached.\n`);
		} else {
			switched = await git(['switch', branch], path);
			if (switched.ok && (await exists('@{upstream}', path)))
				await git(['merge', '--ff-only', '-q', '@{upstream}'], path);
		}
	} else if (await exists(`refs/remotes/origin/${branch}`, path))
		switched = await git(['switch', '--track', '-c', branch, `origin/${branch}`], path);
	else if (await exists(`${ref}^{commit}`, path)) switched = await git(['switch', '--detach', ref], path);
	else throw new WorktreeError(`There's no ${ref} here or on origin.`);

	if (!switched.ok) throw new WorktreeError(switched.err);
	say(onOutput, switched);
};

const checkOutStart = (path, start, onOutput) =>
	start.pr ? checkOutPullRequest(path, start.pr, onOutput) : checkOutRef(path, start.ref, onOutput);

// `start`, from startingPoint, puts the new worktree on someone's branch or pull request rather than a branch of its own
export const createWorktree = async (projectDir, projectName, name, { start, onOutput = () => {} } = {}) => {
	if (!validWorktreeName(name))
		throw new WorktreeError('Name it with letters, digits, dots, dashes and underscores (up to 64).');

	const project = await realpath(projectDir).catch(() => projectDir);
	const top = await git(['rev-parse', '--show-toplevel'], project);

	if (!top.ok || top.out.trim() !== project) throw new WorktreeError("This project isn't the top of a git repository.");

	const { create, remove } = await worktreeSettings(project);
	const path = create
		? await createWithCommand(project, create, name, onOutput)
		: await createWithGit(project, name, onOutput, { detached: Boolean(start) });

	if (start) {
		try {
			await checkOutStart(path, start, onOutput);
		} catch (error) {
			// The worktree goes again, by the repo's own remove command when it has one
			const removed = remove
				? (await runCommand(remove, project, { name: basename(path), path }, () => {})).ok
				: (await git(['worktree', 'remove', '--force', path], project)).ok;

			if (!removed && error instanceof WorktreeError) error.message += ` The worktree is still at ${path}.`;
			throw error;
		}
	}

	await claimWorktree(path, projectName, { made: true });

	return path;
};

// What Claude Code reads by itself when it starts in a folder, and can run things from: settings with their hooks and
// anything else under a .claude folder, MCP servers in .mcp.json, and memory in CLAUDE.md or CLAUDE.local.md, at
// any depth. Without regard to case, as a Mac's disk reads them.
const READ_ON_START = new Set(['.claude', '.mcp.json', 'claude.md', 'claude.local.md']);

export const readOnStart = file => {
	const parts = file.toLowerCase().split('/');

	return parts.slice(0, -1).includes('.claude') || READ_ON_START.has(parts.at(-1));
};

// The branch a pull request goes into, as origin has it now; without gh, origin's default branch
const pullRequestBase = async (path, number) => {
	const asked = hasGh()
		? await gh(['pr', 'view', String(number), '--json', 'baseRefName', '--jq', '.baseRefName'], path).catch(() => null)
		: null;
	const branch = asked?.code === 0 ? asked.out.trim() : '';
	const candidates = ['refs/remotes/origin/HEAD', 'refs/remotes/origin/main', 'refs/remotes/origin/master'];

	if (branch && !branch.startsWith('-')) {
		await git(['fetch', '--quiet', 'origin', branch], path);
		candidates.unshift(`refs/remotes/origin/${branch}`);
	}

	for (const ref of candidates) if (await exists(ref, path)) return ref;

	return null;
};

// The files Claude Code would read on start that a pull request, checked out at `path`, adds or changes since it
// left its base; every such file it has when there's no base to tell by
export const pullRequestStartFiles = async (path, number) => {
	const base = await pullRequestBase(path, number);
	const since = base ? await git(['merge-base', 'HEAD', base], path) : null;
	const changed = since?.ok
		? await git(['diff', '--name-only', '-z', '--no-renames', '--diff-filter=ACMRT', since.out.trim(), 'HEAD'], path)
		: null;
	const listed = changed?.ok ? changed : await git(['ls-tree', '-r', '-z', '--name-only', 'HEAD'], path);

	return listed.out.split('\0').filter(file => file && readOnStart(file));
};

const SHOWN_FILES = 8;

export const startFilesWarning = files =>
	`This pull request adds or changes files Claude Code reads and can run on start: ${files.slice(0, SHOWN_FILES).join(', ')}${
		files.length > SHOWN_FILES ? `, and ${files.length - SHOWN_FILES} more` : ''
	}. Look at them before starting Claude here.`;

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
