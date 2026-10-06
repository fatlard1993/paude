import { searchParameters } from '../shared/searchQuery';
import { openFile } from './fileBrowser';
import { IMAGE_EXTENSIONS, pngSize, showsImages, toPng } from './graphics';

// A session's project as the terminal reader sees it, read through the server with this login's role
const sessionFiles = ({ url, token }, id) => {
	const get = path =>
		fetch(`${url}/api/sessions/${id}/${path}`, { headers: { authorization: `Bearer ${token}` } }).catch(() => null);

	const readImage = async path => {
		const response = await get(`raw?path=${encodeURIComponent(path)}`);
		const png = response?.ok ? await toPng(new Uint8Array(await response.arrayBuffer())) : null;

		if (png) return { path, image: { png, ...pngSize(png) } };

		return { path, error: response?.ok ? 'This image needs ImageMagick to show here.' : 'Could not open it.' };
	};

	return {
		list: async () => {
			const response = await get('files');

			if (!response?.ok)
				throw new Error(response?.status === 403 ? 'Your invite does not include files.' : 'Could not list files.');

			return response.json();
		},

		// What the reader opens: highlighted lines, an image it can place, or why neither
		read: async (path, line) => {
			if (showsImages() && IMAGE_EXTENSIONS.has(path.split('.').at(-1).toLowerCase())) return readImage(path);

			const response = await get(`file?path=${encodeURIComponent(path)}`);
			const text = response ? await response.text() : 'Could not reach the server.';

			return response?.ok ? openFile(path, text, line) : { path, error: text || 'Could not open it.' };
		},

		// What changed since the last commit; null outside git
		changes: async () => {
			const response = await get('changes');

			return response?.ok ? response.json() : null;
		},

		diff: async path => {
			const response = await get(`diff?path=${encodeURIComponent(path)}`);
			const text = response ? await response.text() : 'Could not reach the server.';

			return response?.ok ? { text } : { error: text || 'Could not show its changes.' };
		},

		search: async (query, options) => {
			const response = await get(`search?${new URLSearchParams(searchParameters(query, options))}`);
			const body = response ? await response.text() : 'Could not reach the server.';

			return response?.ok ? { results: JSON.parse(body) } : { error: body || 'Search failed.' };
		},
	};
};

export default sessionFiles;
