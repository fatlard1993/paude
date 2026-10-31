import { mkdtemp, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, expect, test } from 'bun:test';

import { burnOf } from './cacheMeter';
import { fuelOf, initFuel, noteEmpty } from './fuel';

const configDir = process.env.CLAUDE_CONFIG_DIR;

afterAll(() => {
	if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = configDir;
});

test('the account a machine draws on, by a hash, and the tank measured when a limit stops a session', async () => {
	const home = await mkdtemp(path.join(os.tmpdir(), 'paude-fuel-'));

	process.env.CLAUDE_CONFIG_DIR = home;
	await writeFile(
		path.join(home, '.claude.json'),
		JSON.stringify({ oauthAccount: { accountUuid: 'one-account', planDisplayName: 'Max' } }),
	);
	await initFuel(home);

	const before = await fuelOf();

	expect(before).toMatchObject({ plan: 'Max', capacity: null, capacityAgo: null });
	expect(before.account).toMatch(/^[0-9a-f]{12}$/);
	expect(before.account).not.toContain('one-account');

	await noteEmpty();

	const after = await fuelOf();

	expect(after.capacity).toBe(burnOf().burned);
	expect(after.capacityAgo).toBeGreaterThanOrEqual(0);
	// Kept on disk for the next window
	expect(Object.values(await Bun.file(path.join(home, 'fuel.json')).json())[0].capacity).toBe(after.capacity);
});
