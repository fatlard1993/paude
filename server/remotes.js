import { allTokens, serverNames } from '../cli/credentials';
import { getServerId } from './auth';

const TIMEOUT_MS = 5000;

// The other paudes this user's terminal is logged into, read from the same credentials file the paude command keeps.
// The tokens stay here; the browser only gets what they fetch.
const remoteServers = async () => {
	const names = await serverNames();

	return Object.entries(await allTokens()).map(([url, token]) => ({
		url,
		token,
		name: names[url] ?? new URL(url).host,
	}));
};

const fetchJson = async ({ url, token }, path, init = {}) => {
	const response = await fetch(`${url}${path}`, {
		...init,
		signal: AbortSignal.timeout(TIMEOUT_MS),
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
	});

	if (!response.ok)
		throw new Error(response.status === 401 ? 'the saved login has ended' : `answered ${response.status}`);

	return response.json();
};

// Each one's watched and recent sessions; one that turns out to be this server, reached by another address, is left out
export const listRemotes = async () => {
	const remotes = await Promise.all(
		(await remoteServers()).map(async server => {
			const summary = { url: server.url, name: server.name };

			try {
				const { identity, serverId } = await fetchJson(server, '/api/auth');

				if (serverId === getServerId()) return null;
				if (!identity) throw new Error('the saved login has ended');

				const [watching, sessions] = await Promise.all([
					fetchJson(server, '/api/watching'),
					identity.owner ? fetchJson(server, '/api/sessions?limit=8') : [],
				]);

				return { ...summary, watching, sessions };
			} catch (error) {
				return { ...summary, error: error.name === 'TimeoutError' ? 'not answering' : error.message };
			}
		}),
	);

	return remotes.filter(Boolean);
};

// A link that opens a session on another paude already logged in, good once, for a minute
export const remoteLink = async (url, sessionId) => {
	const server = (await remoteServers()).find(remote => remote.url === url);

	if (!server || typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) return null;

	const { code } = await fetchJson(server, '/api/handoff', { method: 'POST' });

	return `${server.url}/#/handoff/${code}/sessions/${sessionId}`;
};
