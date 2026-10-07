import { isSecret } from './files';
import gitEnvironment from './utils/gitEnvironment';

// The Git panel's view of a session's checkout and what it can do there. Paths are relative to the repository's top
// level. A command that fails resolves to git's own words, to show as they are.
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_PATCH_BYTES = 1024 * 1024;
const LOG_PAGE = 50;
const NETWORK_TIMEOUT_MS = 120_000;
const LOCAL_TIMEOUT_MS = 30_000;
const UNIT = '\x1f';
const RECORD = '\x1e';

export class GitError extends Error {}

// Never waits on a prompt nobody can answer: no password, passphrase or host-key question
const environment = () => ({
	...gitEnvironment(),
	GIT_TERMINAL_PROMPT: '0',
	GIT_SSH_COMMAND: process.env.GIT_SSH_COMMAND ?? 'ssh -o BatchMode=yes',
	GIT_EDITOR: 'true',
});

const run = async (args, cwd, { input, timeout = LOCAL_TIMEOUT_MS } = {}) => {
	const child = Bun.spawn(['git', ...args], {
		cwd,
		env: environment(),
		stdin: input === undefined ? 'ignore' : new TextEncoder().encode(input),
		stdout: 'pipe',
		stderr: 'pipe',
		timeout,
	});
	const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

	return { code: await child.exited, out, err };
};

const refused = (args, { out, err }) => new GitError((err || out).trim() || `git ${args[0]} failed`);

// What a reading command prints, for a command that has to work; its complaint as a GitError otherwise
const must = async (args, cwd, options) => {
	const result = await run(args, cwd, options);

	if (result.code !== 0) throw refused(args, result);

	return result.out;
};

// An action's whole report, progress and all (git writes much of it to stderr), or its complaint as a GitError
const act = async (args, cwd, options) => {
	const result = await run(args, cwd, options);

	if (result.code !== 0) throw refused(args, result);

	return `${result.out}${result.err}`;
};

// The top of the repository a session works in; null outside git
export const repoRoot = async cwd => {
	const { code, out } = await run(['rev-parse', '--show-toplevel'], cwd);

	return code === 0 ? out.trim() : null;
};

const STATUS = { M: 'modified', A: 'added', D: 'deleted', R: 'renamed', C: 'copied', T: 'modified', U: 'conflicted' };

// `git status --porcelain=v2 -z --branch` as { branch, detached, upstream, ahead, behind, staged, unstaged,
// untracked, conflicted }
export const parseStatus = text => {
	const fields = text.split('\0');
	const status = {
		branch: null,
		detached: false,
		upstream: null,
		ahead: 0,
		behind: 0,
		staged: [],
		unstaged: [],
		untracked: [],
		conflicted: [],
	};

	for (let index = 0; index < fields.length; index++) {
		const field = fields[index];

		if (field.startsWith('# branch.head ')) {
			const head = field.slice('# branch.head '.length);

			status.detached = head === '(detached)';
			status.branch = status.detached ? null : head;
		} else if (field.startsWith('# branch.upstream ')) status.upstream = field.slice('# branch.upstream '.length);
		else if (field.startsWith('# branch.ab ')) {
			const [, ahead, behind] = /\+(\d+) -(\d+)/.exec(field) ?? [];

			status.ahead = Number(ahead ?? 0);
			status.behind = Number(behind ?? 0);
		} else if (field.startsWith('1 ') || field.startsWith('2 ')) {
			const parts = field.split(' ');
			const [staged, unstaged] = parts[1];
			const renamed = field.startsWith('2 ');
			const path = parts.slice(renamed ? 9 : 8).join(' ');
			const from = renamed ? fields[++index] : undefined;

			if (staged !== '.') status.staged.push({ path, status: STATUS[staged] ?? 'modified', ...(from && { from }) });
			if (unstaged !== '.') status.unstaged.push({ path, status: STATUS[unstaged] ?? 'modified' });
		} else if (field.startsWith('u ')) status.conflicted.push({ path: field.split(' ').slice(10).join(' ') });
		else if (field.startsWith('? ')) status.untracked.push({ path: field.slice(2), status: 'untracked' });
	}

	const shown = ({ path }) => !isSecret(path);

	return {
		...status,
		staged: status.staged.filter(shown),
		unstaged: status.unstaged.filter(shown),
		untracked: status.untracked.filter(shown),
		conflicted: status.conflicted.filter(shown),
	};
};

const exists = async path => Bun.file(path).exists();

// A merge, rebase or cherry-pick left half done, which the panel says rather than hides
const operationInProgress = async root => {
	const gitDir = (await must(['rev-parse', '--absolute-git-dir'], root)).trim();

	if (await exists(`${gitDir}/MERGE_HEAD`)) return 'merging';
	if ((await exists(`${gitDir}/rebase-merge/head-name`)) || (await exists(`${gitDir}/rebase-apply/head-name`)))
		return 'rebasing';
	if (await exists(`${gitDir}/CHERRY_PICK_HEAD`)) return 'cherry-picking';

	return null;
};

export const gitStatus = async root => {
	const [text, stashes, inProgress, head] = await Promise.all([
		must(['status', '--porcelain=v2', '-z', '--branch', '--untracked-files=all'], root),
		run(['stash', 'list'], root),
		operationInProgress(root),
		run(['rev-parse', '--verify', '-q', 'HEAD'], root),
	]);

	return {
		...parseStatus(text),
		stashes: stashes.out.split('\n').filter(Boolean).length,
		inProgress,
		hasCommits: head.code === 0,
	};
};

// Newest first, a page at a time: [{ hash, short, parents, author, date, refs, subject }]. `path` narrows it to the
// commits that touched one file, following it through renames.
export const gitLog = async (root, { ref, path, skip = 0, limit = LOG_PAGE } = {}) => {
	const { code, out } = await run(
		[
			'log',
			`--format=%H${UNIT}%h${UNIT}%P${UNIT}%an${UNIT}%aI${UNIT}%D${UNIT}%s${RECORD}`,
			`--skip=${Math.max(0, Number(skip) || 0)}`,
			`--max-count=${Math.min(Math.max(1, Number(limit) || LOG_PAGE), 200)}`,
			...(ref ? [ref] : []),
			...(path ? ['--follow', '--', path] : []),
		],
		root,
	);

	if (code !== 0) return [];

	return out
		.split(RECORD)
		.map(record => record.trim())
		.filter(Boolean)
		.map(record => {
			const [hash, short, parents, author, date, refs, subject] = record.split(UNIT);

			return {
				hash,
				short,
				parents: parents ? parents.split(' ') : [],
				author,
				date,
				refs: refs ? refs.split(', ') : [],
				subject,
			};
		});
};

const PATCH_STATUS = [
	[/^new file mode/m, 'added'],
	[/^deleted file mode/m, 'deleted'],
	[/^rename from/m, 'renamed'],
	[/^copy from/m, 'copied'],
];

// A patch of several files as the diff view's files: [{ path, from, status, diff }]
export const splitPatch = text =>
	text
		.split(/^(?=diff --git )/m)
		.filter(chunk => chunk.startsWith('diff --git '))
		.map(diff => {
			const [, a, b] = /^diff --git a\/(.*) b\/(.*)$/m.exec(diff) ?? [];
			const renamedFrom = /^rename from (.*)$/m.exec(diff)?.[1];
			const status = PATCH_STATUS.find(([pattern]) => pattern.test(diff))?.[1] ?? 'modified';

			return { path: b ?? a, ...(renamedFrom && { from: renamedFrom }), status, diff };
		})
		.filter(({ path }) => path && !isSecret(path));

const hashOf = async (root, ref) => {
	if (typeof ref !== 'string' || ref.startsWith('-')) throw new GitError('That is not a commit');

	return (await must(['rev-parse', '--verify', '-q', `${ref}^{commit}`], root)).trim();
};

// One commit as the diff view shows any set: { title, body, author, date, files }
export const gitCommit = async (root, ref) => {
	const hash = await hashOf(root, ref);
	const [subject, body, author, date, short] = (
		await must(['show', '-s', `--format=%s${UNIT}%b${UNIT}%an${UNIT}%aI${UNIT}%h`, hash], root)
	).split(UNIT);
	let patch = await must(['show', '--format=', '--no-color', '--find-renames', '--first-parent', hash], root);

	if (patch.length > MAX_PATCH_BYTES) patch = patch.slice(0, MAX_PATCH_BYTES);

	return { hash, short, title: subject, body: body.trim(), author, date: date.trim(), files: splitPatch(patch) };
};

// { current, local: [{ name, upstream, ahead, behind, date, subject }], remote: [name] }
export const gitBranches = async root => {
	const [locals, remotes, current] = await Promise.all([
		must(
			[
				'for-each-ref',
				`--format=%(refname:short)${UNIT}%(upstream:short)${UNIT}%(upstream:track,nobracket)${UNIT}%(committerdate:iso-strict)${UNIT}%(contents:subject)`,
				'--sort=-committerdate',
				'refs/heads',
			],
			root,
		),
		must(['for-each-ref', '--format=%(refname:short)', 'refs/remotes'], root),
		run(['branch', '--show-current'], root),
	]);

	return {
		current: current.out.trim() || null,
		local: locals
			.split('\n')
			.filter(Boolean)
			.map(line => {
				const [name, upstream, track, date, subject] = line.split(UNIT);

				return {
					name,
					upstream: upstream || null,
					ahead: Number(/ahead (\d+)/.exec(track)?.[1] ?? 0),
					behind: Number(/behind (\d+)/.exec(track)?.[1] ?? 0),
					gone: track === 'gone',
					date,
					subject,
				};
			}),
		remote: remotes.split('\n').filter(name => name && !name.endsWith('/HEAD')),
	};
};

// [{ ref, subject, date }]
export const gitStashes = async root =>
	(await run(['stash', 'list', `--format=%gd${UNIT}%s${UNIT}%cI`], root)).out
		.split('\n')
		.filter(Boolean)
		.map(line => {
			const [ref, subject, date] = line.split(UNIT);

			return { ref, subject, date };
		});

// Who last changed each line of a file: [{ line, hash, short, author, date, summary }]
export const gitBlame = async (root, path) => {
	if (typeof path !== 'string' || !path || path.startsWith('-') || isSecret(path)) throw new GitError('No such file');

	const out = await must(['blame', '--porcelain', '--', path], root);
	const commits = new Map();
	const lines = [];
	let current = null;

	for (const row of out.split('\n')) {
		const header = /^([0-9a-f]{40}) \d+ (\d+)/.exec(row);

		if (header) {
			const hash = header[1];

			if (!commits.has(hash)) commits.set(hash, { hash, short: hash.slice(0, 7) });
			current = { line: Number(header[2]), commit: commits.get(hash) };
			lines.push(current);
		} else if (current && row.startsWith('author ')) current.commit.author = row.slice(7);
		else if (current && row.startsWith('author-time '))
			current.commit.date = new Date(Number(row.slice(12)) * 1000).toISOString();
		else if (current && row.startsWith('summary ')) current.commit.summary = row.slice(8);
	}

	return lines.map(({ line, commit }) => ({ line, ...commit }));
};

// The branch work is compared with: the remote's default (origin/HEAD), else a main or master that exists
export const defaultBase = async root => {
	const remoteHead = await run(['symbolic-ref', '--short', '-q', 'refs/remotes/origin/HEAD'], root);

	if (remoteHead.code === 0 && remoteHead.out.trim()) return remoteHead.out.trim();

	for (const candidate of ['origin/main', 'origin/master', 'main', 'master'])
		if ((await run(['rev-parse', '--verify', '-q', candidate], root)).code === 0) return candidate;

	return null;
};

// What this branch adds to the base: its commits, and its changes as the diff view's files (since they parted)
export const gitCompare = async (root, { base } = {}) => {
	const against = base || (await defaultBase(root));

	if (!against || against.startsWith('-')) throw new GitError('There is no branch to compare with');

	let patch = await must(['diff', '--no-color', '--find-renames', `${against}...HEAD`], root);

	if (patch.length > MAX_PATCH_BYTES) patch = patch.slice(0, MAX_PATCH_BYTES);

	return { base: against, commits: await gitLog(root, { ref: `${against}..HEAD` }), files: splitPatch(patch) };
};

// Paths an action names: each a string inside the repository, never an option
const cleanPaths = paths => {
	if (!Array.isArray(paths) || !paths.length) throw new GitError('Name the files');
	if (paths.some(path => typeof path !== 'string' || !path || path.startsWith('-') || path.includes('\0')))
		throw new GitError('Those are not files here');

	return paths;
};

const cleanName = name => {
	if (typeof name !== 'string' || !name.trim() || name.startsWith('-')) throw new GitError('Give it a name');

	return name.trim();
};

const output = text => text.slice(-MAX_OUTPUT_BYTES).trim();

const hasUpstream = async root =>
	(await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root)).code === 0;

// What the panel can do, each resolving to git's output; a GitError carries what git said when it refused
const ACTIONS = {
	stage: (root, { paths, all }) => (all ? act(['add', '-A'], root) : act(['add', '--', ...cleanPaths(paths)], root)),
	unstage: async (root, { paths, all }) => {
		const named = all ? [] : cleanPaths(paths);

		// With no commit yet there's nothing to restore from: unstaging is taking them out of the index
		if ((await run(['rev-parse', '--verify', '-q', 'HEAD'], root)).code !== 0)
			return act(['rm', '-r', '--cached', '-q', '--', ...(all ? ['.'] : named)], root);

		return act(['restore', '--staged', '--', ...(all ? ['.'] : named)], root);
	},
	// Back to the last commit: a tracked file's unstaged edits undone, an untracked file deleted
	discard: async (root, { paths }) => {
		const named = cleanPaths(paths);
		const untracked = new Set(
			(await must(['ls-files', '--others', '--exclude-standard', '-z', '--', ...named], root))
				.split('\0')
				.filter(Boolean),
		);
		const tracked = named.filter(path => !untracked.has(path));

		if (tracked.length) await act(['restore', '--worktree', '--', ...tracked], root);
		if (untracked.size) await act(['clean', '-f', '-q', '--', ...untracked], root);

		return '';
	},
	commit: async (root, { message, amend }) => {
		if (typeof message !== 'string' || !message.trim()) {
			if (!amend) throw new GitError('Write a message for the commit');

			return act(['commit', '--amend', '--no-edit'], root);
		}

		return act(['commit', ...(amend ? ['--amend'] : []), '-F', '-'], root, { input: message.trim() });
	},
	switch: (root, { branch }) => act(['switch', cleanName(branch)], root),
	createBranch: (root, { name, from }) =>
		act(['switch', '-c', cleanName(name), ...(from ? [cleanName(from)] : [])], root),
	// Only a branch whose work is merged somewhere; git refuses otherwise and says why
	deleteBranch: (root, { name }) => act(['branch', '-d', cleanName(name)], root),
	fetch: root => act(['fetch', '--all', '--prune'], root, { timeout: NETWORK_TIMEOUT_MS }),
	// Fast-forward only: anything that would need a merge is git's to explain and a person's to decide
	pull: root => act(['pull', '--ff-only'], root, { timeout: NETWORK_TIMEOUT_MS }),
	push: async root =>
		(await hasUpstream(root))
			? act(['push'], root, { timeout: NETWORK_TIMEOUT_MS })
			: act(['push', '--set-upstream', 'origin', 'HEAD'], root, { timeout: NETWORK_TIMEOUT_MS }),
	// A conflicted file settled with one side's version, and marked resolved
	resolve: async (root, { path, side }) => {
		const [file] = cleanPaths([path]);

		if (!['ours', 'theirs'].includes(side)) throw new GitError('Keep ours or theirs');
		await act(['checkout', `--${side}`, '--', file], root);

		return act(['add', '--', file], root);
	},
	// The merge, rebase or cherry-pick half done: carried on (its conflicts resolved) or given up
	continue: async root => {
		const doing = await operationInProgress(root);

		if (!doing) throw new GitError('Nothing is half done');

		return act([{ merging: 'merge', rebasing: 'rebase', 'cherry-picking': 'cherry-pick' }[doing], '--continue'], root);
	},
	abort: async root => {
		const doing = await operationInProgress(root);

		if (!doing) throw new GitError('Nothing is half done');

		return act([{ merging: 'merge', rebasing: 'rebase', 'cherry-picking': 'cherry-pick' }[doing], '--abort'], root);
	},
	stash: (root, { message }) =>
		act(['stash', 'push', '--include-untracked', ...(message ? ['-m', String(message)] : [])], root),
	unstash: (root, { ref }) => act(['stash', 'pop', ...(ref ? [cleanName(ref)] : [])], root),
	dropStash: (root, { ref }) => act(['stash', 'drop', cleanName(ref)], root),
};

export const GIT_ACTIONS = Object.keys(ACTIONS);

// Runs one, resolving to { ok, output }: git's own words either way, for the panel to show
export const gitAction = async (root, action, options = {}) => {
	if (!Object.hasOwn(ACTIONS, action)) throw new GitError('Unknown git action');

	try {
		return { ok: true, output: output((await ACTIONS[action](root, options)) ?? '') };
	} catch (error) {
		if (error instanceof GitError) return { ok: false, output: output(error.message) };
		throw error;
	}
};
