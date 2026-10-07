import { nanoid } from 'nanoid';

import requestMatch from '../utils/requestMatch';

import { setPeerAddress } from '../auth';
import authRoutes, { guard } from './auth';
import filesRoutes from './files';
import gitRoutes from './git';
import hooksRoutes from './hooks';
import sessionsRoutes from './sessions';
import staticRoutes from './static';

// Every other build asset is content-hashed; the document must always revalidate, or a cached copy
// points at chunk hashes that no longer exist.
// Forms post only here, nothing frames the page, and no <base> can repoint its links
const PAGE_POLICY = "form-action 'self'; frame-ancestors 'none'; base-uri 'self'";

const indexResponse = () =>
	new Response(Bun.file('client/build/index.html'), {
		headers: { 'Cache-Control': 'no-cache', 'Content-Security-Policy': PAGE_POLICY },
	});

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

		setPeerAddress(request, server?.requestIP?.(request)?.address);

		if (requestMatch('GET', '/', request)) return indexResponse();

		// At the root so it may show notifications for every page
		if (requestMatch('GET', '/sw.js', request))
			return new Response(Bun.file('client/sw.js'), {
				headers: { 'content-type': 'text/javascript', 'cache-control': 'no-cache' },
			});

		if (process.env.NODE_ENV === 'development' && requestMatch('GET', '/ws', request)) {
			const success = server.upgrade(request, { data: { clientId: nanoid() } });

			return success ? undefined : new Response('WebSocket upgrade error', { status: 400 });
		}

		response = await hooksRoutes(request);
		if (response) return response;

		response = guard(request);
		if (response) return response;

		response = await authRoutes(request);
		if (response) return response;

		response = await filesRoutes(request);
		if (response) return response;

		response = await gitRoutes(request);
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
