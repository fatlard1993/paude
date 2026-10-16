import { openDiffSet, openFile } from './fileBrowser';
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
		verification: () => call('/verification'),
		catchUp: since => send('POST', '/catch-up', { since }),
		tour: subject => send('POST', '/tour', subject),
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

			// Read as Claude made it, wherever that was: not a file of the project's to comment on
			return { ...openFile(path, await response.text()), outside: true };
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

// Where comments are on what the reader has open. `openOn(path, inDiff)` lists the open comments on a file;
// `diffSet(source)` reads a diff again.
export const commentMarks = (data, { openOn, diffSet, wait = 100 }) => {
	let timer = null;

	// Where the open comments on it are: in the file now, or on each side of the diff. Each load is stamped on what it's
	// for, so an older answer arriving after a newer one is dropped
	const load = async opened => {
		if (!opened || opened.error || opened.image || opened.outside) return;

		const stamp = (opened.marksAsked ?? 0) + 1;

		opened.marksAsked = stamp;

		if (!opened.diff) {
			const found = openOn(opened.path).length ? await data.git('anchors', { path: opened.path }) : {};

			if (opened.marksAsked === stamp) opened.comments = found.error ? {} : found;

			return;
		}

		const found = await Promise.all(
			opened.set.files
				.filter(file => (file.blobs?.old || file.blobs?.new) && openOn(file.path, true).length)
				.map(async ({ path: file, blobs }) => {
					const where = await data.git('anchors', { path: file, ...blobs });

					return [file, where.error ? {} : where];
				}),
		);

		if (opened.marksAsked === stamp) opened.comments = Object.fromEntries(found);
	};

	// Several notes at once (a pull request's threads brought in) reload the marks once, after the last
	const soon = (opened, then) => {
		clearTimeout(timer);
		timer = setTimeout(() => {
			timer = null;
			load(opened).then(then);
		}, wait);
	};

	// A resolved comment is asked for by its id, as only open ones are found otherwise
	const anchors = (comment, query) =>
		data.git('anchors', { ...query, ...(comment.resolved && { comment: comment.id }) });

	// Where a comment's lines are now: { diff } marking them in the diff it was written in, else { from, to } in the
	// file, or { hint } alone when they're on lines no diff here shows; with a hint when they may not be where it says
	const locate = async comment => {
		const { anchor, resolved } = comment;
		const unsure = resolved && 'It is resolved, so these are the lines it was on; they may have moved since.';
		const saved = { from: anchor.from, to: anchor.to };

		if (anchor.diff) {
			const { set, error } = await diffSet(anchor.diff);
			const opened = !error && openDiffSet(set, anchor.diff);
			const file = opened && set.files.find(({ path }) => path === anchor.path);

			if (opened) await load(opened);

			const where =
				file && resolved && (file.blobs?.old || file.blobs?.new)
					? (await anchors(comment, { path: anchor.path, ...file.blobs }))?.[comment.id]
					: opened?.comments?.[anchor.path]?.[comment.id];

			if (where?.new || where?.old)
				return {
					diff: Object.assign(opened, {
						focus: { path: anchor.path, ...(where.new && { new: where.new }), ...(where.old && { old: where.old }) },
					}),
				};

			// Not found as it is now: a resolved one is shown on the lines it was saved with, if the diff has its file
			if (file && resolved && where === undefined)
				return {
					diff: Object.assign(opened, {
						focus: { path: anchor.path, [anchor.side]: saved, ...(anchor.old && { old: anchor.old }) },
					}),
					hint: unsure,
				};
		}
		if (anchor.side === 'old')
			return {
				hint: anchor.diff
					? 'The change it is on is not in that diff any more.'
					: 'It is on lines before a change, which no diff here shows.',
			};

		const now = (await anchors(comment, { path: anchor.path }))?.[comment.id];

		if (now === null) return { ...saved, hint: 'Its lines have changed since; this is where they were.' };
		if (now === undefined && resolved) return { ...saved, hint: unsure };

		return now ?? saved;
	};

	return { load, soon, locate };
};

export default sessionData;
