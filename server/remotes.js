import { allTokens, serverNames } from '../shared/credentials';
import { serverApi, visitServer } from '../shared/serverClient';
import { getServerId } from './auth';

// The tokens in the paude command's credentials file stay on this server; the browser only gets what they fetch
const remoteServers = async () => {
	const names = await serverNames();

	return Object.entries(await allTokens()).map(([url, token]) => ({
		url,
		token,
		name: names[url] ?? new URL(url).host,
	}));
};

// One reached by another address that turns out to be this server is left out
export const listRemotes = async () => {
	const remotes = await Promise.all(
		(await remoteServers()).map(async server => {
			const { serverId, watching, sessions, error } = await visitServer(server);

			if (serverId && serverId === getServerId()) return null;

			return { url: server.url, name: server.name, ...(error ? { error } : { watching, sessions }) };
		}),
	);

	return remotes.filter(Boolean);
};

export const remoteLink = async (url, sessionId) => {
	const server = (await remoteServers()).find(remote => remote.url === url);

	if (!server || typeof sessionId !== 'string' || !/^[\w-]+$/.test(sessionId)) return null;

	const { code } = await serverApi(server, '/api/handoff', { method: 'POST' });

	return `${server.url}/#/handoff/${code}/sessions/${sessionId}`;
};
