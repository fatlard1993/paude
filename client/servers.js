// The other servers this machine is logged into, as the watch alerts or the home page last found them:
// [{ url, name, error?, projects?, watching? }], or null before anyone has looked
let servers = null;
const listeners = new Set();

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

// The same server keeps the same color wherever it shows
export const hueOf = name => [...name].reduce((hash, character) => (hash * 31 + character.codePointAt(0)) % 360, 7);
