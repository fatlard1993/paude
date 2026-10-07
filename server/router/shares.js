import { stat } from 'fs/promises';
import path from 'path';

import { credentialOf, identityOf } from '../auth';
import { isSecret } from '../files';
import { may } from '../permissions';
import { serverSettings } from '../serverSettings';
import { sessionRecord } from '../sessions/record';
import { ShareError, addShare, removeShare, sharesOf } from '../shares';
import requestMatch from '../utils/requestMatch';

// Behind Caddy, the preview listener's public port; Caddy's paude site is on 443, its preview site on this
const PUBLIC_PREVIEW_PORT = 8444;

let previewPort;

export const setPreviewPort = port => {
	previewPort = port;
};

// Where this browser reaches shares: the preview listener itself when it reached paude directly (localhost:8044),
// or the port in front of it when through a proxy. server.json's `previewPort` names that port when it isn't 8444.
const previewOrigin = async request => {
	const url = new URL(request.url);
	const proto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
	const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? url.host;
	const hostname = host.replace(/:\d+$/, '');
	const direct = /:\d+$/.test(host) && !request.headers.get('x-forwarded-for');
	const port = direct ? previewPort : ((await serverSettings()).previewPort ?? PUBLIC_PREVIEW_PORT);

	return `${proto}://${hostname}:${port}`;
};

const withLinks = (shares, origin) =>
	shares.map(share => ({ ...share, url: `${origin}/s/${encodeURIComponent(share.name)}/` }));

// A path in the session's folder, the kind of thing the share is: a file, or a folder (to zip or serve)
const checkedPath = async (cwd, kind, wanted) => {
	if (kind === 'port') return undefined;
	if (typeof wanted !== 'string' || !wanted.trim()) throw new ShareError('Name a file or folder in the project');

	const relative = path.normalize(wanted.trim()).replace(/^(\.\/)+|\/+$/g, '') || '.';
	const info = await stat(path.resolve(cwd, relative)).catch(() => null);

	if (relative.startsWith('..') || path.isAbsolute(relative) || isSecret(relative))
		throw new ShareError("That's not in the project");
	if (!info) throw new ShareError(`There's nothing at ${relative}`);
	if (kind === 'file' && !info.isFile())
		throw new ShareError(`${relative} is a folder; share it as a folder or a site`);
	if (kind !== 'file' && !info.isDirectory()) throw new ShareError(`${relative} is a file`);

	return relative;
};

const downloadKind = async (cwd, wanted) =>
	typeof wanted === 'string' && (await stat(path.resolve(cwd, wanted.trim())).catch(() => null))?.isDirectory()
		? 'folder'
		: 'file';

// A session's shares: anyone who can see the session sees the list (each is theirs to open); sharing something
// puts it in front of everyone who can see the session, so it takes the role that may type into Claude
const sharesRoutes = async request => {
	const listing = requestMatch('GET', '/api/sessions/:id/shares', request);
	const adding = requestMatch('POST', '/api/sessions/:id/shares', request);
	const removing = requestMatch('DELETE', '/api/sessions/:id/shares/:share', request);
	const match = listing || adding || removing;

	if (!match) return null;

	const identity = identityOf(credentialOf(request));

	if (!identity || !(identity.owner || identity.sessionId === match.id))
		return new Response('Not part of your invite', { status: 403 });
	if (!listing && !may(identity, 'type', match.id))
		return new Response('Your invite does not include sharing', { status: 403 });

	const record = await sessionRecord(match.id);

	if (!record) return new Response('Session not found', { status: 404 });

	const origin = await previewOrigin(request);

	if (listing) return Response.json({ shares: withLinks(sharesOf(match.id), origin), origin });
	if (removing)
		return (await removeShare(match.id, match.share))
			? new Response(null, { status: 204 })
			: new Response('No such share', { status: 404 });

	try {
		const { kind: asked, port, path: wanted } = await request.json();
		// A download is the file itself, or a folder zipped
		const kind = asked === 'download' ? await downloadKind(record.cwd, wanted) : asked;
		const share = await addShare(match.id, { kind, port, path: await checkedPath(record.cwd, kind, wanted) });

		return Response.json(withLinks([share], origin)[0]);
	} catch (error) {
		if (error instanceof ShareError) return new Response(error.message, { status: 400 });
		throw error;
	}
};

export default sharesRoutes;
