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
let known = { at: 0, games: [] };

export const initCabinets = async dataDir => {
	file = path.join(dataDir, 'cabinets.json');
	unwatched = new Set((await readJsonFile(file, {})).unwatched ?? []);
};

// A hub game as a cabinet: what it's called, its colors and icon, where it's played, and whether it's on
export const cabinetOf = (game, hubUrl) => ({
	id: game.id,
	title: game.look?.title || game.name || game.id,
	color: game.look?.color ?? null,
	background: game.look?.background ?? null,
	icon: game.look?.icon ? new URL(game.look.icon, `${hubUrl}/`).href : null,
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
	known = { at: now, games: games.map(game => cabinetOf(game, connected.url)) };

	return known.games;
};

// The cabinets the lounge shows: the watched ones
export const watchedCabinets = async options => (await allCabinets(options)).filter(cabinet => cabinet.watched);

export const watchCabinet = async (id, watch) => {
	if (watch) unwatched.delete(id);
	else unwatched.add(id);
	if (file) await writeJsonFile(file, () => ({ unwatched: [...unwatched] }));
};

// For tests: forget what was last asked
export const forgetCabinets = () => {
	known = { at: 0, games: [] };
};
