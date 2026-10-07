import { readdir, realpath, stat } from 'fs/promises';
import path from 'path';

import { credentialOf, identityOf } from './auth';
import { isSecret } from './files';
import { sessionRecord } from './sessions/record';
import { shareNamed } from './shares';
import { zipStream } from './zip';

// What sessions share, served on a listener of its own (the preview port): a different origin from paude, so the
// apps shown there (code Claude just wrote) can't reach paude's API as whoever is looking. The login cookie still
// comes along, being the same site, so only people logged in who can see the session get in.
//
// Each share is at /s/<name>/. An app that asks for an absolute path (/assets/app.js, /@vite/client) is routed by
// the page asking (its Referer), or failing that by a cookie naming the share last opened.
const PREFIX = /^\/s\/([^/]+)(\/.*)?$/;
const SHARE_COOKIE = 'paude-share';
const LOGIN_COOKIE = 'paude_login';
const MAX_ZIP_FILES = 20_000;

const cookies = request =>
	Object.fromEntries(
		(request.headers.get('cookie') ?? '')
			.split(';')
			.map(part => part.trim().split('='))
			.filter(([name]) => name)
			.map(([name, ...value]) => [name, value.join('=')]),
	);

const page = (status, title, text) =>
	new Response(
		`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title>` +
			`<body style="font:16px system-ui;background:#1b1b1b;color:#ddd;padding:2em"><h1>${title}</h1><p>${text}</p>`,
		{ status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } },
	);

// The share a request is for, and the path within it
const routeOf = request => {
	const url = new URL(request.url);
	const prefixed = PREFIX.exec(url.pathname);

	if (prefixed) return { name: decodeURIComponent(prefixed[1]), rest: prefixed[2], prefixed: true };

	const from = request.headers.get('referer');
	const referred = from && PREFIX.exec(new URL(from).pathname);

	return { name: referred ? decodeURIComponent(referred[1]) : cookies(request)[SHARE_COOKIE], rest: url.pathname };
};

const secure = request =>
	request.headers.get('x-forwarded-proto') === 'https' || new URL(request.url).protocol === 'https:';

const remember = (response, request, name) => {
	response.headers.append(
		'set-cookie',
		`${SHARE_COOKIE}=${encodeURIComponent(name)}; Path=/; HttpOnly; SameSite=Lax${secure(request) ? '; Secure' : ''}`,
	);

	return response;
};

// The app sees an ordinary request for itself: its own host, none of paude's cookies
const forwardedHeaders = (request, { port }) => {
	const headers = new Headers(request.headers);
	const kept = Object.entries(cookies(request)).filter(([name]) => ![LOGIN_COOKIE, SHARE_COOKIE].includes(name));

	headers.set('host', `localhost:${port}`);
	if (headers.has('origin')) headers.set('origin', `http://localhost:${port}`);
	headers.delete('referer');
	headers.delete('cookie');
	if (kept.length) headers.set('cookie', kept.map(([name, value]) => `${name}=${value}`).join('; '));
	for (const name of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'via']) headers.delete(name);

	return headers;
};

// The app's redirects to its own absolute paths stay under its share
const relocated = (location, name, { host, port }) => {
	if (!location) return location;

	const own = [`http://localhost:${port}`, `http://127.0.0.1:${port}`, `http://${host}:${port}`].find(origin =>
		location.startsWith(origin),
	);
	const pathPart = own ? location.slice(own.length) || '/' : location;

	return pathPart.startsWith('/') && !pathPart.startsWith('//') ? `/s/${name}${pathPart}` : location;
};

const proxy = async (request, share, target) => {
	let response;

	try {
		response = await fetch(`http://${share.host}:${share.port}${target}`, {
			method: request.method,
			headers: forwardedHeaders(request, share),
			body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
			redirect: 'manual',
			decompress: false,
		});
	} catch {
		return page(502, 'Nothing answers', `Nothing is listening on port ${share.port} right now.`);
	}

	const headers = new Headers(response.headers);

	if (headers.has('location')) headers.set('location', relocated(headers.get('location'), share.name, share));

	return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
};

// A shared path, resolved inside its session's folder (never out of it through a link, never a secret)
const sharedPath = async (share, within = '') => {
	const cwd = (await sessionRecord(share.sessionId))?.cwd;

	if (!cwd) return null;

	try {
		const root = await realpath(cwd);
		const base = await realpath(path.resolve(root, share.path));
		const target = await realpath(path.resolve(base, `.${path.posix.normalize(`/${within}`)}`));
		const inside = rel => !rel.startsWith('..') && !path.isAbsolute(rel);

		if (!inside(path.relative(root, base)) || !inside(path.relative(base, target))) return null;
		if (isSecret(path.relative(root, target))) return null;

		return { base, target };
	} catch {
		return null;
	}
};

const download = (file, name) =>
	new Response(file, {
		headers: {
			'content-type': file.type || 'application/octet-stream',
			'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
			'cache-control': 'private, no-cache',
		},
	});

const folderEntries = async function* folderEntries(folder) {
	const names = (await readdir(folder, { recursive: true })).sort();
	let count = 0;

	for (const name of names) {
		const parts = name.split(path.sep);

		if (parts.includes('.git') || isSecret(name)) continue;

		const full = path.join(folder, name);
		const info = await stat(full).catch(() => null);

		if (!info?.isFile()) continue;
		if (++count > MAX_ZIP_FILES) throw new Error('Too many files to zip');

		yield { name: parts.join('/'), modified: info.mtime, bytes: () => Bun.file(full).bytes() };
	}
};

const zipped = (folder, name) =>
	new Response(zipStream(folderEntries(folder)), {
		headers: {
			'content-type': 'application/zip',
			'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(`${name}.zip`)}`,
			'cache-control': 'private, no-cache',
		},
	});

// A folder as a website: a folder's index.html for a folder, and a single-page app's index.html for a path that
// isn't a file (no extension) when there's one at the top
const site = async (share, rest) => {
	const found = await sharedPath(share, rest);
	const info = found && (await stat(found.target).catch(() => null));

	if (info?.isFile()) return new Response(Bun.file(found.target), { headers: { 'cache-control': 'no-cache' } });

	if (info?.isDirectory()) {
		const index = Bun.file(path.join(found.target, 'index.html'));

		if (await index.exists()) return new Response(index, { headers: { 'cache-control': 'no-cache' } });
	}

	const top = await sharedPath(share, 'index.html');

	if (top && !path.extname(rest) && (await Bun.file(top.target).exists()))
		return new Response(Bun.file(top.target), { headers: { 'cache-control': 'no-cache' } });

	return page(404, 'Not found', 'Nothing at this path in the shared folder.');
};

// Logged in, and able to see the session the share is in
const allowedTo = (request, share) => {
	const identity = identityOf(credentialOf(request));

	return identity && (identity.owner || identity.sessionId === share.sessionId);
};

export const previewFetch = async (request, server) => {
	const { name, rest, prefixed } = routeOf(request);
	const share = name && shareNamed(name);

	if (!share) return page(404, 'Not shared', 'Nothing is shared at this address (any more).');
	if (!allowedTo(request, share))
		return page(401, 'Log in to paude first', 'Open paude in this browser and log in, then come back to this page.');

	// Relative links resolve against a folder
	if (prefixed && rest === undefined && ['port', 'site'].includes(share.kind))
		return Response.redirect(`/s/${encodeURIComponent(share.name)}/${new URL(request.url).search}`, 302);

	const target = `${rest ?? '/'}${new URL(request.url).search}`;

	if (share.kind === 'port') {
		if (request.headers.get('upgrade')?.toLowerCase() === 'websocket') {
			const protocols = request.headers.get('sec-websocket-protocol');
			const upgraded = server.upgrade(request, {
				data: {
					route: 'preview',
					target: `ws://${share.host}:${share.port}${target}`,
					protocols: protocols ? protocols.split(',').map(protocol => protocol.trim()) : [],
					headers: Object.fromEntries(forwardedHeaders(request, share)),
				},
				...(protocols && { headers: { 'Sec-WebSocket-Protocol': protocols.split(',')[0].trim() } }),
			});

			return upgraded ? undefined : new Response('Upgrade failed', { status: 400 });
		}

		return remember(await proxy(request, share, target), request, share.name);
	}

	if (share.kind === 'site') return remember(await site(share, rest ?? '/'), request, share.name);

	const found = await sharedPath(share);

	if (!found) return page(404, 'Gone', 'What was shared here is no longer there.');

	const info = await stat(found.target).catch(() => null);

	if (share.kind === 'file' && info?.isFile()) return download(Bun.file(found.target), path.basename(found.target));
	if (share.kind === 'folder' && info?.isDirectory()) return zipped(found.target, path.basename(found.target));

	return page(404, 'Gone', 'What was shared here is no longer there.');
};

// A WebSocket through to the app (Vite's live reload, say): what each side says goes to the other, and when one
// closes so does the other
export const previewSocket = {
	open(socket) {
		const { target, protocols, headers } = socket.data;
		const upstream = new WebSocket(target, { protocols, headers });
		const pending = [];

		socket.data.upstream = upstream;
		socket.data.pending = pending;
		upstream.binaryType = 'arraybuffer';
		upstream.addEventListener('open', () => {
			for (const message of pending.splice(0)) upstream.send(message);
		});
		upstream.addEventListener('message', event => socket.send(event.data));
		// 1005 and 1006 report a close without a code; they can't be sent on
		upstream.addEventListener('close', event =>
			socket.close(event.code >= 1000 && event.code < 1005 ? event.code : 1000, event.reason),
		);
		upstream.addEventListener('error', () => socket.close(1011, 'The app closed the connection'));
	},
	message(socket, message) {
		const { upstream, pending } = socket.data;

		if (upstream.readyState === WebSocket.OPEN) upstream.send(message);
		else pending.push(message);
	},
	close(socket) {
		socket.data.upstream?.close();
	},
};

export const startPreview = ({ host, port }) =>
	Bun.serve({
		hostname: host,
		port,
		maxRequestBodySize: 64 * 1024 * 1024,
		fetch: previewFetch,
		websocket: previewSocket,
	});
