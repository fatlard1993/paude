import { appendFile, mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, expect, test } from 'bun:test';

import { feedFrom, sessionFeed } from './feed';

const configDir = process.env.CLAUDE_CONFIG_DIR;

afterAll(() => {
	if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = configDir;
});

const at = '2026-10-11T12:00:00.000Z';
const prompt = text => ({ type: 'user', timestamp: at, message: { content: text } });
const said = (...content) => ({ type: 'assistant', timestamp: at, message: { content } });

test('prompts, what Claude wrote and the tools it used, in order; results, markup and subagents left out', () => {
	const lines = [
		prompt('fix the door'),
		said(
			{ type: 'text', text: ' Looking. ' },
			{ type: 'tool_use', name: 'Bash', input: { command: 'ls', description: 'List' } },
		),
		{ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 't1', content: 'a' }] } },
		prompt('<system-reminder>noise</system-reminder>'),
		{ ...said({ type: 'text', text: 'from a subagent' }), isSidechain: true },
		said({ type: 'tool_use', name: 'Edit', input: { file_path: '/repo/src/door.js' } }, { type: 'text', text: '  ' }),
	];

	expect(feedFrom(lines, '/repo')).toEqual([
		{ kind: 'prompt', at, text: 'fix the door' },
		{ kind: 'text', at, text: 'Looking.' },
		{ kind: 'tool', at, name: 'Bash', summary: 'List', command: 'ls' },
		{ kind: 'tool', at, name: 'Edit', summary: 'src/door.js', file: 'src/door.js', edits: true },
	]);
});

test('a cursor picks up where the last read stopped, and a half-written line waits', async () => {
	const home = await mkdtemp(path.join(os.tmpdir(), 'paude-feed-'));
	const cwd = '/work/app';
	const file = path.join(home, 'projects', cwd.replace(/[^a-zA-Z0-9]/g, '-'), 'feed-session.jsonl');

	process.env.CLAUDE_CONFIG_DIR = home;
	await Bun.write(file, `${JSON.stringify(prompt('hello'))}\n`);

	const now = await sessionFeed('feed-session', cwd);

	expect(now.entries).toEqual([]);

	const fromStart = await sessionFeed('feed-session', cwd, '0');

	expect(fromStart.entries.map(entry => entry.text)).toEqual(['hello']);
	expect(fromStart.cursor).toBe(now.cursor);

	const reply = JSON.stringify(said({ type: 'text', text: 'hi back' }));

	await appendFile(file, reply.slice(0, 10));
	expect((await sessionFeed('feed-session', cwd, fromStart.cursor)).cursor).toBe(fromStart.cursor);

	await appendFile(file, `${reply.slice(10)}\n`);
	const next = await sessionFeed('feed-session', cwd, fromStart.cursor);

	expect(next.entries.map(entry => entry.text)).toEqual(['hi back']);
	expect(next.more).toBe(false);
	expect((await sessionFeed('feed-session', cwd, next.cursor)).entries).toEqual([]);
});

test('a session with no transcript yet is empty, from the start', async () => {
	process.env.CLAUDE_CONFIG_DIR = await mkdtemp(path.join(os.tmpdir(), 'paude-feed-'));

	expect(await sessionFeed('not-yet', '/work/app', '0')).toEqual({ entries: [], cursor: '0', more: false });
});
