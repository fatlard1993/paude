import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import {
	allCabinets,
	cabinetOf,
	cabinetShare,
	forgetCabinets,
	initCabinets,
	manageCabinet,
	watchCabinet,
	watchedCabinets,
} from './cabinets';

let dir;
let hub;
let asked = 0;
const told = [];

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
			if (request.headers.get('authorization') !== 'Bearer t') return new Response('no', { status: 401 });
			if (request.method === 'POST') {
				told.push(new URL(request.url).pathname);

				return Response.json({ kind: 'restart', running: true }, { status: 202 });
			}

			return Response.json(games);
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
		project: 'humanity',
		port: 8032,
		title: 'Humanity',
		color: '#e6e0d0',
		background: '#1b1b1b',
		icon: '/api/cabinets/humanity/icon?v=0',
		hubIcon: `http://127.0.0.1:${hub.port}/api/games/humanity/icon?v=1`,
		url: 'http://humanity.home',
		publicUrl: null,
		lanUrl: 'http://humanity.home',
		running: true,
		state: 'silent',
		doing: null,
		hub: `http://127.0.0.1:${hub.port}`,
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

test('a cabinet says how its game is doing as the hub would: busy, crashing, off, up, or running but not answering', () => {
	const stateOf = game => cabinetOf({ id: 'g', ...game }, 'http://hub.home');

	expect(stateOf({ unit: { active: true }, health: { ok: true } })).toMatchObject({ state: 'up', doing: null });
	expect(stateOf({ unit: { active: true }, health: { ok: false } }).state).toBe('silent');
	expect(stateOf({ unit: { active: false }, health: { ok: false } }).state).toBe('off');
	expect(stateOf({ unit: { active: false, state: 'failed' } }).state).toBe('crashing');
	expect(stateOf({ unit: { active: true }, operation: { running: true, kind: 'update' } })).toMatchObject({
		state: 'busy',
		doing: 'update',
	});
	// One the hub runs no unit for: by whether it answers
	expect(stateOf({ health: { ok: true } }).state).toBe('up');
	expect(stateOf({}).state).toBe('off');
	expect(stateOf({}).hub).toBe('http://hub.home');
});

test('the hub is told to turn a game on or off, restart or update it, nothing else, and is asked afresh after', async () => {
	const connected = { url: `http://127.0.0.1:${hub.port}`, token: 't' };

	forgetCabinets();
	await allCabinets({ hub: connected });

	const before = asked;

	expect(await manageCabinet('humanity', 'restart', { hub: connected })).toEqual({ kind: 'restart', running: true });
	expect(told).toEqual(['/api/games/humanity/restart']);
	await allCabinets({ hub: connected });
	expect(asked).toBe(before + 2);
	// What's left to the hub's own page isn't asked of it from here
	for (const action of ['reset', 'expose', 'forget'])
		await expect(manageCabinet('humanity', action, { hub: connected })).rejects.toThrow('no such thing');
	expect(told).toHaveLength(1);
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
