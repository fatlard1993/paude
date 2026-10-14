import { openFile } from './fileBrowser';
import { IMAGE_EXTENSIONS, pngSize, showsImages, toPng } from './graphics';

// What the web's side panels show of a session, read through the server with this login's role: each resolves to
// its JSON, or { error } saying why not
const sessionData = ({ url, token }, id) => {
	const call = async (path, init = {}) => {
		const response = await fetch(`${url}/api/sessions/${id}${path}`, {
			...init,
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
		}).catch(() => null);

		if (!response) return { error: 'Could not reach the server.' };
		if (!response.ok) return { error: (await response.text()) || `The server said ${response.status}.` };

		return response.status === 204 ? {} : response.json();
	};
	const send = (method, path, body) => call(path, { method, body: JSON.stringify(body) });

	return {
		detail: () => call(''),
		meter: () => call('/meter'),
		links: () => call('/links'),
		markLink: (link, change) => send('POST', '/links/mark', { url: link, ...change }),
		artifacts: () => call('/artifacts'),
		timeline: () => call('/timeline'),
		catchUp: since => send('POST', '/catch-up', { since }),
		git: (what, query = {}) => call(`/git/${what}?${new URLSearchParams(query)}`),
		shares: () => call('/shares'),
		setWatching: watching => send('PUT', '/watch', { watching }),
		setLifetime: lifetime => send('PUT', '/lifetime', { lifetime }),

		// An artifact as the reader opens it, wherever it was made: highlighted lines, or an image it can place
		readArtifact: async path => {
			const response = await fetch(`${url}/api/sessions/${id}/artifact?path=${encodeURIComponent(path)}`, {
				headers: { authorization: `Bearer ${token}` },
			}).catch(() => null);

			if (!response?.ok) return { path, error: 'Could not open it.' };
			if (showsImages() && IMAGE_EXTENSIONS.has(path.split('.').at(-1).toLowerCase())) {
				const png = await toPng(new Uint8Array(await response.arrayBuffer()));

				return png
					? { path, image: { png, ...pngSize(png) } }
					: { path, error: 'This image needs ImageMagick to show here.' };
			}

			return openFile(path, await response.text());
		},

		// An artifact's bytes, to save on this machine
		artifactBytes: async path => {
			const response = await fetch(`${url}/api/sessions/${id}/artifact?path=${encodeURIComponent(path)}&download=1`, {
				headers: { authorization: `Bearer ${token}` },
			}).catch(() => null);

			return response?.ok ? new Uint8Array(await response.arrayBuffer()) : null;
		},
	};
};

export default sessionData;
