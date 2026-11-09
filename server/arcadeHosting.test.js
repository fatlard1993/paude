import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, beforeEach, expect, test } from 'bun:test';

import { hostUnhosted, keepHosted } from './arcade';
import { hostingOf, initMotherHub } from './motherHub';
import { setProjectsRoot } from './projects';

// A mother hub that hosts what it's asked to (answering that it's begun, then reporting it done), remembers what it was
// asked, and can be told to answer that a game is forgotten (410) or waiting on its players
const asked = [];
let answer = 'host';
let hub;
let scratch;

const gitIn = (cwd, ...argv) =>
	Bun.spawn(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...argv], { cwd, stdout: 'ignore', stderr: 'ignore' })
		.exited;

const arcadeGame = async name => {
	const dir = join(scratch, 'projects', name);

	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, '.paude-arcade.json'), JSON.stringify({ title: name, reading: 'reading' }));
	await gitIn(dir, 'init', '-q');
	await gitIn(dir, 'add', '-A');
	await gitIn(dir, 'commit', '-qm', 'one');

	return dir;
};

const until = async check => {
	for (let tries = 0; tries < 150 && !(await check()); tries++) await Bun.sleep(20);
};

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'paude-hosting-'));
	hub = Bun.serve({
		port: 0,
		fetch: async request => {
			const { pathname } = new URL(request.url);

			if (request.method === 'GET') {
				const id = pathname.split('/').at(-1);

				return Response.json({ id, operation: { kind: 'host', startedAt: 't', running: false, ok: true, lines: [] } });
			}

			const body = await request.json();

			asked.push({ ...body, authorization: request.headers.get('authorization') });

			if (answer === 'forgotten' && !body.again) return Response.json({ error: 'forgotten' }, { status: 410 });

			const hosted = { id: body.name, name: body.name, port: 4100, url: `https://${body.name}.home` };

			return Response.json(
				answer === 'waiting'
					? { ...hosted, deferred: true }
					: { ...hosted, operation: { kind: 'host', startedAt: 't' } },
			);
		},
	});

	await mkdir(join(scratch, 'config', 'paude'), { recursive: true });
	await mkdir(join(scratch, 'data'), { recursive: true });
	await writeFile(
		join(scratch, 'config', 'paude', 'server.json'),
		JSON.stringify({ arcade: { hub: { url: `http://127.0.0.1:${hub.port}`, token: 'secret' } } }),
	);
	process.env.XDG_CONFIG_HOME = join(scratch, 'config');
	setProjectsRoot(join(scratch, 'projects'));
	await initMotherHub(join(scratch, 'data'));
});

beforeEach(() => {
	asked.length = 0;
	answer = 'host';
});

afterAll(async () => {
	hub.stop(true);
	delete process.env.XDG_CONFIG_HOME;
	await rm(scratch, { recursive: true, force: true });
});

test("a spell of building is hosted once, after it goes quiet, and recorded in paude's data, not the game's repo", async () => {
	const dir = await arcadeGame('sand');
	const marker = await readFile(join(dir, '.paude-arcade.json'), 'utf8');

	keepHosted(dir, { delay: 30 });
	keepHosted(dir, { delay: 30 });
	keepHosted(dir, { delay: 30 });
	await until(async () => (await hostingOf(dir))?.state === 'hosted');
	await Bun.sleep(80);

	expect(asked).toHaveLength(1);
	expect(asked[0]).toMatchObject({ name: 'sand', dir, whenIdle: true, authorization: 'Bearer secret' });
	expect(await hostingOf(dir)).toMatchObject({ id: 'sand', port: 4100, url: 'https://sand.home', state: 'hosted' });
	expect(await readFile(join(dir, '.paude-arcade.json'), 'utf8')).toBe(marker);
});

test("a game whose committed state is already the house's isn't hosted again", async () => {
	const dir = await arcadeGame('rocks');

	keepHosted(dir, { delay: 10 });
	await until(async () => (await hostingOf(dir))?.state === 'hosted');
	asked.length = 0;

	keepHosted(dir, { delay: 10 });
	await Bun.sleep(150);

	expect(asked).toHaveLength(0);
});

test('a game the hub says is forgotten is left alone after, until it is hosted again on purpose', async () => {
	const dir = await arcadeGame('frogs');

	answer = 'forgotten';
	keepHosted(dir, { delay: 10 });
	await until(async () => (await hostingOf(dir))?.state === 'forgotten');
	await gitIn(dir, 'commit', '--allow-empty', '-qm', 'two');
	asked.length = 0;

	keepHosted(dir, { delay: 10 });
	await Bun.sleep(150);

	expect(asked).toHaveLength(0);
});

test('a hosting the hub holds for its players is recorded as waiting, not done', async () => {
	const dir = await arcadeGame('night');

	answer = 'waiting';
	keepHosted(dir, { delay: 10 });
	await until(async () => (await hostingOf(dir))?.state);

	expect((await hostingOf(dir)).state).toBe('waiting');
});

test('at start, only the arcade games paude has no record of hosting are handed to the hub', async () => {
	await arcadeGame('cards');
	await mkdir(join(scratch, 'projects', 'not-a-game'), { recursive: true });

	await hostUnhosted({ apartMs: 10 });
	await until(() => asked.some(request => request.name === 'cards'));
	await Bun.sleep(100);

	const names = asked.map(request => request.name);

	expect(names).toContain('cards');
	for (const recorded of ['sand', 'rocks', 'frogs', 'night', 'not-a-game']) expect(names).not.toContain(recorded);
});
