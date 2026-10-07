import { mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { initActivity, statusOf } from '../activity';
import { createInvite, createToken, initAuth } from '../auth';
import { hookSecret, setHookAddress } from '../hookSettings';
import { initNames } from '../names';
import { initNotes } from '../notes';
import { initProjects, setProjectsRoot } from '../projects';
import { allRunning, setClaudePath, startSession } from '../sessions/running';
import { setServerName } from '../serverSettings';
import { readProgress } from '../../shared/progress';
import router from './router';

const FAKE_CLAUDE = path.join(import.meta.dir, '..', 'sessions', 'fixtures', 'fake-claude.js');
const server = { upgrade: () => false, requestIP: () => ({ address: '127.0.0.1' }) };
const tokens = {};
let session;
let other;

const call = (route, { token, method = 'GET', body, headers = {} } = {}) =>
	router(
		new Request(`http://paude.test${route}`, {
			method,
			headers: {
				...(token && { authorization: `Bearer ${token}` }),
				...(body && { 'content-type': 'application/json' }),
				...headers,
			},
			...(body && { body: JSON.stringify(body) }),
		}),
		server,
	);

beforeAll(async () => {
	const base = await mkdtemp(path.join(os.tmpdir(), 'paude-router-'));
	const data = path.join(base, 'data');

	await mkdir(path.join(base, 'projects', 'app'), { recursive: true });
	process.env.XDG_CONFIG_HOME = path.join(base, 'config');
	setProjectsRoot(path.join(base, 'projects'));
	await Promise.all([initAuth(data), initNotes(data), initNames(data), initActivity(data), initProjects(data)]);
	setHookAddress({ host: '127.0.0.1', port: 1 });
	setClaudePath(FAKE_CLAUDE);

	session = startSession(path.join(base, 'projects', 'app'));
	other = startSession(path.join(base, 'projects', 'app'));
	tokens.owner = await createToken('remote owner');
	tokens.local = await createToken('this machine', { local: true });

	for (const role of ['comment', 'watch']) {
		const { invite } = await createInvite({ sessionId: session.id, name: role, role, hours: 1 });

		tokens[role] = await createToken(role, { invite });
	}
});

afterAll(() => {
	for (const running of allRunning()) running.process.kill();
});

test('the api needs a login; the owner gets in', async () => {
	expect((await call('/api/projects')).status).toBe(401);

	const projects = await (await call('/api/projects', { token: tokens.owner })).json();

	expect(projects.map(({ name }) => name)).toEqual(['app']);
});

test('a write from another site is refused', async () => {
	const response = await call('/api/projects', {
		token: tokens.owner,
		method: 'POST',
		body: { path: '/tmp' },
		headers: { origin: 'https://evil.example' },
	});

	expect(response.status).toBe(403);
});

test('guests reach their own session only, and what their role allows', async () => {
	expect((await call('/api/projects', { token: tokens.comment })).status).toBe(403);
	expect((await call(`/api/sessions/${session.id}/files`, { token: tokens.comment })).status).toBe(200);
	expect((await call(`/api/sessions/${session.id}/files`, { token: tokens.watch })).status).toBe(403);
	expect((await call(`/api/sessions/${other.id}/files`, { token: tokens.comment })).status).toBe(403);
	expect(
		(await call(`/api/sessions/${other.id}/watch`, { token: tokens.comment, method: 'PUT', body: { watching: true } }))
			.status,
	).toBe(403);
	expect(
		(
			await call(`/api/sessions/${session.id}/watch`, {
				token: tokens.comment,
				method: 'PUT',
				body: { watching: true },
			})
		).status,
	).toBe(204);
});

test("other servers are listed only for this machine's own logins", async () => {
	expect((await call('/api/remotes', { token: tokens.owner })).status).toBe(403);
	expect((await call('/api/remotes', { token: tokens.local })).status).toBe(200);
});

test('a machine that shares its servers lists them for the owner password too, never for an invite', async () => {
	await Bun.write(path.join(process.env.XDG_CONFIG_HOME, 'paude', 'server.json'), '{ "shareRemotes": true }');

	try {
		expect((await call('/api/remotes', { token: tokens.owner })).status).toBe(200);
		expect((await call('/api/remotes', { token: tokens.comment })).status).toBe(403);
	} finally {
		await rm(path.join(process.env.XDG_CONFIG_HOME, 'paude', 'server.json'));
	}
});

test('a server tells anyone asking the name it goes by', async () => {
	const settings = path.join(process.env.XDG_CONFIG_HOME, 'paude', 'server.json');

	expect((await (await call('/api/auth')).json()).name).toBeNull();

	await setServerName('  laptop  ');

	try {
		expect((await (await call('/api/auth')).json()).name).toBe('laptop');
		await setServerName('');
		expect(await Bun.file(settings).json()).toEqual({});
	} finally {
		await rm(settings, { force: true });
	}
});

test('hooks need the secret, and report on the session in their address', async () => {
	const post = (secret, payload) => call(`/api/hooks/${secret}/${session.id}`, { method: 'POST', body: payload });

	expect((await post('guess', { hook_event_name: 'Stop' })).status).toBe(404);
	expect(
		(await post(hookSecret, { hook_event_name: 'Notification', notification_type: 'permission_prompt' })).status,
	).toBe(204);
	expect(statusOf(session.id)).toBe('waiting');
});

test('package files are served from the allowed packages only', async () => {
	const escaped = await call('/@fortawesome/fontawesome-free/..%2f..%2fmarked/package.json');

	expect(await escaped.text()).not.toContain('"name": "marked"');
});

test('a session that never got a prompt still deletes cleanly', async () => {
	const fresh = startSession(session.cwd);

	expect((await call(`/api/sessions/${fresh.id}`, { token: tokens.owner, method: 'DELETE' })).status).toBe(204);
});

test('a side terminal is for those who may type: the owner and drivers, never a commenter or viewer', async () => {
	const shell = id => `/api/sessions/${id}/shell`;

	// The test server refuses every upgrade, so reaching it answers 400
	expect((await call(shell(session.id), { token: tokens.owner })).status).toBe(400);
	expect((await call(shell(session.id), { token: tokens.comment })).status).toBe(403);
	expect((await call(shell(session.id), { token: tokens.watch })).status).toBe(403);
	expect((await call(shell(other.id), { token: tokens.comment })).status).toBe(403);
});

test("a session in a worktree needs a usable name, or one that's there to join", async () => {
	const start = checkout =>
		call('/api/projects/app/sessions', { token: tokens.owner, method: 'POST', body: { checkout } });

	expect((await start({ create: '../escape' })).status).toBe(400);
	expect((await start({ join: '/nowhere' })).status).toBe(404);

	// Making one streams its progress, and a project that isn't a repository ends in an error, not a session
	const made = await start({ create: 'fine-name' });

	expect(made.headers.get('content-type')).toBe('application/x-ndjson');
	expect(await readProgress(made, () => {})).toEqual({ error: "This project isn't the top of a git repository." });
	expect((await call('/api/projects/app/checkouts', { token: tokens.owner })).status).toBe(200);
	expect((await call('/api/projects/app/checkouts', { token: tokens.comment })).status).toBe(403);
});

test('a running session nobody has prompted yet is listed with its project, and counted', async () => {
	const ids = async route => (await (await call(route, { token: tokens.owner })).json()).map(({ id }) => id);

	expect(await ids('/api/projects/app/sessions')).toEqual(expect.arrayContaining([session.id, other.id]));
	expect(await ids('/api/sessions?limit=8')).toEqual(expect.arrayContaining([session.id, other.id]));

	const app = (await (await call('/api/projects', { token: tokens.owner })).json()).find(({ name }) => name === 'app');

	expect(app.liveCount).toBe(2);

	const listed = (await (await call('/api/projects/app/sessions', { token: tokens.owner })).json()).find(
		({ id }) => id === session.id,
	);

	expect(listed).toMatchObject({ title: 'Fake session', live: true });
});

test('changes are for those who may browse files, and saving is for those who may type', async () => {
	const own = `/api/sessions/${session.id}`;

	expect((await call(`${own}/changes`, { token: tokens.watch })).status).toBe(403);
	expect((await call(`${own}/changes`, { token: tokens.comment })).status).toBe(200);
	expect(
		(await call(`${own}/file`, { token: tokens.comment, method: 'PUT', body: { path: 'a', text: '', hash: '' } }))
			.status,
	).toBe(403);
	expect(
		(
			await call(`${own}/file`, {
				token: tokens.owner,
				method: 'PUT',
				body: { path: 'nowhere.js', text: '', hash: '' },
			})
		).status,
	).toBe(404);
});

test('sessions page and search: every word has to match, and the header says how many do in all', async () => {
	const page = async query => {
		const response = await call(`/api/sessions?${query}`, { token: tokens.owner });

		return { ids: (await response.json()).map(({ id }) => id), total: Number(response.headers.get('x-total-count')) };
	};

	expect(await page('q=fake+session')).toMatchObject({ total: 2 });
	expect((await page('q=fake&limit=1')).ids).toHaveLength(1);
	expect((await page('q=fake&limit=1&offset=1')).ids).toHaveLength(1);
	expect(await page('q=fake+minecraft')).toEqual({ ids: [], total: 0 });
	expect((await call('/api/projects/app/sessions?q=fake', { token: tokens.owner })).headers.get('x-total-count')).toBe(
		'2',
	);
});
