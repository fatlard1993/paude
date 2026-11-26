import { mkdir, mkdtemp } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { claudeHolding, heldWhy } from './claudeProcesses';

const ID = 'c0d55294-66a3-4743-b251-5056cf98fea6';

test('the Claude process with a conversation open is found by its note, passing over one that died', async () => {
	const home = await mkdtemp(join(os.tmpdir(), 'paude-claude-processes-'));
	const folder = join(home, 'sessions');
	const was = process.env.CLAUDE_CONFIG_DIR;

	process.env.CLAUDE_CONFIG_DIR = home;
	try {
		await mkdir(folder, { recursive: true });
		await Bun.write(join(folder, '100.json'), JSON.stringify({ pid: 100, sessionId: ID, kind: 'interactive' }));
		await Bun.write(
			join(folder, '200.json'),
			JSON.stringify({ pid: 200, sessionId: ID, kind: 'bg', jobId: 'c0d55294' }),
		);
		await Bun.write(join(folder, '300.json'), '{ half written');

		const isAlive = pid => pid === 200;

		expect(await claudeHolding(ID, { isAlive })).toEqual({ pid: 200, kind: 'bg', jobId: 'c0d55294' });
		expect(await claudeHolding('another', { isAlive })).toBeNull();
		expect(await claudeHolding(ID, { isAlive: () => false })).toBeNull();
	} finally {
		if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = was;
	}
});

test('a conversation in the background says how to reach it and hand it back; one open elsewhere, which process', () => {
	expect(heldWhy({ pid: 200, kind: 'bg', jobId: 'c0d55294' })).toContain('claude stop c0d55294');
	expect(heldWhy({ pid: 100, kind: 'interactive' })).toContain('pid 100');
});
