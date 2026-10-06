import { existsSync, mkdirSync, openSync } from 'fs';
import os from 'os';
import path from 'path';

import { allTokens, serverNames } from './credentials';

const START_TIMEOUT_MS = 10_000;

// local-token in the data folder logs this user in without a password
const LOCAL_URL = process.env.PAUDE_LOCAL_URL ?? 'http://127.0.0.1:8044';
const DATA_DIR = process.env.PAUDE_DATA ?? path.join(os.homedir(), '.paude');
const TOKEN_FILE = path.join(DATA_DIR, 'local-token');
const SERVER_ENTRY = path.join(import.meta.dir, '..', 'server', 'index.js');

const readLocalToken = async () =>
	(await Bun.file(TOKEN_FILE).exists()) ? (await Bun.file(TOKEN_FILE).text()).trim() : null;

const localServer = async () => ({ url: LOCAL_URL, token: await readLocalToken(), label: 'This machine', local: true });

// Whether this machine has run paude before; a fresh one isn't started until someone asks for it
const localKnown = () => existsSync(TOKEN_FILE);

// For paude doctor: whether this machine's paude answers, and is this machine's
export const localStatus = async () => {
	const answering = await answeringId(LOCAL_URL);

	if (answering === null) return { ok: true, detail: `not running; paude starts it when needed (${LOCAL_URL})` };
	if (answering === (await ownId())) return { ok: true, detail: `running on ${LOCAL_URL}` };

	return { ok: false, detail: `something else is answering on ${LOCAL_URL}; set PAUDE_LOCAL_URL to a free address` };
};

// Its sessions end, and resume when opened again
export const stopLocalServer = async () => {
	const file = Bun.file(path.join(DATA_DIR, 'server.pid'));
	const pid = (await file.exists()) ? Number((await file.text()).trim()) : null;

	if (!pid || (await answeringId(LOCAL_URL)) === null) return false;

	process.kill(pid, 'SIGTERM');
	for (let wait = 0; wait < 50 && (await answeringId(LOCAL_URL)) !== null; wait++) await Bun.sleep(100);

	return true;
};

export const api = async ({ url, token }, route, init = {}) => {
	const response = await fetch(`${url}${route}`, {
		...init,
		signal: init.signal ?? AbortSignal.timeout(8000),
		headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers },
	});

	if (response.status === 401) throw new Error(`${url} refused the saved login; run: paude login ${url}`);
	if (!response.ok) throw new Error((await response.text()) || `${url}${route} answered ${response.status}`);

	return response.status === 204 ? null : response.json();
};

// The id something on the address reports, or null when nothing answers there
const answeringId = async url => {
	try {
		const response = await fetch(`${url}/api/auth`, { signal: AbortSignal.timeout(1000) });

		return response.ok ? ((await response.json()).serverId ?? '') : null;
	} catch {
		return null;
	}
};

const ownId = async () => {
	const file = Bun.file(path.join(DATA_DIR, 'server-id'));

	return (await file.exists()) ? (await file.text()).trim() : null;
};

// The token only goes to this machine's own paude: whatever else holds the address (another user's process, a
// tunnel) is refused before it can see it
const verifyOwn = async answering => {
	if (answering && answering === (await ownId())) return;

	throw new Error(
		`Something other than this machine's paude is answering on ${LOCAL_URL}. Stop it (an older paude stops with paude stop), or set PAUDE_LOCAL_URL to a free address.`,
	);
};

// Started in the background when it isn't running, logging to the data folder
export const ensureLocalServer = async () => {
	const answering = await answeringId(LOCAL_URL);

	if (answering !== null) await verifyOwn(answering);
	else {
		const { hostname, port } = new URL(LOCAL_URL);

		mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

		const log = openSync(path.join(DATA_DIR, 'server.log'), 'a', 0o600);
		const child = Bun.spawn(['bun', SERVER_ENTRY, '--host', hostname, '--port', port || '80', '--data', DATA_DIR], {
			cwd: path.dirname(path.dirname(SERVER_ENTRY)),
			env: { ...process.env, NODE_ENV: 'production' },
			stdio: ['ignore', log, log],
		});

		child.unref();

		let exited = false;
		const deadline = Date.now() + START_TIMEOUT_MS;

		child.exited.then(() => (exited = true));

		let started = await answeringId(LOCAL_URL);

		while (started === null) {
			if (exited || Date.now() > deadline) {
				const tail = (await Bun.file(path.join(DATA_DIR, 'server.log')).text()).trim().split('\n').slice(-3).join('\n');

				throw new Error(`This machine's paude didn't start:\n${tail}\n(full log: ${DATA_DIR}/server.log)`);
			}
			await Bun.sleep(200);
			started = await answeringId(LOCAL_URL);
		}

		await verifyOwn(started);
	}

	return localServer();
};

const hostLabel = url => new URL(url).host;

export const allServers = async () => {
	const names = await serverNames();
	const remote = Object.entries(await allTokens())
		.filter(([url]) => url !== LOCAL_URL)
		.map(([url, token]) => ({ url, token, label: names[url] ?? hostLabel(url) }));

	return [...(localKnown() ? [await ensureLocalServer()] : []), ...remote];
};
