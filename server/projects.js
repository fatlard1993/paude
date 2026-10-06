import { readdir, realpath, stat } from 'fs/promises';
import { basename, join, relative, resolve, sep } from 'path';

import writeJsonFile from '../shared/writeJsonFile';
import readJsonFile from '../shared/readJsonFile';

// Projects are the folders directly under the projects root, plus folders registered from anywhere else:
// [{ name, path }] in folders.json, each named after its folder (with a number when the name is taken)
let root;
let foldersFile;
let folders = [];

export const setProjectsRoot = path => {
	root = resolve(path);
};

export const initProjects = async dataDir => {
	foldersFile = join(dataDir, 'folders.json');
	folders = await readJsonFile(foldersFile, []);
};

const rootProjects = async () => {
	try {
		return (await readdir(root, { withFileTypes: true }))
			.filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
			.map(entry => entry.name);
	} catch {
		return [];
	}
};

export const listProjects = async () =>
	[...new Set([...(await rootProjects()), ...folders.map(({ name }) => name)])].sort((a, b) => a.localeCompare(b));

export const registeredFolders = () => folders.map(folder => ({ ...folder }));

const inside = (path, folder) => {
	const within = relative(folder, path);

	return !within.startsWith('..') && !within.startsWith(sep);
};

const rootChildOf = path => {
	const fromRoot = relative(root, path);

	if (!fromRoot || fromRoot.startsWith('..') || fromRoot.startsWith(sep)) return null;

	return fromRoot.split(sep)[0];
};

// A project is a root child or a registered folder; anything else (traversal, nested paths) is refused
export const projectPath = name => {
	if (typeof name !== 'string' || !name || name.includes('/') || name.startsWith('.')) return null;

	return folders.find(folder => folder.name === name)?.path ?? join(root, name);
};

// Sessions can live in a project or one of its worktrees, so any path inside one counts. The deepest registered
// folder wins, so one registered inside another is its own project.
export const projectOf = cwd => {
	if (!cwd) return null;

	const path = resolve(cwd);
	const registered = folders
		.filter(folder => inside(path, folder.path))
		.sort((a, b) => b.path.length - a.path.length)[0];

	return registered?.name ?? rootChildOf(path);
};

export class FolderError extends Error {}

export const registerFolder = async requested => {
	if (typeof requested !== 'string' || !requested.startsWith('/'))
		throw new FolderError('Give the folder as a full path.');

	let path;

	try {
		path = await realpath(requested);
		if (!(await stat(path)).isDirectory()) throw new Error('not a folder');
	} catch {
		throw new FolderError(`There is no folder at ${requested}.`);
	}

	const existing = folders.find(folder => folder.path === path);

	if (existing) return existing.name;
	if (rootChildOf(path) && relative(root, path) === rootChildOf(path)) return rootChildOf(path);

	const taken = new Set(await listProjects());
	const base = basename(path).replace(/^\.+/, '') || 'folder';
	let name = base;

	for (let number = 2; taken.has(name); number++) name = `${base}-${number}`;

	folders.push({ name, path });
	await writeJsonFile(foldersFile, () => folders);

	return name;
};

export const unregisterFolder = async name => {
	const before = folders.length;

	folders = folders.filter(folder => folder.name !== name);
	if (folders.length !== before) await writeJsonFile(foldersFile, () => folders);

	return folders.length !== before;
};
