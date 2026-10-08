import { mkdir, mkdtemp } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { beforeAll, expect, test } from 'bun:test';

import { folderOf } from './transcript';

const ID = '74cddd99-0000-4000-8000-000000000000';
const BARE = '74cddd99-0000-4000-8000-000000000001';

beforeAll(async () => {
	const home = await mkdtemp(join(os.tmpdir(), 'paude-transcript-'));
	const folder = join(home, 'projects', '-somewhere');

	process.env.CLAUDE_CONFIG_DIR = home;
	await mkdir(folder, { recursive: true });

	// As Claude Code wrote one: a title and the mode up top, then file snapshots, megabytes before a line names the folder
	const snapshot = JSON.stringify({ type: 'file-history-snapshot', snapshot: { files: 'x'.repeat(38_000) } });
	const head = [
		{ type: 'ai-title', aiTitle: 'Image analysis', sessionId: ID },
		{ type: 'mode', mode: 'normal', sessionId: ID },
	].map(line => JSON.stringify(line));

	await Bun.write(
		join(folder, `${ID}.jsonl`),
		[
			...head,
			...Array(70).fill(snapshot),
			JSON.stringify({ type: 'user', cwd: '/home/someone/Projects/mods "quoted"', sessionId: ID }),
			'',
		].join('\n'),
	);
	await Bun.write(join(folder, `${BARE}.jsonl`), `${head.join('\n')}\n`);
});

test('finds the folder a session ran in past megabytes of bookkeeping at the head of its transcript', async () => {
	expect(await folderOf(ID)).toBe('/home/someone/Projects/mods "quoted"');
});

test('a transcript that never names a folder has none', async () => {
	expect(await folderOf(BARE)).toBeNull();
	expect(await folderOf('no-such-session')).toBeNull();
});
