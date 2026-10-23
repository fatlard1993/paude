import { constants } from 'fs';
import { copyFile, mkdtemp, open, realpath, rm, stat } from 'fs/promises';
import os from 'os';
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from 'path';

import { remapLines } from '../shared/diff';
import { isSecret } from './files';
import gitEnvironment from './utils/gitEnvironment';

// The Git panel's view of a session's checkout and what it can do there. Paths are relative to the repository's top
// level. A command that fails resolves to git's own words, to show as they are.
const MAX_OUTPUT_BYTES = 256 * 1024;
const MAX_PATCH_BYTES = 1024 * 1024;
const LOG_PAGE = 50;
// New files a branch diff with its uncommitted work shows, at most, and the size past which one is only named
const MAX_UNTRACKED = 200;
const MAX_UNTRACKED_BYTES = 512 * 1024;
// A file kept as a blob for a comment's lines, at most
const MAX_BLOB_BYTES = 4 * 1024 * 1024;
// Paths named to one git command at a time
const PATHS_AT_ONCE = 500;
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

// Paths as they are, not quoted and escaped (which splitPatch can't read) when they aren't plain ASCII
// What a command prints, up to `limit` bytes, past which it is stopped (`cut`)
const readUpTo = async (child, limit) => {
	if (!limit) return { text: await new Response(child.stdout).text(), cut: false };

	const reader = child.stdout.getReader();
	const chunks = [];
	let size = 0;

	while (size < limit) {
		const { done, value } = await reader.read();

		if (done) return { text: Buffer.concat(chunks).toString(), cut: false };
		chunks.push(value);
		size += value.length;
	}

	await reader.cancel();
	child.kill();

	return { text: Buffer.concat(chunks).subarray(0, limit).toString(), cut: true };
};

const run = async (args, cwd, { input, timeout = LOCAL_TIMEOUT_MS, env, limit } = {}) => {
	const child = Bun.spawn(['git', '-c', 'core.quotePath=false', ...args], {
		cwd,
		env: { ...environment(), ...env },
		stdin: typeof input === 'string' ? new TextEncoder().encode(input) : (input ?? 'ignore'),
		stdout: 'pipe',
		stderr: 'pipe',
		timeout,
	});
	const [{ text: out, cut }, err] = await Promise.all([readUpTo(child, limit), new Response(child.stderr).text()]);
	const code = await child.exited;

	return { code: cut ? 0 : code, out, err };
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

const folderPrefix = async cwd => {
	const { code, out } = await run(['rev-parse', '--show-prefix'], cwd);

	return code === 0 ? out.trim() : '';
};

// Paths git names from the top of the repository, named from a folder in it instead (`../` for one outside it)
export const pathsFromFolder = async cwd => {
	const prefix = await folderPrefix(cwd);

	return file => (prefix ? posix.relative(prefix, file) : file);
};

// And back: paths named from a folder in the repository, as git names them from its top
export const pathsFromTop = async cwd => {
	const prefix = await folderPrefix(cwd);

	return file => posix.normalize(posix.join(prefix, file));
};

// The commit checked out where a session works; undefined outside git or before the first commit
export const headCommit = async cwd => {
	const { code, out } = await run(['rev-parse', '--verify', '-q', 'HEAD'], cwd);

	return code === 0 ? out.trim() : undefined;
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
		repository: basename(root),
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
	let patch = await must(
		['show', '--format=', '--no-color', '--full-index', '--find-renames', '--first-parent', hash],
		root,
	);

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

// Where the open stack starts: where the branch left its upstream, or the default base without one. Where it left it,
// not the upstream itself: settling onto an upstream that has gained commits since would take them in too.
export const openBase = async root => {
	const upstream = await run(['rev-parse', '--verify', '-q', '@{u}'], root);
	const base = upstream.code === 0 ? '@{u}' : await defaultBase(root);
	const parted = base && (await run(['merge-base', 'HEAD', base], root));

	return parted?.code === 0 ? parted.out.trim() : null;
};

const FOLD = /^(amend|fixup|squash)! (.+)$/;

// The commits not pushed as concerns, newest first: each commit, with the amend!/fixup!/squash! commits that fold into
// it at settling, and the message it will have then (the latest amend!'s). A fold names its concern by subject, as
// git's own --fixup=amend: does: the subject it was committed with (`originalSubject`), which a pull --rebase leaves
// alone where it changes the sha. An older fold naming it by sha still counts while that sha is the concern's.
export const parseStack = commits => {
	const concerns = [];

	for (const commit of [...commits].reverse()) {
		const [, kind, target] = FOLD.exec(commit.subject) ?? [];
		const into =
			kind &&
			concerns.findLast(concern => concern.hash.startsWith(target) || concern.originalSubject === target.trim());

		if (!into) {
			concerns.push({ ...commit, originalSubject: commit.subject, folds: [] });
			continue;
		}

		into.folds.push({ hash: commit.hash, short: commit.short, kind });
		if (kind === 'amend') {
			const [subject = into.subject, ...body] = commit.body.split('\n');

			Object.assign(into, { subject: subject.trim(), body: body.join('\n').trim() });
		}
	}

	return concerns.reverse();
};

// { base, concerns: [{ hash, short, authored, subject, originalSubject, body, folds: [{ hash, short, kind }] }] }
export const gitStack = async root => {
	const base = await openBase(root);

	if (!base) return { base: null, concerns: [] };

	const out = await must(['log', `--format=%H${UNIT}%h${UNIT}%aI${UNIT}%s${UNIT}%b${RECORD}`, `${base}..HEAD`], root);
	const commits = out
		.split(RECORD)
		.map(record => record.replace(/^\n/, ''))
		.filter(record => record.trim())
		.map(record => {
			const [hash, short, authored, subject, body = ''] = record.split(UNIT);

			return { hash, short, authored: new Date(authored).toISOString(), subject, body: body.trim() };
		});

	return { base, concerns: parseStack(commits) };
};

// The files an open concern changes: its own commit's and those folding into it
export const concernFiles = async (root, concern) => {
	const lists = await Promise.all(
		[concern.hash, ...concern.folds.map(fold => fold.hash)].map(hash =>
			must(['diff-tree', '--no-commit-id', '--name-only', '-r', '-z', '--root', hash], root),
		),
	);

	return [...new Set(lists.flatMap(list => list.split('\0').filter(Boolean)))];
};

// An open concern's whole new message, filed as an amend! commit on top without touching the index or the working
// tree, which may hold someone's work in progress. Only on a branch with nothing half done, and only if HEAD hasn't
// moved meanwhile: the commit that does the moving wins, and this one is not filed.
export const fileReasoning = async (root, into, message) => {
	if ((await run(['symbolic-ref', '-q', 'HEAD'], root)).code !== 0) throw new GitError('Not on a branch');
	if (await operationInProgress(root)) throw new GitError('Something is half done');

	const concern = (await gitStack(root)).concerns.find(open => open.hash === into);

	if (!concern) throw new GitError('That commit is pushed or gone');

	const head = (await must(['rev-parse', 'HEAD'], root)).trim();
	const filed = (
		await must(['commit-tree', `${head}^{tree}`, '-p', head, '-F', '-'], root, {
			input: `amend! ${concern.originalSubject}\n\n${message.trim()}\n`,
		})
	).trim();

	await must(['update-ref', '-m', 'paude: reasoning filed', 'HEAD', filed, head], root);

	return filed;
};

// What this branch adds to the base: its commits, and its changes as the diff view's files (since they parted)
export const gitCompare = async (root, { base, working = false } = {}) => {
	const against = base || (await defaultBase(root));

	if (!against || against.startsWith('-')) throw new GitError('There is no branch to compare with');

	const commits = await gitLog(root, { ref: `${against}..HEAD` });

	if (!working) {
		const patch = await must(['diff', '--no-color', '--full-index', '--find-renames', `${against}...HEAD`], root);

		return { base: against, commits, files: splitPatch(patch.slice(0, MAX_PATCH_BYTES)) };
	}

	return { base: against, commits, ...(await withWork(root, against)) };
};

// Each item through `work`, no more than `limit` at a time, the results in order
const eachAtMost = async (items, limit, work) => {
	const results = [];
	let next = 0;
	const worker = async () => {
		while (next < items.length) {
			const index = next++;

			results[index] = await work(items[index]);
		}
	};

	await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));

	return results;
};

// `work` given an index of its own, the checkout's with `files` (new ones) marked as to be added, so a diff with the
// files on disk shows them as git shows any change: once, a file a commit deleted and that is back on disk as changed
const withIntentToAdd = async (root, files, work) => {
	const folder = await mkdtemp(join(os.tmpdir(), 'paude-index-'));
	const env = { GIT_INDEX_FILE: join(folder, 'index') };

	try {
		const index = resolve(root, (await must(['rev-parse', '--git-path', 'index'], root)).trim());

		await copyFile(index, env.GIT_INDEX_FILE).catch(() => {});
		if (files.length)
			await must(['--literal-pathspecs', 'add', '-N', '--pathspec-from-file=-', '--pathspec-file-nul'], root, {
				env,
				input: files.join('\0'),
			});

		return await work(env);
	} finally {
		await rm(folder, { recursive: true, force: true });
	}
};

// Paths `git status --porcelain -z` names (a rename's both)
const statusPaths = text => {
	const fields = text.split('\0');
	const paths = new Set();

	for (let index = 0; index < fields.length; index++) {
		const field = fields[index];

		if (!/^.. ./.test(field)) continue;
		paths.add(field.slice(3));
		if (/[RC]/.test(field.slice(0, 2)) && fields[index + 1]) paths.add(fields[++index]);
	}

	return paths;
};

// What the branch would propose with the work not committed yet: from where it parted from the base to the files as
// they are, new files among them. A new file too big to show is named with a note; past MAX_UNTRACKED of them, or
// past the patch's budget, files are left out, and `leftOut` says how many.
const withWork = async (root, against) => {
	const parted = (await must(['merge-base', against, 'HEAD'], root)).trim();
	const untracked = (await must(['ls-files', '--others', '--exclude-standard', '-z'], root))
		.split('\0')
		.filter(file => file && !file.endsWith('/') && !isSecret(file));
	const listed = untracked.slice(0, MAX_UNTRACKED);
	const sizes = await eachAtMost(listed, 8, file =>
		stat(join(root, file)).then(
			({ size }) => size,
			() => 0,
		),
	);
	const big = listed.filter((file, index) => sizes[index] > MAX_UNTRACKED_BYTES);
	const small = listed.filter((file, index) => sizes[index] <= MAX_UNTRACKED_BYTES);
	const shown = ['.', ...big.map(file => `:(exclude,literal)${file}`)];
	const [patch, names] = await withIntentToAdd(root, small, env =>
		Promise.all([
			must(['diff', '--no-color', '--full-index', '--find-renames', parted, '--', ...shown], root, {
				env,
				limit: MAX_PATCH_BYTES,
			}),
			must(['diff', '--name-only', '-z', '--find-renames', parted, '--', ...shown], root, { env }),
		]),
	);
	const before = big.length
		? new Set(
				(await must(['--literal-pathspecs', 'ls-tree', '-z', '--name-only', parted, '--', ...big], root))
					.split('\0')
					.filter(Boolean),
			)
		: new Set();
	const whole = names.split('\0').filter(file => file && !isSecret(file));
	const fitted = splitPatch(patch);
	const files = [
		...fitted,
		...big.map(file => ({
			path: file,
			status: before.has(file) ? 'modified' : 'added',
			diff: '',
			note: 'Too big to show here',
		})),
	];
	const changed = statusPaths(await must(['status', '--porcelain', '-z', '--untracked-files=all'], root));

	return {
		uncommitted: files.filter(file => changed.has(file.path) || (file.from && changed.has(file.from))).length,
		leftOut: untracked.length - listed.length + whole.length - fitted.length,
		files,
	};
};

const COMMIT = /^[0-9a-f]{40}$/;

// What changed on this branch since a commit someone looked at: { commits, rewritten, files }. A commit still in its
// history gives the commits since and what they changed. One it no longer holds (a rebase, a force push) gives how the
// branch's own files differ from it, leaving out what the base changed elsewhere.
export const gitSince = async (root, commit) => {
	if (!COMMIT.test(commit ?? '')) throw new GitError('That is not a commit');
	if ((await run(['cat-file', '-e', `${commit}^{commit}`], root)).code !== 0)
		throw new GitError('The commit you reviewed is not here any more; fetch, or review it whole again');

	const kept = (await run(['merge-base', '--is-ancestor', commit, 'HEAD'], root)).code === 0;
	const base = !kept && (await defaultBase(root));
	const names = async range =>
		(await must(['diff', '--name-only', '--no-renames', '-z', ...range], root)).split('\0').filter(Boolean);
	// The branch's own files, among those that differ: named a few hundred at a time, each as it is (not a pattern)
	const touched = base
		? [
				...new Set([...(await names([`${base}...HEAD`])), ...(await names([`${base}...${commit}`]))]).intersection(
					new Set(await names([commit, 'HEAD'])),
				),
			].sort()
		: null;
	const parts = touched
		? Array.from({ length: Math.ceil(touched.length / PATHS_AT_ONCE) }, (_, index) =>
				touched.slice(index * PATHS_AT_ONCE, (index + 1) * PATHS_AT_ONCE),
			)
		: [[]];
	let patch = '';

	for (const part of parts) {
		if (patch.length >= MAX_PATCH_BYTES) break;
		patch += await must(
			[
				'--literal-pathspecs',
				'diff',
				'--no-color',
				'--full-index',
				'--find-renames',
				commit,
				'HEAD',
				...(part.length ? ['--', ...part] : []),
			],
			root,
			{ limit: MAX_PATCH_BYTES - patch.length },
		);
	}

	const since = (kept && `${commit}..HEAD`) || (base && `${base}..HEAD`) || 'HEAD';

	return {
		rewritten: !kept,
		commits: await gitLog(root, { ref: since, limit: 100 }),
		files: splitPatch(patch.slice(0, MAX_PATCH_BYTES)),
	};
};

const ZERO_CONTEXT = ['diff', '-U0', '--no-color', '--no-ext-diff', '--no-textconv'];

// Where `path` is, if inside `top` (or `top` itself)
const isWithin = (top, path) => {
	const within = relative(top, path);

	return !isAbsolute(within) && within.split(sep)[0] !== '..';
};

// A file a comment may name, from the session's folder: inside its repository (the folder itself outside git),
// never a secret. Its place on disk and the repository's, or null. `../` names a file elsewhere in the repository.
const placeOf = async (cwd, file) => {
	if (typeof file !== 'string' || !file || file.includes('\0') || isAbsolute(file)) return null;

	const [top, here] = await Promise.all([
		realpath((await repoRoot(cwd)) ?? cwd).catch(() => null),
		realpath(cwd).catch(() => null),
	]);
	const full = top && here && resolve(here, file);

	if (!full || full === top || !isWithin(top, full) || isSecret(relative(top, full).split(sep).join('/'))) return null;

	return { full, top };
};

export const inRepository = async (cwd, file) => Boolean(await placeOf(cwd, file));

// A file's bytes as they are on disk, if it may be kept: a plain file (not a link, a pipe or a device) inside the
// repository, not too big. Undefined otherwise.
const fileBytes = async (cwd, file) => {
	const place = await placeOf(cwd, file);
	const folder = place && (await realpath(dirname(place.full)).catch(() => null));

	if (!folder || !isWithin(place.top, folder)) return undefined;

	let handle;

	try {
		handle = await open(place.full, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);

		const stats = await handle.stat();

		return stats.isFile() && stats.size <= MAX_BLOB_BYTES ? await handle.readFile() : undefined;
	} catch {
		return undefined;
	} finally {
		await handle?.close();
	}
};

const hashBytes = async (cwd, file, bytes, write) => {
	const hashed = await run(
		['hash-object', ...(write ? ['-w'] : []), '--stdin', ...(file ? [`--path=${file}`] : [])],
		cwd,
		{
			input: bytes,
		},
	);

	return hashed.code === 0 && COMMIT.test(hashed.out.trim()) ? hashed.out.trim() : undefined;
};

// A file's text as git names it (a blob id), so lines read in it can be found again however the file changes after:
// at a commit (`rev`), or as it is on disk now (not kept: keepFile keeps it). Undefined outside git, or for a file
// that isn't there or can't be kept.
export const blobOf = async (cwd, file, rev) => {
	if (rev) {
		const found = await run(['rev-parse', '--verify', '-q', `${rev}:./${file}`], cwd);

		return found.code === 0 && COMMIT.test(found.out.trim()) ? found.out.trim() : undefined;
	}

	const bytes = await fileBytes(cwd, file);

	return bytes && hashBytes(cwd, file, bytes, false);
};

// The file on disk kept in git as a blob, for a comment on its lines: its id, or undefined when it can't be kept, or
// isn't the text `wanted` (a blob id) any more
export const keepFile = async (cwd, file, wanted) => {
	const bytes = await fileBytes(cwd, file);

	if (!bytes || (wanted && (await hashBytes(cwd, file, bytes, false)) !== wanted)) return undefined;

	return hashBytes(cwd, file, bytes, true);
};

// Where a comment's lines are now: carried from the text they were read in to `target` (a commit, or the file on disk
// when absent), or null when what changed since touched them, the file is gone, or `target` isn't here to read. That
// text is the comment's blob (the file exactly as it was read), else its commit (a GitHub thread's lines are numbered
// by one); with neither here to compare with, its lines are taken as they are.
export const linesNow = async (cwd, { path: file, from, to, commit, blob }, target) => {
	if (COMMIT.test(blob ?? '') && (await run(['cat-file', '-e', blob], cwd)).code === 0) {
		const now = target ? await blobOf(cwd, file, target) : await keepFile(cwd, file);

		if (!now) return null;
		if (now === blob) return { from, to };

		const diff = await run([...ZERO_CONTEXT, blob, now], cwd);

		return diff.code === 0 ? remapLines(diff.out, { from, to }) : null;
	}

	if (!COMMIT.test(commit ?? '') || (await run(['cat-file', '-e', `${commit}^{commit}`], cwd)).code !== 0)
		return { from, to };
	if (target && !(await hasRef(cwd, target))) return null;

	const diff = await run([...ZERO_CONTEXT, commit, ...(target ? [target] : []), '--', file], cwd);

	if (diff.code !== 0) return target ? null : { from, to };

	return remapLines(diff.out, { from, to });
};

export const hasObject = async (cwd, hash) =>
	COMMIT.test(hash ?? '') && (await run(['cat-file', '-e', hash], cwd)).code === 0;

// A text that isn't a file on disk (a turn's, a proposal's) kept in git as a blob, so lines read in it can be found
// again, when it is the text `wanted` (a blob id): its id, or undefined outside git, past the size a blob is kept at,
// or for another text
export const keepText = async (cwd, text, wanted) => {
	if (typeof text !== 'string' || text.length > MAX_BLOB_BYTES) return undefined;

	const bytes = new TextEncoder().encode(text);

	return (await hashBytes(cwd, '', bytes, false)) === wanted ? hashBytes(cwd, '', bytes, true) : undefined;
};

// Lines of one text of a file carried to another (both blobs), or null when what changed between them touched the
// lines, or either text isn't here to compare
export const linesBetween = async (cwd, { from, to }, before, after) => {
	if (before === after) return { from, to };
	if (!(await hasObject(cwd, before)) || !(await hasObject(cwd, after))) return null;

	const diff = await run([...ZERO_CONTEXT, before, after], cwd);

	return diff.code === 0 ? remapLines(diff.out, { from, to }) : null;
};

// Where a comment's lines are in a diff of its file, given the two texts the diff is between ({ old, new }, blobs):
// { new, old }, its lines on each side, or null on a side without them (no such text, or the change touched them). A
// comment without a blob of its own (a GitHub thread on lines after the change) is numbered by its commit.
export const linesInDiff = async (cwd, anchor, blobs) => {
	const carry = async (range, from, side) => (blobs[side] && from ? linesBetween(cwd, range, from, blobs[side]) : null);
	const own =
		anchor.blob ??
		(anchor.side === 'new' && COMMIT.test(anchor.commit ?? '')
			? await blobOf(cwd, anchor.path, anchor.commit)
			: undefined);
	const lines = await carry(anchor, own, anchor.side);

	if (anchor.side === 'old') return { old: lines, new: null };

	return { new: lines, old: anchor.old ? await carry(anchor.old, anchor.old.blob, 'old') : null };
};

export const hasRef = async (root, name) =>
	!name.startsWith('-') && (await run(['rev-parse', '--verify', '-q', `${name}^{commit}`], root)).code === 0;

export const mergeBase = async (root, first, second) => {
	const found = await run(['merge-base', first, second], root);

	return found.code === 0 && COMMIT.test(found.out.trim()) ? found.out.trim() : null;
};

// How far HEAD has moved from a commit, cheaply: { count } commits on from it, { rewritten } when HEAD no longer holds
// it, { missing } when it isn't here at all
export const movedSince = async (root, commit) => {
	if (!COMMIT.test(commit ?? '') || (await run(['cat-file', '-e', `${commit}^{commit}`], root)).code !== 0)
		return { missing: true };
	if ((await run(['merge-base', '--is-ancestor', commit, 'HEAD'], root)).code !== 0) return { rewritten: true };

	return { count: Number((await must(['rev-list', '--count', `${commit}..HEAD`], root)).trim()) };
};

// What a branch tracks (origin/someone/fix), else its own name; null on a detached HEAD
export const branchName = async root => {
	const branch = await run(['symbolic-ref', '--short', '-q', 'HEAD'], root);

	if (branch.code !== 0) return null;

	const upstream = await run(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'], root);

	return (upstream.code === 0 && upstream.out.trim()) || branch.out.trim();
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
	commit: async (root, { message, amend, into }) => {
		// Into a concern not pushed yet: its whole new message, folded in at settling (the reasoning alone, with nothing
		// staged)
		if (into) {
			const { concerns } = await gitStack(root);
			const concern = concerns.find(open => open.hash === into);

			if (!concern) throw new GitError('That commit is pushed or gone; commit it as its own');
			if (typeof message !== 'string' || !message.trim()) throw new GitError('Write the message it will have');

			return act(['commit', '--allow-empty', '-F', '-'], root, {
				input: `amend! ${concern.originalSubject}\n\n${message.trim()}`,
			});
		}
		if (typeof message !== 'string' || !message.trim()) {
			if (!amend) throw new GitError('Write a message for the commit');

			return act(['commit', '--amend', '--no-edit'], root);
		}

		return act(['commit', ...(amend ? ['--amend'] : []), '-F', '-'], root, { input: message.trim() });
	},
	// What was filed into each concern, folded in: the open stack as it will be pushed. The work not committed stays.
	settle: async root => {
		const base = await openBase(root);

		if (!base) throw new GitError('Nothing to settle: no commits beyond what is pushed');

		return act(['rebase', '-i', '--autosquash', '--autostash', base], root, { env: { GIT_SEQUENCE_EDITOR: 'true' } });
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
