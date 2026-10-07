import { trustedCertificates } from './certificates';
import { byRecentActivity } from './projects';

const TIMEOUT_MS = 8000;

const serverFetch = async ({ url, token }, route, init = {}) => {
	const response = await fetch(`${url}${route}`, {
		...init,
		tls: trustedCertificates(),
		signal: init.signal ?? AbortSignal.timeout(TIMEOUT_MS),
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
	});

	if (response.status === 401) throw new Error(`the saved login has ended; run: paude login ${url}`);
	if (!response.ok) throw new Error((await response.text()) || `${url}${route} answered ${response.status}`);

	return response;
};

export const serverApi = async (server, route, init) => {
	const response = await serverFetch(server, route, init);

	return response.status === 204 ? null : response.json();
};

// A page of a listing and how many there are in all (x-total-count)
export const serverPage = async (server, route) => {
	const response = await serverFetch(server, route);

	return { items: await response.json(), total: Number(response.headers.get('x-total-count') ?? 0) };
};

// What one server has for this person: an owner's watched and recent sessions and projects, a guest's one session
// (listed watched or not), and the name the server goes by. { identity, serverId, name, watching, sessions, projects },
// or { error }.
export const visitServer = async server => {
	try {
		const { identity, serverId, name } = await serverApi(server, '/api/auth');

		if (!identity) throw new Error(`the saved login has ended; run: paude login ${server.url}`);

		if (!identity.owner) {
			const [watching, own] = await Promise.all([
				serverApi(server, '/api/watching'),
				serverApi(server, `/api/sessions/${identity.sessionId}`).catch(() => null),
			]);

			return { identity, serverId, name, watching, sessions: own ? [own] : [], projects: [] };
		}

		const [watching, sessions, projects] = await Promise.all([
			serverApi(server, '/api/watching'),
			serverApi(server, '/api/sessions?limit=8'),
			serverApi(server, '/api/projects'),
		]);

		return { identity, serverId, name, watching, sessions, projects: projects.sort(byRecentActivity) };
	} catch (error) {
		return { error: error.name === 'TimeoutError' ? 'not answering' : error.message };
	}
};
