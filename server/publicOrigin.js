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

// The address an invite link carries: server.json's `publicUrl` where there is one, else where this request came in.
// An invite made from a laptop's .local address has to open from wherever the guest is.
export const publicOrigin = (request, settings) => cleanPublicUrl(settings.publicUrl) ?? requestOrigin(request);

// Where this browser reaches shares, beside where it reached paude: the preview listener itself when it came in
// directly (localhost:8044), else the preview port in front of the proxy it came through. A proxy on a port of its
// own (workbook.local:9443) has its preview on the next port; one on 443 has it on server.json's `previewPort`, 8444
// unless set. The viewer's own address, never `publicUrl`: a share is opened from the paude page beside it, so the
// address that page was reached at is the one that works for them.
const previewPortFor = (origin, { direct, listenerPort, settings }) => {
	if (direct) return listenerPort;
	if (origin.port) return Number(origin.port) + 1;

	return settings.previewPort ?? PUBLIC_PREVIEW_PORT;
};

export const previewOrigin = (request, { listenerPort, settings }) => {
	const origin = new URL(requestOrigin(request));
	const direct = Boolean(origin.port) && !request.headers.get('x-forwarded-for');

	return `${origin.protocol}//${origin.hostname}:${previewPortFor(origin, { direct, listenerPort, settings })}`;
};
