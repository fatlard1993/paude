import { readdir, realpath, stat } from 'fs/promises';
import os from 'os';
import { basename, join, relative, resolve, sep } from 'path';

import writeJsonFile from '../shared/writeJsonFile';
import readJsonFile from '../shared/readJsonFile';

// Projects are the folders directly under the projects root, plus folders registered from anywhere else:
// [{ name, path }] in folders.json, each named after its folder (with a number when the name is taken)
let root;
let foldersFile;
let folders = [];
// A worktree belongs to its project wherever it lives: [{ path, project, made }] in worktrees.json, `made` when paude
// created it (and so may remove it)
let worktreesFile;
let worktrees = [];
// Folders under the projects root taken off the list (their names, in hidden-projects.json); adding one brings it back
let hiddenFile;
let hidden = [];

export const setProjectsRoot = path => {
	root = resolve(path);
};

export const initProjects = async dataDir => {
	foldersFile = join(dataDir, 'folders.json');
	folders = await readJsonFile(foldersFile, []);
	worktreesFile = join(dataDir, 'worktrees.json');
	worktrees = await readJsonFile(worktreesFile, []);
	hiddenFile = join(dataDir, 'hidden-projects.json');
	hidden = await readJsonFile(hiddenFile, []);
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

// A worktree another project claims isn't a project of its own, even when it sits in the projects root; nor is a
// folder holding them (a workspace tool's <repo>-worktrees)
const holdsOthersWorktrees = name =>
	worktrees.some(({ path, project }) => project !== name && inside(path, join(root, name)));

export const listProjects = async () =>
	[
		...new Set([
			...(await rootProjects()).filter(name => !holdsOthersWorktrees(name) && !hidden.includes(name)),
			...folders.map(({ name }) => name),
		]),
	].sort((a, b) => a.localeCompare(b));

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

	const registered = folders.find(folder => folder.name === name)?.path;

	if (registered) return registered;

	return hidden.includes(name) ? null : join(root, name);
};

export const claimWorktree = async (path, project, { made = false } = {}) => {
	const existing = worktrees.find(worktree => worktree.path === path);

	if (existing?.project === project && (existing.made || !made)) return;
	if (existing) Object.assign(existing, { project, made: existing.made || made });
	else worktrees.push({ path, project, made });
	await writeJsonFile(worktreesFile, () => worktrees);
};

export const forgetWorktree = async path => {
	const before = worktrees.length;

	worktrees = worktrees.filter(worktree => worktree.path !== path);
	if (worktrees.length !== before) await writeJsonFile(worktreesFile, () => worktrees);
};

// The claimed worktree a folder is in, the deepest one
export const worktreeClaim = cwd =>
	cwd
		? (worktrees
				.filter(worktree => inside(resolve(cwd), worktree.path))
				.sort((a, b) => b.path.length - a.path.length)[0] ?? null)
		: null;

// Sessions can live in a project or one of its worktrees, so any path inside one counts. A claimed worktree is its
// project's; otherwise the deepest registered folder wins, so one registered inside another is its own project.
export const projectOf = cwd => {
	if (!cwd) return null;

	const claimed = worktreeClaim(cwd);

	if (claimed) return claimed.project;

	const path = resolve(cwd);
	const registered = folders
		.filter(folder => inside(path, folder.path))
		.sort((a, b) => b.path.length - a.path.length)[0];

	if (registered) return registered.name;

	const child = rootChildOf(path);

	return child && !hidden.includes(child) ? child : null;
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

	if (rootChildOf(path) && relative(root, path) === rootChildOf(path)) {
		const name = rootChildOf(path);

		if (hidden.includes(name)) {
			hidden = hidden.filter(other => other !== name);
			await writeJsonFile(hiddenFile, () => hidden);
		}

		return name;
	}

	// A hidden folder's name stays its own, for when it's added back
	const taken = new Set([...(await rootProjects()), ...folders.map(folder => folder.name)]);
	const base = basename(path).replace(/^\.+/, '') || 'folder';
	let name = base;

	for (let number = 2; taken.has(name); number++) name = `${base}-${number}`;

	folders.push({ name, path });
	await writeJsonFile(foldersFile, () => folders);

	return name;
};

const GLOB = /[*?[{]/;
const MAX_ADDED = 200;

// A folder, or a pattern for several ("~/Projects/minecraft/*"): each folder it matches becomes a project of its own.
// Resolves to the names they're listed under.
export const addFolders = async requested => {
	if (typeof requested !== 'string' || !requested.trim()) throw new FolderError('Give the folder as a full path.');

	const pattern = requested.trim().replace(/^~(?=\/|$)/, os.homedir());

	if (!GLOB.test(pattern)) return [await registerFolder(pattern)];
	if (!pattern.startsWith('/')) throw new FolderError('Give the folders as a full path, like ~/Projects/mods/*.');

	// Scanned from the deepest folder before the first wildcard, so only the part with wildcards is matched
	const parts = pattern.split('/');
	const fixed = parts.findIndex(part => GLOB.test(part));
	const base = parts.slice(0, fixed).join('/') || '/';
	const matched = [];

	for await (const path of new Bun.Glob(parts.slice(fixed).join('/')).scan({
		cwd: base,
		onlyFiles: false,
		absolute: true,
	})) {
		if (basename(path).startsWith('.')) continue;
		if (!(await stat(path).catch(() => null))?.isDirectory()) continue;

		matched.push(path);
		if (matched.length > MAX_ADDED) throw new FolderError(`That matches more than ${MAX_ADDED} folders.`);
	}

	if (!matched.length) throw new FolderError(`No folders match ${requested}.`);

	const names = [];

	for (const path of matched.sort()) names.push(await registerFolder(path));

	return names;
};

// Off the list: a registered folder is forgotten, one under the projects root is hidden. Nothing on disk changes.
// Resolves to 'removed', 'hidden', or null when there's no such project.
export const removeProject = async name => {
	if (await unregisterFolder(name)) return 'removed';
	if (typeof name !== 'string' || !(await rootProjects()).includes(name) || hidden.includes(name)) return null;

	hidden = [...hidden, name];
	await writeJsonFile(hiddenFile, () => hidden);

	return 'hidden';
};

export const unregisterFolder = async name => {
	const before = folders.length;

	folders = folders.filter(folder => folder.name !== name);
	if (folders.length !== before) await writeJsonFile(foldersFile, () => folders);

	return folders.length !== before;
};
