import { mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { initActivity, statusOf } from '../activity';
import { initAttachments } from '../attachments';
import { initTrash } from '../fileOperations';
import { initArchive, isArchived } from '../archive';
import { createInvite, createToken, initAuth } from '../auth';
import { hookSecret, setHookAddress } from '../hookSettings';
import { initNames } from '../names';
import { initNotes } from '../notes';
import { initProjects, setProjectsRoot } from '../projects';
import { allRunning, setClaudePath, startSession, stopSession } from '../sessions/running';
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

let base;

beforeAll(async () => {
	base = await mkdtemp(path.join(os.tmpdir(), 'paude-router-'));
	const data = path.join(base, 'data');

	await mkdir(path.join(base, 'projects', 'app'), { recursive: true });
	process.env.XDG_CONFIG_HOME = path.join(base, 'config');
	process.env.CLAUDE_CONFIG_DIR = path.join(base, 'claude');
	setProjectsRoot(path.join(base, 'projects'));
	await Promise.all([initAuth(data), initNotes(data), initNames(data), initActivity(data), initProjects(data)]);
	initAttachments(data);
	initTrash(data);
	await initArchive(data);
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

test('watching a project watches its sessions, the ones it gains too, and leads the projects', async () => {
	const watch = watching => ({ token: tokens.owner, method: 'PUT', body: { watching } });
	const watchedIds = async () =>
		(await (await call('/api/watching', { token: tokens.owner })).json()).map(({ id }) => id);

	expect((await call('/api/projects/app/watch', { ...watch(true), token: tokens.comment })).status).toBe(403);
	expect((await call('/api/projects/nowhere/watch', watch(true))).status).toBe(404);
	expect((await call('/api/projects/app/watch', watch(true))).status).toBe(204);

	const [app] = await (await call('/api/projects', { token: tokens.owner })).json();
	const later = startSession(session.cwd);

	expect(app.watching).toBe(true);
	expect(await watchedIds()).toEqual(expect.arrayContaining([session.id, other.id, later.id]));

	expect((await call('/api/projects/app/watch', watch(false))).status).toBe(204);
	expect(await watchedIds()).toEqual([]);
	later.process.kill();
});

test("git: reading takes the files role, changing takes the typing role, and a guest's own session only", async () => {
	const status = `/api/sessions/${session.id}/git/status`;
	const stage = { method: 'POST', body: { all: true } };

	// The project isn't a repository, so getting past the roles ends at 404
	expect((await call(status, { token: tokens.comment })).status).toBe(404);
	expect((await call(status, { token: tokens.watch })).status).toBe(403);
	expect((await call(`/api/sessions/${other.id}/git/status`, { token: tokens.comment })).status).toBe(403);
	expect((await call(`/api/sessions/${session.id}/git/stage`, { token: tokens.comment, ...stage })).status).toBe(403);
	expect((await call(`/api/sessions/${session.id}/git/stage`, { token: tokens.owner, ...stage })).status).toBe(404);
});

test('a dropped file is saved outside the project for Claude to read, by whoever may type', async () => {
	const route = `/api/sessions/${session.id}/attachments?name=${encodeURIComponent('../Screen Shot.png')}`;
	const drop = token =>
		router(
			new Request(`http://paude.test${route}`, {
				method: 'POST',
				headers: { authorization: `Bearer ${token}` },
				body: 'png bytes',
			}),
			server,
		);

	expect((await drop(tokens.comment)).status).toBe(403);

	const { path: saved } = await (await drop(tokens.owner)).json();

	expect(path.basename(saved)).toMatch(/^\w+-Screen-Shot\.png$/);
	expect(saved).not.toContain(path.join('projects', 'app'));
	expect(await Bun.file(saved).text()).toBe('png bytes');
});

test("a session that won't start says why, rather than leaving its client to retry", async () => {
	const id = '58a732eb-0000-4000-8000-00000000c1a0';
	const app = path.join(process.env.CLAUDE_CONFIG_DIR, '..', 'projects', 'app');

	await Bun.write(
		path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', app.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`),
		`${JSON.stringify({ type: 'user', cwd: app, sessionId: id, message: { content: 'hi' } })}\n`,
	);
	setClaudePath('/nowhere/claude');
	try {
		expect((await call(`/api/sessions/${id}/attach`, { token: tokens.owner })).status).toBe(404);

		const { startFailure } = await (await call(`/api/sessions/${id}`, { token: tokens.owner })).json();

		expect(startFailure).toStartWith(`Claude Code couldn't be started in ${app}`);
	} finally {
		setClaudePath(FAKE_CLAUDE);
	}
});

test("the manifest's icons are served without a login, and nothing else beside them is", async () => {
	const icon = await call('/icon-192.png');

	expect(icon.status).toBe(200);
	expect(icon.headers.get('content-type')).toBe('image/png');
	expect((await call('/build.js')).status).toBe(404);
});

test('a write from another site is refused', async () => {
	const response = await call('/api/projects', {
		token: tokens.owner,
		method: 'POST',
		body: { path: '/tmp' },
		headers: { origin: 'https://evil.example' },
	});

	expect(response.status).toBe(403);

	// A sandboxed frame or a file: page sends "null"; that was a server error, and is refused like any other site
	const sandboxed = await call('/api/projects', {
		token: tokens.owner,
		method: 'POST',
		body: { path: '/tmp' },
		headers: { origin: 'null' },
	});

	expect(sandboxed.status).toBe(403);
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

test('making a file or folder takes the typing role, and is refused over what is there', async () => {
	const make = (body, token = tokens.owner) =>
		call(`/api/sessions/${session.id}/files`, { token, method: 'POST', body });

	expect((await make({ path: 'drafts/idea.md' }, tokens.comment)).status).toBe(403);
	expect(await (await make({ path: 'drafts/idea.md' })).json()).toEqual({ path: 'drafts/idea.md', listed: true });
	expect((await make({ path: 'drafts/idea.md' })).status).toBe(409);
	expect((await make({ path: 'drafts/later', folder: true })).status).toBe(200);
	expect((await make({ path: '../escape.md' })).status).toBe(400);
});

test('moving, deleting, restoring and uploading take the typing role; a download is the file to save', async () => {
	const files = (action, body, { token = tokens.owner, method = 'POST' } = {}) =>
		call(`/api/sessions/${session.id}/files/${action}`, { token, method, body });
	const upload = (query, token = tokens.owner) =>
		router(
			new Request(`http://paude.test/api/sessions/${session.id}/files/upload?${query}`, {
				method: 'PUT',
				headers: { authorization: `Bearer ${token}` },
				body: 'uploaded\n',
			}),
			server,
		);

	expect((await upload('path=up.txt', tokens.comment)).status).toBe(403);
	expect(await (await upload('path=up.txt')).json()).toEqual({ path: 'up.txt', listed: true });
	expect((await upload('path=up.txt')).status).toBe(409);
	expect((await upload('path=up.txt&replace=1')).status).toBe(200);

	const download = await call(`/api/sessions/${session.id}/raw?path=up.txt&download=1`, { token: tokens.comment });

	expect(download.headers.get('content-disposition')).toBe("attachment; filename*=UTF-8''up.txt");

	expect((await files('move', { moves: [{ from: 'up.txt', to: 'down.txt' }] }, { token: tokens.comment })).status).toBe(
		403,
	);
	expect((await files('move', { moves: [{ from: 'up.txt', to: 'down.txt' }] })).status).toBe(200);
	expect((await files('copy', { copies: [{ from: 'down.txt', to: 'again.txt' }] })).status).toBe(200);

	const { trash } = await (await files('delete', { paths: ['down.txt', 'again.txt'] })).json();

	expect((await files('restore', { trash }, { token: tokens.comment })).status).toBe(403);
	expect(await (await files('restore', { trash })).json()).toEqual({ restored: ['down.txt', 'again.txt'] });
	expect((await files('delete', {})).status).toBe(400);
});

test('archiving takes the owner; an archived session leaves the list but not a search, and a filter finds it', async () => {
	const app = path.join(base, 'projects', 'app');
	const id = '00000000-0000-4000-8000-0000000000a1';
	const transcript = path.join(base, 'claude', 'projects', app.replace(/[^a-zA-Z0-9]/g, '-'), `${id}.jsonl`);
	const listed = async query =>
		(await (await call(`/api/sessions?limit=50${query}`, { token: tokens.owner })).json()).map(found => found.id);
	const archive = (archived, token = tokens.owner) =>
		call('/api/sessions/archive', { token, method: 'POST', body: { ids: [id], archived } });

	await Bun.write(
		transcript,
		`${JSON.stringify({ type: 'user', sessionId: id, cwd: app, message: { role: 'user', content: 'tidy the attic' } })}\n`,
	);

	expect(await listed('')).toContain(id);
	expect((await archive(true, tokens.comment)).status).toBe(403);
	expect((await archive(true)).status).toBe(204);
	expect(await listed('')).not.toContain(id);
	expect(await listed('&q=attic')).toEqual([id]);
	expect(await listed('&filter=archived')).toEqual([id]);
	expect((await archive(false)).status).toBe(204);
	expect(await listed('')).toContain(id);

	// Taken back up, it's in use: no longer archived
	await archive(true);
	await call(`/api/sessions/${id}/prompt`, { token: tokens.owner, method: 'POST', body: { text: 'and the cellar' } });
	expect(isArchived(id)).toBe(false);
	await stopSession(id);
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
		expect((await (await call('/api/auth', { token: tokens.owner })).json()).identity.remotes).toBe(true);
		expect((await (await call('/api/auth', { token: tokens.comment })).json()).identity.remotes).toBeUndefined();
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

test('reading the feed from somewhere named is being here; a guest is here under their invite name', async () => {
	const feed = query => call(`/api/sessions/${session.id}/feed${query}`, { token: tokens.owner });
	const readers = () =>
		[...session.readers.values()].map(({ kind, label, name, role }) => ({ kind, label, name, role }));

	expect((await feed('')).status).toBe(200);
	expect(readers()).toEqual([]);

	expect((await feed('?label=Minecraft&name=Steve')).status).toBe(200);
	const asGuest = token => call(`/api/sessions/${session.id}/feed?label=Minecraft&name=Steve`, { token });

	expect((await asGuest(tokens.comment)).status).toBe(200);
	expect((await asGuest(tokens.watch)).status).toBe(403);
	expect(readers()).toEqual([
		{ kind: 'feed', label: 'Minecraft', name: 'Steve', role: 'owner' },
		{ kind: 'feed', label: 'Minecraft', name: 'comment', role: 'comment' },
	]);

	for (const key of [...session.readers.keys()]) session.unread(key);
});

test('package files are served from the allowed packages only', async () => {
	const escaped = await call('/@fortawesome/fontawesome-free/..%2f..%2fmarked/package.json');

	// Refused: a path naming a file that isn't served is a 404, not the page under its name
	expect(escaped.status).toBe(404);
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
