// Behind a proxy, the preview listener's public port: the proxy's paude site is on 443, its preview site on this
export const PUBLIC_PREVIEW_PORT = 8444;

// A public address as server.json's `publicUrl` holds it: https, the host alone; anything else counts as none
export const cleanPublicUrl = url => {
	if (typeof url !== 'string') return null;

	try {
		const parsed = new URL(url.trim());

		if (parsed.protocol !== 'https:' || parsed.pathname !== '/' || parsed.search || parsed.hash) return null;

		return parsed.origin;
	} catch {
		return null;
	}
};

// Where the browser making this request reached paude: a proxy's address when it came through one, else the
// listener's own
export const requestOrigin = request => {
	const url = new URL(request.url);
	const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
	const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;

	return `${proto}://${host}`;
};

// The address a link made for someone else carries: server.json's `publicUrl` where there is one, else where this
// request came in. An invite made from a laptop's .local address has to open from wherever the guest is.
export const publicOrigin = (request, settings) => cleanPublicUrl(settings.publicUrl) ?? requestOrigin(request);

// Where this browser reaches shares: the preview listener itself when it reached paude directly (localhost:8044),
// else the preview port in front of the public address (server.json's `previewPort` when it isn't 8444)
export const previewOrigin = (request, { listenerPort, settings }) => {
	const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
	const direct = /:\d+$/.test(host) && !request.headers.get('x-forwarded-for');

	if (direct) return `${requestOrigin(request).replace(/:\d+$/, '')}:${listenerPort}`;

	const { protocol, hostname } = new URL(publicOrigin(request, settings));

	return `${protocol}//${hostname}:${settings.previewPort ?? PUBLIC_PREVIEW_PORT}`;
};
