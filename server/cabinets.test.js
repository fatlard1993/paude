import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import { allCabinets, cabinetShare, forgetCabinets, initCabinets, watchCabinet, watchedCabinets } from './cabinets';

let dir;
let hub;
let asked = 0;

const games = [
	{
		id: 'humanity',
		name: 'humanity',
		look: { title: 'Humanity', color: '#e6e0d0', background: '#1b1b1b', icon: '/api/games/humanity/icon?v=1' },
		lanUrl: 'http://humanity.home',
		publicUrl: null,
		port: 8032,
		unit: { active: true },
		report: { connections: 2 },
	},
	{ id: 'sand-sorter', name: 'sand-sorter', lanUrl: 'http://sand-sorter.home', unit: { active: false } },
];

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'cabinets-'));
	await initCabinets(dir);
	hub = Bun.serve({
		port: 0,
		fetch: request => {
			asked++;

			return request.headers.get('authorization') === 'Bearer t'
				? Response.json(games)
				: new Response('no', { status: 401 });
		},
	});
});

afterAll(async () => {
	hub.stop(true);
	await rm(dir, { recursive: true, force: true });
});

test("each hub game is a cabinet with its look, where it's played, and whether it's on", async () => {
	forgetCabinets();

	const cabinets = await allCabinets({ hub: { url: `http://127.0.0.1:${hub.port}`, token: 't' } });

	expect(cabinets[0]).toEqual({
		id: 'humanity',
		port: 8032,
		title: 'Humanity',
		color: '#e6e0d0',
		background: '#1b1b1b',
		icon: `http://127.0.0.1:${hub.port}/api/games/humanity/icon?v=1`,
		url: 'http://humanity.home',
		running: true,
		players: 2,
		watched: true,
	});
	expect(cabinets[1]).toMatchObject({ id: 'sand-sorter', title: 'sand-sorter', running: false, players: 0 });
});

test('the hub is asked a little apart, and a game unwatched leaves the lounge but stays listed', async () => {
	const before = asked;

	await allCabinets({ hub: { url: `http://127.0.0.1:${hub.port}`, token: 't' } });
	expect(asked).toBe(before);

	await watchCabinet('sand-sorter', false);
	expect((await watchedCabinets()).map(({ id }) => id)).toEqual(['humanity']);
	expect((await allCabinets()).find(({ id }) => id === 'sand-sorter').watched).toBe(false);
	await watchCabinet('sand-sorter', true);
	expect((await watchedCabinets()).map(({ id }) => id)).toEqual(['humanity', 'sand-sorter']);
});

test('no cabinets without a hub', async () => {
	forgetCabinets();
	expect(await allCabinets({ hub: null, now: Date.now() })).toEqual(expect.any(Array));
});

test("a cabinet's game is a port share on the preview listener, at the game's own port where the hub runs", async () => {
	forgetCabinets();
	await allCabinets({ hub: { url: `http://127.0.0.1:${hub.port}`, token: 't' } });

	expect(cabinetShare('game-humanity')).toEqual({
		name: 'game-humanity',
		kind: 'port',
		host: '127.0.0.1',
		port: 8032,
		cabinet: 'humanity',
	});
	expect(cabinetShare('game-sand-sorter')).toBeNull();
	expect(cabinetShare('humanity')).toBeNull();
});
