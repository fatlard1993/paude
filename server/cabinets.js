import { lookup } from 'dns/promises';
import os from 'os';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { askHub, connectedHub } from './motherHub';

// The games of the mother hub this paude is connected to, as arcade cabinets in the universe's lounge: one for each
// game watched (every game, until one is unwatched), lit while its game runs, opening the game itself. Asked of the
// hub a little apart, so the universe's poll doesn't ask it every few seconds.
const ASK_EVERY_MS = 15_000;
let file;
let unwatched = new Set();
let known = { at: 0, games: [], host: null };

export const initCabinets = async dataDir => {
	file = path.join(dataDir, 'cabinets.json');
	unwatched = new Set((await readJsonFile(file, {})).unwatched ?? []);
};

// A hub game as a cabinet: what it's called, its colors and icon, where it's played, and whether it's on
export const cabinetOf = (game, hubUrl) => ({
	id: game.id,
	// The paude project it is, by its folder's name, so its cabinet takes that project's color
	project: game.dir ? path.basename(game.dir) : game.id,
	port: game.port ?? null,
	title: game.look?.title || game.name || game.id,
	color: game.look?.color ?? null,
	background: game.look?.background ?? null,
	// The game's icon by way of paude (cabinetIcon), from the page's own origin, so the universe can draw it on its canvas
	icon: game.look?.icon ? `/api/cabinets/${encodeURIComponent(game.id)}/icon?v=${game.look.iconVersion ?? 0}` : null,
	hubIcon: game.look?.icon ? new URL(game.look.icon, `${hubUrl}/`).href : null,
	url: game.publicUrl || game.lanUrl || null,
	running: Boolean(game.unit?.active ?? game.health?.ok),
	players: game.report?.connections ?? 0,
	watched: !unwatched.has(game.id),
});

// Every game on the hub as a cabinet, watched or not; none when there's no hub, or it can't be asked
export const allCabinets = async ({ now = Date.now(), hub } = {}) => {
	if (now - known.at < ASK_EVERY_MS) return known.games.map(game => ({ ...game, watched: !unwatched.has(game.id) }));

	const connected = hub ?? (await connectedHub().catch(() => null));
	const games = connected ? await askHub(connected, '/api/games').catch(() => null) : [];

	if (!Array.isArray(games)) return known.games;
	known = { at: now, games: games.map(game => cabinetOf(game, connected.url)), host: await gameHost(connected) };

	return known.games;
};

// The cabinets the lounge shows: the watched ones
export const watchedCabinets = async options => (await allCabinets(options)).filter(cabinet => cabinet.watched);

export const watchCabinet = async (id, watch) => {
	if (watch) unwatched.delete(id);
	else unwatched.add(id);
	if (file) await writeJsonFile(file, () => ({ unwatched: [...unwatched] }));
};

// Where the hub's games listen, from here: this machine when the hub is on it, else the hub's own machine (each game on
// its own port there)
const gameHost = async hub => {
	if (!hub) return null;

	const { hostname } = new URL(hub.url);

	if (['127.0.0.1', 'localhost', '::1'].includes(hostname)) return '127.0.0.1';

	const address = (await lookup(hostname).catch(() => null))?.address;
	const own = Object.values(os.networkInterfaces())
		.flat()
		.map(found => found?.address);

	return address && own.includes(address) ? '127.0.0.1' : (address ?? hostname);
};

// What paude's preview listener serves for a cabinet, so the game can be played inside paude's own page over https
// (the hub's games are plain http): a port share named game-<id>, at the game's own port. null for no such cabinet.
export const CABINET_SHARE = /^game-(.+)$/;

export const cabinetShare = name => {
	const id = CABINET_SHARE.exec(name ?? '')?.[1];
	const cabinet = id && known.games.find(game => game.id === id);

	if (!cabinet?.port || !known.host) return null;

	return { name, kind: 'port', host: known.host, port: cabinet.port, cabinet: id };
};

// A cabinet's game icon, fetched from the hub as its token: { body, type }, or null when it has none or the hub won't
// give it. Kept a while, by game and version, since the universe asks for it on every load.
const icons = new Map();

export const cabinetIcon = async id => {
	const cabinet = known.games.find(game => game.id === id) ?? (await allCabinets()).find(game => game.id === id);

	if (!cabinet?.hubIcon) return null;
	if (icons.has(cabinet.hubIcon)) return icons.get(cabinet.hubIcon);

	const hub = await connectedHub().catch(() => null);
	const response = hub
		? await fetch(cabinet.hubIcon, { headers: { authorization: `Bearer ${hub.token}` } }).catch(() => null)
		: null;

	if (!response?.ok) return null;

	const icon = {
		body: new Uint8Array(await response.arrayBuffer()),
		type: response.headers.get('content-type') ?? 'image/png',
	};

	icons.set(cabinet.hubIcon, icon);

	return icon;
};

// For tests: forget what was last asked
export const forgetCabinets = () => {
	known = { at: 0, games: [], host: null };
};
