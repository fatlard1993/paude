import { mkdir, mkdtemp } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { beforeAll, expect, test } from 'bun:test';

import { bornOf, carriesOn, folderOf, resumeId, transcriptFile, transcriptLines } from './transcript';

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

test('a session Claude carried on under a new id is read from where it went, however many times it went on', async () => {
	const folder = join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-work');
	const line = value => `${JSON.stringify(value)}\n`;
	const [first, second, third] = ['c0', 'c1', 'c2'].map(id => `${id}000000-0000-4000-8000-000000000000`);
	const went = (from, to) => line({ type: 'continued-in', sessionId: from, continuedInSessionId: to });

	await mkdir(folder, { recursive: true });
	await Bun.write(join(folder, `${first}.jsonl`), line({ type: 'user', message: { content: 'go' } }));
	expect((await transcriptLines(first, '/work')).length).toBe(1);

	// A line quoting the record, as a transcript discussing it would, isn't one; and a loop back stops before going round again
	await Bun.write(
		join(folder, `${first}.jsonl`),
		line({ type: 'user', message: { content: went(first, 'nowhere') } }) + went(first, second),
	);
	await Bun.write(join(folder, `${second}.jsonl`), line({ type: 'user', sessionId: second }) + went(second, third));
	await Bun.write(join(folder, `${third}.jsonl`), line({ type: 'user', sessionId: third }) + went(third, first));

	expect((await transcriptFile(first, '/work')).name).toEndWith(`${third}.jsonl`);
	expect(carriesOn(third)).toBe(first);
	expect(carriesOn(first)).toBeUndefined();
});

test("a session's birth is the time on its transcript's first line, and unknown without one", async () => {
	const folder = join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-work');
	const id = 'b0000000-0000-4000-8000-000000000000';
	const line = value => `${JSON.stringify(value)}\n`;

	await mkdir(folder, { recursive: true });
	expect(await bornOf(id, '/work')).toBeNull();
	await Bun.write(
		join(folder, `${id}.jsonl`),
		line({ type: 'summary' }) + line({ type: 'user', timestamp: '2026-11-06T18:00:00.000Z' }),
	);
	expect(await bornOf(id, '/work')).toBe(Date.parse('2026-11-06T18:00:00.000Z'));
});

test('a session is taken back up under where it went on, unless it went on under its old id after moving', async () => {
	const folder = join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-work');
	const line = value => `${JSON.stringify(value)}\n`;
	const [moved, onward, stayed, fork] = ['d0', 'd1', 'd2', 'd3'].map(id => `${id}000000-0000-4000-8000-000000000000`);

	await mkdir(folder, { recursive: true });
	await Bun.write(
		join(folder, `${moved}.jsonl`),
		line({ type: 'continued-in', sessionId: moved, continuedInSessionId: onward }),
	);
	await Bun.write(join(folder, `${onward}.jsonl`), line({ type: 'user', sessionId: onward }));
	expect(await resumeId(moved, '/work')).toBe(onward);

	await Bun.write(
		join(folder, `${stayed}.jsonl`),
		line({ type: 'continued-in', sessionId: stayed, continuedInSessionId: fork }) +
			line({ type: 'assistant', sessionId: stayed }),
	);
	await Bun.write(join(folder, `${fork}.jsonl`), line({ type: 'user', sessionId: fork }));
	expect(await resumeId(stayed, '/work')).toBe(stayed);
	expect((await transcriptFile(stayed, '/work')).name).toEndWith(`${stayed}.jsonl`);
});

test('a continuation whose transcript is missing leaves the session on its own', async () => {
	const folder = join(process.env.CLAUDE_CONFIG_DIR, 'projects', '-work');
	const id = 'c9000000-0000-4000-8000-000000000000';

	await mkdir(folder, { recursive: true });
	await Bun.write(
		join(folder, `${id}.jsonl`),
		`${JSON.stringify({ type: 'continued-in', sessionId: id, continuedInSessionId: 'gone' })}\n`,
	);
	expect((await transcriptFile(id, '/work')).name).toEndWith(`${id}.jsonl`);
});
