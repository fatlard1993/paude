import { randomUUID } from 'crypto';
import { existsSync } from 'fs';
import { cp, lstat, mkdir, readdir, realpath, rename, rm, stat, writeFile } from 'fs/promises';
import path from 'path';

import { forgetListing, isSecret, listFiles } from './files';

export const MAX_UPLOAD = 50 * 1024 * 1024;
const MAX_AT_ONCE = 500;
const TRASH_KEPT_MS = 24 * 60 * 60 * 1000;
const MANIFEST = 'trashed.json';

let trashFolder;

// What the files panel deletes waits here a day, so a delete can be undone
export const initTrash = dataDir => {
	trashFolder = path.join(dataDir, 'trash');
};

export class FileError extends Error {
	constructor(status, message) {
		super(message);
		this.status = status;
	}
}

const refuse = (status, message) => {
	throw new FileError(status, message);
};

// A path as the files panel names one: relative, plain, out of .git, and not a file paude keeps out of view
const partsOf = wanted => {
	const parts = typeof wanted === 'string' ? wanted.trim().replace(/\/+$/, '').split('/') : [];

	if (!parts.length || parts.some(part => !part || part === '.' || part === '..' || part === '.git'))
		refuse(400, 'Give a path inside the project, like src/new.js');
	if (isSecret(parts.join('/'))) refuse(400, 'paude keeps files like that out of view');

	return parts;
};

const within = (root, real) => real === root || real.startsWith(root + path.sep);

const sameEntry = (a, b) => a && b && a.ino === b.ino && a.dev === b.dev;

// Somewhere new: every folder on the way that's already there resolves inside the project, and nothing is at the path
// yet (unless it's `itself`, as a rename that only changes case finds on a Mac)
const newPlace = async (cwd, wanted, { itself } = {}) => {
	const parts = partsOf(wanted);
	const rel = parts.join('/');
	const root = await realpath(cwd);
	let depth = parts.length - 1;

	while (depth > 0 && !existsSync(path.resolve(cwd, ...parts.slice(0, depth)))) depth -= 1;

	const parent = await realpath(path.resolve(cwd, ...parts.slice(0, depth)));

	if (!within(root, parent)) refuse(400, 'That is outside the project');
	if (!(await stat(parent)).isDirectory()) refuse(400, `A file is in the way of ${rel}`);

	const target = path.resolve(cwd, ...parts);
	const there = await lstat(target).catch(() => null);

	if (there && !sameEntry(there, itself)) refuse(409, `${rel} is already there`);

	return { rel, target };
};

// Something there: a file or folder in the project, taken as itself (a symlink is the link, not what it points to)
const existingEntry = async (cwd, wanted) => {
	const parts = partsOf(wanted);
	const rel = parts.join('/');
	const root = await realpath(cwd);
	const parent = await realpath(path.resolve(cwd, ...parts.slice(0, -1))).catch(() => null);
	const target = path.resolve(cwd, ...parts);
	const found = parent && within(root, parent) ? await lstat(target).catch(() => null) : null;

	if (!found) refuse(404, `${rel} is not in the project`);

	return { rel, target, stats: found };
};

// A rename, or a copy and a removal where a rename can't cross from one disk to another
const relocate = async (from, to) => {
	await mkdir(path.dirname(to), { recursive: true });

	try {
		await rename(from, to);
	} catch (error) {
		if (error.code !== 'EXDEV') throw error;
		await cp(from, to, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
		await rm(from, { recursive: true, force: true });
	}
};

// Several checked before any is made, so a refused one leaves everything as it was
const plannedPairs = async (cwd, pairs) => {
	if (!Array.isArray(pairs) || !pairs.length) refuse(400, 'Nothing to do');
	if (pairs.length > MAX_AT_ONCE) refuse(400, `${MAX_AT_ONCE} at a time at most`);

	const planned = [];

	for (const pair of pairs) {
		const from = await existingEntry(cwd, pair?.from);
		const to = await newPlace(cwd, pair?.to, { itself: from.stats });

		if (to.rel.startsWith(`${from.rel}/`)) refuse(400, `${from.rel} can't go inside itself`);
		planned.push({ from, to });
	}

	if (new Set(planned.map(({ to }) => to.rel)).size < planned.length)
		refuse(409, 'Two of those would land in the same place');

	return planned;
};

// { listed } says whether the files panel will show a new file: a file git ignores is made but isn't listed
const listed = async (cwd, rel) => {
	forgetListing(cwd);

	return (await listFiles(cwd)).includes(rel);
};

export const createEntry = async (cwd, wanted, { folder = false } = {}) => {
	const { rel, target } = await newPlace(cwd, wanted);

	await mkdir(path.dirname(target), { recursive: true });

	try {
		if (folder) await mkdir(target);
		else await writeFile(target, '', { flag: 'wx' });
	} catch (error) {
		if (error.code === 'EEXIST') refuse(409, `${rel} is already there`);
		throw error;
	}

	if (folder) forgetListing(cwd);

	return { path: rel, ...(!folder && { listed: await listed(cwd, rel) }) };
};

// A rename is one move; moves are [{ from, to }] with whole paths at both ends
export const moveEntries = async (cwd, moves) => {
	const planned = await plannedPairs(cwd, moves);

	for (const { from, to } of planned) await relocate(from.target, to.target);
	forgetListing(cwd);

	return { moved: planned.map(({ from, to }) => ({ from: from.rel, to: to.rel })) };
};

export const copyEntries = async (cwd, copies) => {
	const planned = await plannedPairs(cwd, copies);

	for (const { from, to } of planned) {
		await mkdir(path.dirname(to.target), { recursive: true });
		await cp(from.target, to.target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
	}
	forgetListing(cwd);

	return { copied: planned.map(({ from, to }) => ({ from: from.rel, to: to.rel })) };
};

const pruneTrash = async () => {
	const now = Date.now();

	for (const id of await readdir(trashFolder).catch(() => [])) {
		const at = parseInt(id.split('-')[0], 36);

		if (!(now - at < TRASH_KEPT_MS)) await rm(path.join(trashFolder, id), { recursive: true, force: true });
	}
};

// Out of the project and into the trash, all of it or none: { trash } is what restoring them takes
export const trashEntries = async (cwd, paths) => {
	if (!Array.isArray(paths) || !paths.length) refuse(400, 'Nothing to delete');
	if (paths.length > MAX_AT_ONCE) refuse(400, `${MAX_AT_ONCE} at a time at most`);

	const found = new Map();

	for (const wanted of paths) {
		const entry = await existingEntry(cwd, wanted);

		found.set(entry.rel, entry);
	}

	// Something inside a folder going too goes with the folder
	const taken = [...found.values()].filter(entry => ![...found.keys()].some(rel => entry.rel.startsWith(`${rel}/`)));
	const id = `${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
	const folder = path.join(trashFolder, id);
	const entries = taken.map((entry, index) => ({ path: entry.rel, stored: String(index) }));

	await pruneTrash();
	await mkdir(folder, { recursive: true });
	await Bun.write(path.join(folder, MANIFEST), JSON.stringify({ cwd, entries }));
	for (const [index, entry] of taken.entries()) await relocate(entry.target, path.join(folder, entries[index].stored));
	forgetListing(cwd);

	return { trash: id, deleted: entries.map(entry => entry.path) };
};

export const restoreEntries = async (cwd, id) => {
	const folder = typeof id === 'string' && /^[\da-z]+-[\da-f]{8}$/.test(id) ? path.join(trashFolder, id) : null;
	const manifest =
		folder &&
		(await Bun.file(path.join(folder, MANIFEST))
			.json()
			.catch(() => null));

	if (!manifest || manifest.cwd !== cwd) refuse(404, 'That is no longer in the trash');

	const places = [];

	for (const entry of manifest.entries) places.push(await newPlace(cwd, entry.path));
	for (const [index, place] of places.entries())
		await relocate(path.join(folder, manifest.entries[index].stored), place.target);
	await rm(folder, { recursive: true, force: true });
	forgetListing(cwd);

	return { restored: places.map(place => place.rel) };
};

// A file from the browser; over one already there only when asked, and never through a symlink
export const uploadFile = async (cwd, wanted, bytes, { replace = false } = {}) => {
	if (bytes.byteLength > MAX_UPLOAD) refuse(413, 'Too big to upload (50MB at most)');

	const there = replace ? await existingEntry(cwd, wanted).catch(() => null) : null;

	if (there && !there.stats.isFile()) refuse(409, `${there.rel} is a folder or a link, not a file to replace`);

	const { rel, target } = there ?? (await newPlace(cwd, wanted));

	await mkdir(path.dirname(target), { recursive: true });

	try {
		await writeFile(target, new Uint8Array(bytes), { flag: there ? 'w' : 'wx' });
	} catch (error) {
		if (error.code === 'EEXIST') refuse(409, `${rel} is already there`);
		throw error;
	}

	return { path: rel, listed: await listed(cwd, rel) };
};
