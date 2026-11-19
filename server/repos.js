import { readdir, realpath } from 'fs/promises';
import { join } from 'path';

import { listWorktrees } from './worktrees';

// Folders no one keeps a repository of their own in, and that are slow to go through
const SKIPPED = new Set(['node_modules', 'dist', 'build', 'target', 'vendor', 'coverage', '__pycache__', 'venv']);
// How deep under a project its repositories are looked for, and how many are taken at most: a bound on a runaway
// walk, well past a project that keeps a repository for each of its many parts (a mod suite's ninety)
const DEPTH = 4;
const MOST = 300;

// Every git repository within `folder`, itself included: the ones nested in it as deep as DEPTH (in hidden folders
// and the likes of node_modules none are looked for) and every worktree of each, wherever that is; each once, by
// where it really is
export const reposWithin = async folder => {
	const found = [];
	const walk = async (dir, depth) => {
		const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);

		if (entries.some(entry => entry.name === '.git')) found.push(dir);
		if (depth >= DEPTH || found.length >= MOST) return;
		await Promise.all(
			entries
				.filter(entry => entry.isDirectory() && !entry.name.startsWith('.') && !SKIPPED.has(entry.name))
				.map(entry => walk(join(dir, entry.name), depth + 1)),
		);
	};

	await walk(folder, 0);

	const worktrees = await Promise.all(found.map(repo => listWorktrees(repo).catch(() => [])));
	const all = await Promise.all(
		[...found, ...worktrees.flat().map(({ path }) => path)].map(path => realpath(path).catch(() => null)),
	);

	return [...new Set(all.filter(Boolean))].slice(0, MOST);
};
