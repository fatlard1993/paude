import { readdir } from 'fs/promises';
import { join, relative, resolve, sep } from 'path';

let root;

export const setProjectsRoot = path => {
	root = resolve(path);
};

export const listProjects = async () =>
	(await readdir(root, { withFileTypes: true }))
		.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
		.map(entry => entry.name)
		.sort((a, b) => a.localeCompare(b));

// A project is a direct child of the root; anything else (traversal, nested paths) is refused.
export const projectPath = name => {
	if (typeof name !== 'string' || !name || name.includes('/') || name.startsWith('.')) return null;

	return join(root, name);
};

// Sessions can live in a project or one of its worktrees, so any path inside the root counts.
export const projectOf = cwd => {
	if (!cwd) return null;

	const path = relative(root, resolve(cwd));

	if (!path || path.startsWith('..') || path.startsWith(sep)) return null;

	return path.split(sep)[0];
};
