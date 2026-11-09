import { createHash } from 'crypto';

// The port an arcade game's server is given: the same one each time for the same folder, so a server that starts over
// on every save (bun --watch) stays at the address its page was showing, the next free one along when that's taken
const FIRST = 41000;
const SPAN = 1000;

const free = port => {
	try {
		Bun.serve({ port, fetch: () => new Response() }).stop(true);

		return true;
	} catch {
		return false;
	}
};

export const gamePort = (folder, isFree = free) => {
	const start = createHash('sha256').update(folder).digest().readUInt32BE(0) % SPAN;

	for (let step = 0; step < SPAN; step++) {
		const port = FIRST + ((start + step) % SPAN);

		if (isFree(port)) return port;
	}

	return null;
};
