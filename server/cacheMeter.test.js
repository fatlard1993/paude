import { appendFile, mkdtemp, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, expect, test } from 'bun:test';

import { meterOf } from './cacheMeter';

const configDir = process.env.CLAUDE_CONFIG_DIR;

afterAll(() => {
	if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = configDir;
});

const request = (id, at, usage) =>
	JSON.stringify({ type: 'assistant', timestamp: new Date(at).toISOString(), message: { id, usage } });

const setUp = async () => {
	const home = await mkdtemp(path.join(os.tmpdir(), 'paude-meter-'));
	const cwd = '/work/app';
	const folder = path.join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'));

	process.env.CLAUDE_CONFIG_DIR = home;
	await Bun.write(path.join(folder, 'keep'), '');

	return { cwd, file: path.join(folder, 'session.jsonl') };
};

test('the context, the cache, and what the session has spent, from each request once', async () => {
	const { cwd, file } = await setUp();
	const first = {
		input_tokens: 10,
		cache_read_input_tokens: 0,
		cache_creation_input_tokens: 20000,
		cache_creation: { ephemeral_1h_input_tokens: 20000 },
		output_tokens: 100,
	};
	const second = {
		input_tokens: 2,
		cache_read_input_tokens: 20000,
		cache_creation_input_tokens: 500,
		cache_creation: { ephemeral_1h_input_tokens: 500 },
		output_tokens: 50,
	};

	await writeFile(
		file,
		`${[request('a', 0, first), request('a', 0, first), request('b', 60_000, second)].join('\n')}\n`,
	);

	const meter = await meterOf('session', cwd, 120_000);

	expect(meter).toMatchObject({ context: 20502, ttl: '1h', warmUntil: 60_000 + 3_600_000, warm: true, requests: 2 });
	expect(meter.coldCost).toBe(41004);
	expect(meter.warmCost).toBe(2050);
	// 12 input + 2000 read + 41000 written + 750 output
	expect(meter.spent).toBe(43762);

	// What's added later is read on its own, and a cache gone cold says so
	await appendFile(file, `${request('c', 120_000, { ...second, cache_read_input_tokens: 20500 })}\n`);
	expect(await meterOf('session', cwd, 120_000 + 3_600_001)).toMatchObject({ requests: 3, warm: false });
});

test('a five-minute cache', async () => {
	const { cwd, file } = await setUp();

	await writeFile(
		file,
		`${request('a', 0, { input_tokens: 0, cache_creation_input_tokens: 1000, cache_creation: { ephemeral_5m_input_tokens: 1000 }, output_tokens: 0 })}\n`,
	);
	expect(await meterOf('session', cwd, 0)).toMatchObject({ ttl: '5m', warmUntil: 300_000, coldCost: 1250 });
});
