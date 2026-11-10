import { randomBytes } from 'crypto';
import { existsSync } from 'fs';
import { chmod, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import { join } from 'path';

import readJsonFile from '../shared/readJsonFile';
import updateJsonFile from '../shared/updateJsonFile';
import { serverSettings } from './serverSettings';
import gitEnvironment from './utils/gitEnvironment';

// Where the arcade's games are hosted: web-game-mother-hub (github.com/fatlard1993/web-game-mother-hub), which runs the
// house's games, turns them on and off, updates them and opens them to the internet. A paude given one in server.json
// ({ "arcade": { "hub": { "url": "https://hub.home", "token": "<its MOTHER_HUB_TOKEN>" } } }) hosts there; one given
// none runs a copy of the hub of its own, on this machine, and hosts there. Settings for that copy (MOTHER_HUB_* names,
// the VPS it opens games through, say) go in "arcade": { "hubSettings": { ... } }.

const INTERNAL_PORT = 8046;
const START_WAIT_MS = 60_000;

let dataDir = null;

const tokenFile = () => join(dataDir, 'mother-hub-token');
const databaseFile = () => join(dataDir, 'mother-hub.json');

// `status` is the hub's answer, when it gave one: 409 for a game busy with something else, 410 for one forgotten there
export class HubError extends Error {
	constructor(message, status = null) {
		super(message);
		this.status = status;
	}
}

const configured = async () => {
	const { arcade = {} } = await serverSettings();
	const { url, token } = arcade.hub ?? {};

	return typeof url === 'string' && url && typeof token === 'string' && token
		? { url: url.replace(/\/+$/, ''), token, internal: false }
		: null;
};

// The copy's token, made once and kept where only this user reads it; it's the copy's password too
const internalToken = async () => {
	const kept = (await readFile(tokenFile(), 'utf8').catch(() => '')).trim();

	if (kept) return kept;

	const token = randomBytes(24).toString('base64url');

	await writeFile(tokenFile(), `${token}\n`, { mode: 0o600 });
	await chmod(tokenFile(), 0o600);

	return token;
};

const answers = async ({ url, token }) => {
	try {
		const response = await fetch(`${url}/api/hub`, {
			headers: { authorization: `Bearer ${token}` },
			signal: AbortSignal.timeout(2000),
		});

		return response.ok;
	} catch {
		return false;
	}
};

// paude's own copy, started when it's first needed and reused while it answers: a paude restarted (or hot-reloaded)
// finds the one it started before still running, and the games it hosts are units of their own either way
const internal = async () => {
	const hub = { url: `http://127.0.0.1:${INTERNAL_PORT}`, token: await internalToken(), internal: true };

	if (await answers(hub)) return hub;

	const { arcade = {} } = await serverSettings();
	const settings = Object.fromEntries(
		Object.entries(arcade.hubSettings ?? {}).filter(([key, value]) => /^MOTHER_HUB_\w+$/.test(key) && value != null),
	);
	let entry;

	try {
		entry = Bun.resolveSync('web-game-mother-hub', import.meta.dir);
	} catch {
		throw new HubError("The mother hub isn't installed here: bun install in paude, or give it a hub in arcade.hub.");
	}

	globalThis.paudeMotherHub ??= Bun.spawn(
		[
			process.execPath,
			entry,
			'--port',
			String(INTERNAL_PORT),
			'--database',
			databaseFile(),
			'--projects',
			arcade.hubProjects ?? join(os.homedir(), 'Projects'),
		],
		{
			env: {
				...process.env,
				NODE_ENV: 'production',
				...settings,
				MOTHER_HUB_TOKEN: hub.token,
				MOTHER_HUB_PASSWORD: hub.token,
			},
			stdin: 'ignore',
			stdout: 'inherit',
			stderr: 'inherit',
			onExit: () => (globalThis.paudeMotherHub = null),
		},
	);

	const until = Date.now() + START_WAIT_MS;

	while (Date.now() < until) {
		if (await answers(hub)) return hub;
		await Bun.sleep(500);
	}

	throw new HubError("paude's own mother hub didn't start.");
};

// What paude knows of its games' hosting, kept here rather than in the games' repos (where it would be a change of
// Claude's to commit, and stop Undo): { [folder]: { id, port, url, hub, head, state: hosted|waiting|forgotten, at } }
const recordsFile = () => join(dataDir, 'arcade-hosting.json');

export const hostingOf = async cwd => (await readJsonFile(recordsFile(), {}))[cwd] ?? null;

export const recordHosting = (cwd, record) =>
	updateJsonFile(recordsFile(), {}, records => ({ ...records, [cwd]: { ...record, at: new Date().toISOString() } }));

export const motherHub = async () => (await configured()) ?? internal();

// The hub this paude already has, without starting one: the configured hub, or its own copy when it's running. null
// for none.
export const connectedHub = async () => {
	const hub = await configured();

	if (hub) return hub;
	if (!existsSync(databaseFile())) return null;

	const own = { url: `http://127.0.0.1:${INTERNAL_PORT}`, token: await internalToken(), internal: true };

	return (await answers(own)) ? own : null;
};

// A read of the hub's own API (GET), as its token
export const askHub = (hub, path) => call(hub, path);

// Something begun on the hub (POST), as its token: answered once it's begun there
export const tellHub = (hub, path) => call(hub, path, { method: 'POST' });

// Where it is, for the arcade page to link: the configured hub, or the copy's, once there is one
export const hubLink = async () =>
	(await configured())?.url ?? (existsSync(databaseFile()) ? `http://127.0.0.1:${INTERNAL_PORT}` : null);

// A paude that hosted games in its own copy before starts it again with itself, so the copy keeps them updated
export const initMotherHub = async dir => {
	dataDir = dir;

	if (!(await configured()) && existsSync(databaseFile())) internal().catch(error => console.warn(error.message));
};

const git = async (cwd, ...argv) => {
	const child = Bun.spawn(['git', ...argv], {
		cwd,
		env: gitEnvironment(),
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

	return { ok: (await child.exited) === 0, out: out.trim(), err: err.trim() };
};

const call = async (hub, path, init = {}) => {
	const response = await fetch(`${hub.url}${path}`, {
		...init,
		headers: { authorization: `Bearer ${hub.token}`, ...init.headers },
	}).catch(error => {
		throw new HubError(`The mother hub at ${hub.url} didn't answer: ${error.message}`);
	});
	const body = await response.json().catch(() => null);

	if (!response.ok) throw new HubError(body?.error ?? `The mother hub answered ${response.status}`, response.status);

	return body;
};

// Hosting answers when it's begun; the game's host operation is followed here to its end. Up to 20 minutes: a first
// install on a slow machine is long.
const FOLLOW_MS = 20 * 60 * 1000;

const follow = async (hub, id, startedAt, onOutput) => {
	const until = Date.now() + FOLLOW_MS;
	let printed = 0;

	while (Date.now() < until) {
		await Bun.sleep(1500);

		const { operation } = await call(hub, `/api/games/${encodeURIComponent(id)}`);

		if (!operation || operation.kind !== 'host' || operation.startedAt !== startedAt) continue;

		for (const line of operation.lines?.slice(printed) ?? []) onOutput(`${line}\n`);
		printed = operation.lines?.length ?? printed;

		if (!operation.running) {
			if (!operation.ok) throw new HubError(operation.error ?? 'Hosting failed');

			return;
		}
	}

	throw new HubError('The mother hub was still hosting it after twenty minutes');
};

// A game with the house's: hosted by the hub from this folder when it can see it at this commit (the same machine; the
// house's copy then runs this folder), or sent to it as a git bundle when it can't (another machine; a clone there).
// { id, name, port, url, hub, head, deferred? }, once the hosting is done or, asked to wait for an idle game that has
// players, once it's waiting for them.
export const hostGame = async (cwd, name, onOutput = () => {}, { whenIdle = false, again = false } = {}) => {
	const hub = await motherHub();
	const head = await git(cwd, 'rev-parse', 'HEAD');

	if (!head.ok) throw new HubError('The game has no commits to host yet.');

	onOutput(`Hosting with the mother hub at ${hub.url}\n`);

	let hosted = await call(hub, '/api/host', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify({ name, dir: cwd, head: head.out, whenIdle, again }),
	});

	if (hosted.needsBundle) {
		const bundle = join(os.tmpdir(), `paude-host-${name}-${Date.now()}.bundle`);

		onOutput('Sending it as a bundle\n');

		try {
			const made = await git(cwd, 'bundle', 'create', '--quiet', bundle, 'HEAD', '--branches');

			if (!made.ok) throw new HubError(`The game couldn't be bundled: ${made.err}`);

			const query = new URLSearchParams({ ...(whenIdle && { whenIdle: '1' }), ...(again && { again: '1' }) });

			hosted = await call(hub, `/api/host/${encodeURIComponent(name)}/bundle?${query}`, {
				method: 'POST',
				headers: { 'content-type': 'application/octet-stream' },
				body: Bun.file(bundle),
			});
		} finally {
			await rm(bundle, { force: true });
		}
	}

	if (hosted.operation) await follow(hub, hosted.id, hosted.operation.startedAt, onOutput);

	return { ...hosted, head: head.out, hub: hub.internal ? null : hub.url };
};
