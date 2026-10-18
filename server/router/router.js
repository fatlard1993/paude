import { hotReload, requestMatch, sameOrigin, serveApp, withErrors } from '@vanilla-bean/components/app';

import { setPeerAddress } from '../auth';
import authRoutes, { guard } from './auth';
import filesRoutes from './files';
import gitRoutes from './git';
import sharesRoutes from './shares';
import tasksRoutes from './tasks';
import hooksRoutes from './hooks';
import sessionsRoutes from './sessions';

// The page, revalidated on every load, and the built files. Forms post only here, nothing frames the page, and no
// <base> can repoint its links
const page = request =>
	serveApp(request, {
		headers: { 'Content-Security-Policy': "form-action 'self'; frame-ancestors 'none'; base-uri 'self'" },
	});

const router = async (request, server) => {
	let response;

	// WebSockets get no CORS protection: without this, any page the browser visits could attach and type into Claude
	if (!sameOrigin(request)) return new Response('Cross-origin request refused', { status: 403 });

	setPeerAddress(request, server?.requestIP?.(request)?.address);

	if (requestMatch('GET', '/', request)) return page(request);

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

	response = await page(request);
	if (response) return response;

	return new Response('Not Found', { status: 404 });
};

// A body that isn't JSON answers 400; anything else thrown is logged and answers 500
export default withErrors(router);
