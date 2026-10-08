import { hotReload, requestMatch, serveStatic } from '@vanilla-bean/components/app';

import { setPeerAddress } from '../auth';
import authRoutes, { guard } from './auth';
import filesRoutes from './files';
import gitRoutes from './git';
import sharesRoutes from './shares';
import tasksRoutes from './tasks';
import hooksRoutes from './hooks';
import sessionsRoutes from './sessions';

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

		// The bundler copies the manifest but not the icons it names, so they're served from where they sit
		const icon =
			request.method === 'GET' && new URL(request.url).pathname.match(/^\/(icon-(?:192|512|maskable-512)\.png)$/);

		if (icon) return new Response(Bun.file(`client/${icon[1]}`), { headers: { 'cache-control': 'no-cache' } });

		if (hotReload.upgrade(request, server)) return;

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

		response = await sharesRoutes(request);
		if (response) return response;

		response = await tasksRoutes(request);
		if (response) return response;

		response = await sessionsRoutes(request, server);
		if (response !== null) return response;

		response = await serveStatic(request);
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
