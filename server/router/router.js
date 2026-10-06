import { nanoid } from 'nanoid';

import requestMatch from '../utils/requestMatch';

import authRoutes, { guard } from './auth';
import sessionsRoutes from './sessions';
import staticRoutes from './static';

// Every other build asset is content-hashed; the document must always revalidate, or a cached copy
// points at chunk hashes that no longer exist.
const indexResponse = () =>
	new Response(Bun.file('client/build/index.html'), { headers: { 'Cache-Control': 'no-cache' } });

// Writes and socket upgrades from another site's page (or a rebound DNS name) carry an Origin that isn't this host.
// WebSockets get no CORS protection, so without this any page the browser visits could attach and type into Claude.
const crossOrigin = request => {
	const origin = request.headers.get('origin');
	const guarded = request.method !== 'GET' || request.headers.get('upgrade');

	return guarded && origin && new URL(origin).host !== request.headers.get('host');
};

const router = async (request, server) => {
	try {
		let response;

		if (crossOrigin(request)) return new Response('Cross-origin request refused', { status: 403 });

		if (requestMatch('GET', '/', request)) return indexResponse();

		if (process.env.NODE_ENV === 'development' && requestMatch('GET', '/ws', request)) {
			const success = server.upgrade(request, { data: { clientId: nanoid() } });

			return success ? undefined : new Response('WebSocket upgrade error', { status: 400 });
		}

		response = guard(request);
		if (response) return response;

		response = await authRoutes(request);
		if (response) return response;

		response = await sessionsRoutes(request, server);
		if (response !== null) return response;

		response = await staticRoutes(request);
		if (response) return response;

		if (request.method === 'GET') return indexResponse();

		return new Response('Not Found', { status: 404 });
	} catch (error) {
		if (error instanceof SyntaxError) return new Response('Invalid JSON', { status: 400 });

		console.error('An error was encountered processing a request\n', error);

		return new Response('Server Error', { status: 500 });
	}
};

export default router;
