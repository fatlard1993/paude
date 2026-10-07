import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { sessionListeners } from './ports';

// What sessions share through the preview listener, each at /s/<name>/ there:
// - a port a session's processes listen on, found on its own and shared while it listens (auto)
// - a port forwarded by hand: any service on this machine
// - a file or folder to download (a folder as a zip), or a folder served as a static site
// Shares made by hand are kept in shares.json; found ones live as long as their listener.
const DETECT_EVERY_MS = 4000;
const MAX_NAME = 40;

let file;
let made = [];
let found = new Map();
// Found ports someone stopped sharing, until they stop listening: `${sessionId}:${port}`
const stopped = new Set();
let reservedPorts = new Set();
const listeners = new Set();

export const KINDS = ['port', 'file', 'folder', 'site'];

export const initShares = async (dataDir, { reserved = [] } = {}) => {
	file = path.join(dataDir, 'shares.json');
	made = await readJsonFile(file, []);
	reservedPorts = new Set(reserved);
};

const save = () => writeJsonFile(file, () => made);

const slug = text =>
	String(text)
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-|-$/g, '')
		.slice(0, MAX_NAME) || 'share';

const foundShares = sessionId =>
	(found.get(sessionId) ?? [])
		.filter(({ port }) => !stopped.has(`${sessionId}:${port}`) && !reservedPorts.has(port))
		.map(({ port, host, command }) => ({
			id: `found-${sessionId}-${port}`,
			name: `${port}-${sessionId.slice(0, 6)}`,
			sessionId,
			kind: 'port',
			port,
			host,
			command,
			auto: true,
		}));

export const sharesOf = sessionId => [
	...foundShares(sessionId),
	...made.filter(share => share.sessionId === sessionId),
];

export const shareNamed = name =>
	made.find(share => share.name === name) ??
	[...found.keys()].flatMap(foundShares).find(share => share.name === name) ??
	null;

const nameFor = (sessionId, wanted) => {
	const base = `${slug(wanted)}-${sessionId.slice(0, 6)}`;
	const taken = name => Boolean(shareNamed(name));
	let name = base;

	for (let number = 2; taken(name); number++) name = `${base}-${number}`;

	return name;
};

export class ShareError extends Error {}

// A share made by hand: { kind: 'port', port } or { kind: 'file' | 'folder' | 'site', path } (path relative to the
// session's folder, checked by whoever calls this)
export const addShare = async (sessionId, { kind, port, path: sharedPath }) => {
	if (!KINDS.includes(kind)) throw new ShareError('Share a port, a file, a folder or a site');

	let share;

	if (kind === 'port') {
		const number = Number(port);

		if (!Number.isInteger(number) || number < 1 || number > 65535) throw new ShareError('That is not a port');
		if (reservedPorts.has(number)) throw new ShareError("That's paude's own port");
		share = { kind, port: number, host: '127.0.0.1', name: nameFor(sessionId, String(number)) };
	} else {
		if (typeof sharedPath !== 'string' || !sharedPath) throw new ShareError('Name what to share');
		share = { kind, path: sharedPath, name: nameFor(sessionId, path.basename(sharedPath) || 'project') };
	}

	const added = { id: crypto.randomUUID(), sessionId, at: Date.now(), ...share };

	made.push(added);
	await save();
	announce(sessionId);

	return added;
};

export const removeShare = async (sessionId, id) => {
	const auto = foundShares(sessionId).find(share => share.id === id);

	if (auto) {
		stopped.add(`${sessionId}:${auto.port}`);
		announce(sessionId);

		return true;
	}

	const before = made.length;

	made = made.filter(share => !(share.id === id && share.sessionId === sessionId));
	if (made.length === before) return false;
	await save();
	announce(sessionId);

	return true;
};

export const forgetSessionShares = async sessionId => {
	found.delete(sessionId);
	made = made.filter(share => share.sessionId !== sessionId);
	await save();
};

// Told when a session's shares change, to pass on to whoever has it open
export const onSharesChange = listener => listeners.add(listener);

const announce = sessionId => {
	for (const listener of listeners) listener(sessionId, sharesOf(sessionId));
};

const portsOf = listeners => (listeners ?? []).map(({ port }) => port).join(',');

// Looks every few seconds; a session whose ports changed hears about it, and a port that closed may be shared again
export const detectShares = async () => {
	const next = await sessionListeners();

	for (const sessionId of new Set([...found.keys(), ...next.keys()])) {
		if (portsOf(found.get(sessionId)) === portsOf(next.get(sessionId))) continue;

		const open = new Set((next.get(sessionId) ?? []).map(({ port }) => port));

		for (const key of stopped)
			if (key.startsWith(`${sessionId}:`) && !open.has(Number(key.split(':')[1]))) stopped.delete(key);
		found = new Map(found);
		if (next.has(sessionId)) found.set(sessionId, next.get(sessionId));
		else found.delete(sessionId);
		announce(sessionId);
	}
};

export const watchShares = () => {
	const look = () =>
		detectShares()
			.catch(error => console.error('Looking for shared ports failed:', error))
			.finally(() => setTimeout(look, DETECT_EVERY_MS).unref());

	look();
};
