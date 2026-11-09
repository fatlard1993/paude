import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import { arcadeOf, hostUnhosted, keepHosted } from './arcade';
import { setProjectsRoot } from './projects';

// A mother hub that hosts whatever it's asked to, and remembers what that was
const asked = [];
let hub;
let scratch;

const gitIn = (cwd, ...argv) =>
	Bun.spawn(['git', '-c', 'user.name=t', '-c', 'user.email=t@t', ...argv], { cwd, stdout: 'ignore', stderr: 'ignore' })
		.exited;

const arcadeGame = async (name, marker = {}) => {
	const dir = join(scratch, 'projects', name);

	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, '.paude-arcade.json'), JSON.stringify({ title: name, reading: 'reading', ...marker }));
	await gitIn(dir, 'init', '-q');
	await gitIn(dir, 'add', '-A');
	await gitIn(dir, 'commit', '-qm', 'one');

	return dir;
};

const until = async check => {
	for (let tries = 0; tries < 100 && !(await check()); tries++) await Bun.sleep(20);
};

beforeAll(async () => {
	scratch = await mkdtemp(join(tmpdir(), 'paude-hosting-'));
	hub = Bun.serve({
		port: 0,
		fetch: async request => {
			const body = await request.json();

			asked.push({ ...body, authorization: request.headers.get('authorization') });

			return Response.json({ id: body.name, name: body.name, port: 4100, url: `https://${body.name}.home` });
		},
	});

	await mkdir(join(scratch, 'config', 'paude'), { recursive: true });
	await writeFile(
		join(scratch, 'config', 'paude', 'server.json'),
		JSON.stringify({ arcade: { hub: { url: `http://127.0.0.1:${hub.port}`, token: 'secret' } } }),
	);
	process.env.XDG_CONFIG_HOME = join(scratch, 'config');
	setProjectsRoot(join(scratch, 'projects'));
});

afterAll(async () => {
	hub.stop(true);
	delete process.env.XDG_CONFIG_HOME;
	await rm(scratch, { recursive: true, force: true });
});

test('a spell of building is hosted once, after it goes quiet, asking the hub to wait for an idle game', async () => {
	const dir = await arcadeGame('sand');

	asked.length = 0;
	keepHosted(dir, { delay: 60 });
	keepHosted(dir, { delay: 60 });
	keepHosted(dir, { delay: 60 });
	await until(() => asked.length > 0);
	await Bun.sleep(100);

	expect(asked).toHaveLength(1);
	expect(asked[0]).toMatchObject({ name: 'sand', dir, whenIdle: true, authorization: 'Bearer secret' });
	await until(async () => (await arcadeOf(dir))?.hosted);
	expect((await arcadeOf(dir)).hosted).toMatchObject({ id: 'sand', port: 4100, url: 'https://sand.home' });
});

test('at start, only the arcade games the hub has no record of are handed to it', async () => {
	await arcadeGame('frogs');
	await arcadeGame('rocks', { hosted: { id: 'rocks', port: 4101 } });
	await mkdir(join(scratch, 'projects', 'not-a-game'), { recursive: true });

	asked.length = 0;
	await hostUnhosted({ apartMs: 10 });
	await until(() => asked.some(request => request.name === 'frogs'));
	await Bun.sleep(100);

	expect(asked.map(request => request.name)).not.toContain('rocks');
	expect(asked.map(request => request.name)).not.toContain('not-a-game');
	expect(asked.map(request => request.name)).toContain('frogs');
});
