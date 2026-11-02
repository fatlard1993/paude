import os from 'os';

import { allTokens, normalizeUrl, saveToken, serverNames } from '../shared/credentials';
import { trustedCertificates } from '../shared/certificates';
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

// A link that logs this browser in there and opens a session, a project page, or its home page
export const remoteLink = async (url, { sessionId, project, home, draft, lifetime }) => {
	const server = (await remoteServers()).find(remote => remote.url === url);
	const to =
		(typeof sessionId === 'string' && /^[\w-]+$/.test(sessionId) && `/sessions/${sessionId}`) ||
		(typeof project === 'string' && project && !project.includes('/') && `/projects/${encodeURIComponent(project)}`) ||
		(home === true && '');

	if (!server || typeof to !== 'string') return null;

	const { code } = await serverApi(server, '/api/handoff', { method: 'POST' });

	// A prompt for the project page to start with, carried in the link since the page there can't read this one's storage
	const forProject = to.startsWith('/projects/');
	const carried = [
		forProject && /^(warm|brief)$/.test(lifetime ?? '') && `/lifetime/${lifetime}`,
		forProject && draft && `/draft/${encodeURIComponent(draft)}`,
	]
		.filter(Boolean)
		.join('');

	return `${server.url}/#/handoff/${code}${to}${carried}`;
};

// A page of a server's sessions (newest first, searched by q), as its /api/sessions answers it; null for a server
// this machine isn't logged into
export const remoteSessions = async (url, { q, filter, project, offset, limit }) => {
	const server = (await remoteServers()).find(remote => remote.url === url);

	if (!server) return null;

	const query = new URLSearchParams(
		Object.entries({ q, filter, project, offset, limit }).filter(([, value]) => value !== undefined),
	);

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

const CONNECT_TIMEOUT_MS = 10_000;

// This machine logged into another paude with its owner password, as `paude login <url>` does, so it joins the
// universe as an engine; the command's default server is left as it was. { name } once done, or { status, error } with
// what to tell the person
export const connectRemote = async ({ url: given, password, name }) => {
	if (typeof given !== 'string' || !given.trim()) return { status: 400, error: 'Give its address' };
	if (typeof password !== 'string' || !password) return { status: 400, error: 'Give its password' };

	let url;

	try {
		url = normalizeUrl(given.trim());
		new URL(url);
	} catch {
		return { status: 400, error: "That isn't an address" };
	}

	const reach = (route, init = {}) =>
		fetch(`${url}${route}`, { ...init, tls: trustedCertificates(), signal: AbortSignal.timeout(CONNECT_TIMEOUT_MS) });
	let response;

	try {
		const auth = await reach('/api/auth');
		const { serverId } = await auth.json().catch(() => ({}));

		if (serverId && serverId === getServerId()) return { status: 400, error: "That's this paude" };

		response = await reach('/api/tokens', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ password, name: os.hostname() }),
		});
	} catch (error) {
		return {
			status: 502,
			error: /CERT|SELF_SIGNED|ALTNAME/.test(error?.code ?? '')
				? "It answered with a certificate this machine doesn't trust"
				: `Nothing answered at ${url}`,
		};
	}

	// Not 401: to the browser that means its own login here has ended
	if (response.status === 401) return { status: 422, error: 'Wrong password' };
	if (response.status === 429)
		return { status: 429, error: `Too many tries; wait ${response.headers.get('retry-after') ?? 'a while'}s` };
	if (!response.ok) return { status: 502, error: `${url} answered ${response.status}; is it a paude?` };

	const { token } = await response.json();

	await saveToken(url, token, name?.trim() || undefined, { makeDefault: false });

	return { url, name: name?.trim() || new URL(url).host };
};
