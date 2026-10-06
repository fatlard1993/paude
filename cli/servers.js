import { existsSync, mkdirSync, openSync } from 'fs';
import os from 'os';
import path from 'path';

import { allTokens } from './credentials';

const START_TIMEOUT_MS = 10_000;

// This machine's paude: its address, and the data folder whose local-token file logs this user in without a password
export const LOCAL_URL = process.env.PAUDE_LOCAL_URL ?? 'http://127.0.0.1:8044';
const DATA_DIR = process.env.PAUDE_DATA ?? path.join(os.homedir(), '.paude');
const TOKEN_FILE = path.join(DATA_DIR, 'local-token');
const SERVER_ENTRY = path.join(import.meta.dir, '..', 'server', 'index.js');

const readLocalToken = async () =>
	(await Bun.file(TOKEN_FILE).exists()) ? (await Bun.file(TOKEN_FILE).text()).trim() : null;

const localServer = async () => ({ url: LOCAL_URL, token: await readLocalToken(), label: 'This machine', local: true });

// Whether this machine has run paude before; a fresh one isn't started until someone asks for it
export const localKnown = () => existsSync(TOKEN_FILE);

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

const answers = async url => {
	try {
		return (await fetch(`${url}/api/auth`, { signal: AbortSignal.timeout(1000) })).ok;
	} catch {
		return false;
	}
};

// This machine's paude, started in the background when it isn't running. Its log goes to the data folder.
export const ensureLocalServer = async () => {
	if (!(await answers(LOCAL_URL))) {
		const { hostname, port } = new URL(LOCAL_URL);

		mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });

		const log = openSync(path.join(DATA_DIR, 'server.log'), 'a', 0o600);
		const child = Bun.spawn(['bun', SERVER_ENTRY, '--host', hostname, '--port', port || '80', '--data', DATA_DIR], {
			cwd: path.dirname(path.dirname(SERVER_ENTRY)),
			env: { ...process.env, NODE_ENV: 'production' },
			stdio: ['ignore', log, log],
		});

		child.unref();

		const deadline = Date.now() + START_TIMEOUT_MS;

		while (!(await answers(LOCAL_URL))) {
			if (Date.now() > deadline) throw new Error(`This machine's paude didn't start; see ${DATA_DIR}/server.log`);
			await Bun.sleep(200);
		}
	}

	return localServer();
};

const hostLabel = url => new URL(url).host;

// Every paude to show: this machine's (once it has been used) and each one logged into from here
export const allServers = async () => {
	const remote = Object.entries(await allTokens())
		.filter(([url]) => url !== LOCAL_URL)
		.map(([url, token]) => ({ url, token, label: hostLabel(url) }));

	return [...(localKnown() ? [await ensureLocalServer()] : []), ...remote];
};
