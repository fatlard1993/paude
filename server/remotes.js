import { allTokens, serverNames } from '../shared/credentials';
import { serverApi, serverPage, visitServer } from '../shared/serverClient';
import { getServerId } from './auth';

// The tokens in the paude command's credentials file stay on this server; the browser only gets what they fetch
const remoteServers = async () => {
	const names = await serverNames();

	return Object.entries(await allTokens()).map(([url, token]) => ({
		url,
		token,
		alias: names[url],
	}));
};

// One reached by another address that turns out to be this server is left out
export const listRemotes = async () => {
	const remotes = await Promise.all(
		(await remoteServers()).map(async server => {
			const { serverId, name, watching, sessions, projects, error } = await visitServer(server);

			if (serverId && serverId === getServerId()) return null;

			return {
				url: server.url,
				name: server.alias ?? name ?? new URL(server.url).host,
				...(error ? { error } : { watching, sessions, projects }),
			};
		}),
	);

	return remotes.filter(Boolean);
};

// A link that logs this browser in there and opens a session, or a project page
export const remoteLink = async (url, { sessionId, project, draft }) => {
	const server = (await remoteServers()).find(remote => remote.url === url);
	const to =
		(typeof sessionId === 'string' && /^[\w-]+$/.test(sessionId) && `/sessions/${sessionId}`) ||
		(typeof project === 'string' && project && !project.includes('/') && `/projects/${encodeURIComponent(project)}`);

	if (!server || !to) return null;

	const { code } = await serverApi(server, '/api/handoff', { method: 'POST' });

	// A prompt for the project page to start with, carried in the link since the page there can't read this one's storage
	const carried = draft && to.startsWith('/projects/') ? `/draft/${encodeURIComponent(draft)}` : '';

	return `${server.url}/#/handoff/${code}${to}${carried}`;
};

// A page of a server's sessions (newest first, searched by q), as its /api/sessions answers it; null for a server
// this machine isn't logged into
export const remoteSessions = async (url, { q, offset, limit }) => {
	const server = (await remoteServers()).find(remote => remote.url === url);

	if (!server) return null;

	const query = new URLSearchParams(Object.entries({ q, offset, limit }).filter(([, value]) => value !== undefined));

	return serverPage(server, `/api/sessions?${query}`);
};

// Every other server this machine is logged into as its owner, with the name it goes by: { server, name }
export const ownedRemotes = async () => {
	const visited = await Promise.all(
		(await remoteServers()).map(async server => {
			try {
				const { identity, serverId, name } = await serverApi(server, '/api/auth');

				if (!identity?.owner || serverId === getServerId()) return null;

				return { server, name: server.alias ?? name ?? new URL(server.url).host };
			} catch {
				return null;
			}
		}),
	);

	return visited.filter(Boolean);
};

// A call to one of those servers, as its owner: its JSON, null for no content, and undefined for a server this
// machine isn't logged into
export const remoteApi = async (url, route, init) => {
	const server = (await remoteServers()).find(remote => remote.url === url);

	return server ? serverApi(server, route, init) : undefined;
};
