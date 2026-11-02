import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { allTokens, saveToken } from '../shared/credentials';
import readJsonFile from '../shared/readJsonFile';
import { connectRemote } from './remotes';

let other;
let config;
const before = process.env.XDG_CONFIG_HOME;

beforeAll(async () => {
	config = await mkdtemp(path.join(os.tmpdir(), 'paude-remotes-'));
	process.env.XDG_CONFIG_HOME = config;
	// Another paude: its owner password is "right"
	other = Bun.serve({
		port: 0,
		fetch: async request => {
			const { pathname } = new URL(request.url);

			if (pathname === '/api/auth') return Response.json({ serverId: 'elsewhere', name: 'vps' });
			if (pathname === '/api/tokens') {
				const { password } = await request.json();

				return password === 'right' ? Response.json({ token: 'issued' }) : new Response('no', { status: 401 });
			}

			return new Response('Not Found', { status: 404 });
		},
	});
});

afterAll(() => {
	other.stop(true);
	if (before === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = before;
});

const credentials = () => readJsonFile(path.join(config, 'paude', 'credentials.json'), {});

test("another paude logged into from here is kept by the name given, the command's default left as it was", async () => {
	await saveToken('https://first.example', 'old', undefined);

	const url = `http://localhost:${other.port}`;

	expect(await connectRemote({ url, password: 'right', name: 'vps' })).toEqual({ url, name: 'vps' });
	expect((await allTokens())[url]).toBe('issued');
	expect((await credentials()).names[url]).toBe('vps');
	expect((await credentials()).default).toBe('https://first.example');
});

test('a wrong password, nothing answering, or no address says so and keeps nothing', async () => {
	const url = `http://localhost:${other.port}`;
	const wrong = await connectRemote({ url: `${url}/`, password: 'wrong' });

	expect(wrong).toEqual({ status: 422, error: 'Wrong password' });
	expect((await connectRemote({ url: 'http://localhost:1', password: 'x' })).status).toBe(502);
	expect((await connectRemote({ url: ' ', password: 'x' })).status).toBe(400);
	expect((await connectRemote({ url, password: '' })).status).toBe(400);
	expect(Object.keys(await allTokens())).not.toContain('http://localhost:1');
});
