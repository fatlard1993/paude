import { huesApart } from '../shared/hues';
import { serverName } from './identity';

// The other servers this machine is logged into, as the watch alerts or the home page last found them:
// [{ url, name, error?, projects?, watching? }], or null before anyone has looked
let servers = null;
const listeners = new Set();

// The other servers as last found, for a page that needs them before asking again: the reachable ones
export const knownServers = () => (servers ?? []).filter(server => !server.error);

export const setServers = found => {
	servers = found;
	for (const listener of listeners) listener(servers);
};

// Called now and on every change; returns the way to stop
export const onServersChange = listener => {
	listeners.add(listener);
	listener(servers);

	return () => listeners.delete(listener);
};

// How many hues the fleet's wheel has: ships stand 45 degrees apart, so no two read alike
const SHIP_HUES = 8;

const hashOf = name => [...name].reduce((hash, character) => (hash * 31 + character.codePointAt(0)) % 360, 7);

let settled = { key: null, hues: new Map() };

// Each ship's hue, the fleet's settled apart: this machine's and every server known, by name
const fleetHues = () => {
	const names = [serverName() ?? 'this machine', ...(servers ?? []).map(({ name }) => name)];
	const key = names.join('\n');

	if (settled.key !== key)
		settled = {
			key,
			hues: huesApart(
				names.map(name => ({ name, hue: hashOf(name) })),
				{ slots: SHIP_HUES },
			),
		};

	return settled.hues;
};

// The same server keeps the same color wherever it shows, and no two of the fleet share one: its own from its name,
// or the nearest free hue of the fleet's wheel when another ship before it by name has that one
export const hueOf = name => fleetHues().get(name) ?? hashOf(name);
