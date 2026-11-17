import { appendFile, mkdir, mkdtemp, rm } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { backgroundKnown, backgroundOf } from './backgroundWork';

const line = value => `${JSON.stringify(value)}\n`;
const at = second => new Date(Date.UTC(2026, 10, 16, 12, 0, second)).toISOString();
const launch = (toolUseId, input) =>
	line({ type: 'assistant', message: { content: [{ type: 'tool_use', id: toolUseId, name: 'Bash', input }] } });
const launched = (toolUseId, result, second) =>
	line({
		type: 'user',
		timestamp: at(second),
		toolUseResult: result,
		message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, content: 'Command running in background' }] },
	});
const notification = (taskId, status = 'completed') =>
	line({
		type: 'queue-operation',
		operation: 'enqueue',
		content: `<task-notification>\n<task-id>${taskId}</task-id>\n<status>${status}</status>\n</task-notification>`,
	});

test('what a session has out in the background, from its launch until its task notification is queued', async () => {
	const home = await mkdtemp(join(os.tmpdir(), 'paude-background-'));
	const was = process.env.CLAUDE_CONFIG_DIR;
	const id = 'b9000000-0000-4000-8000-000000000000';
	const file = join(home, 'projects', '-repo', `${id}.jsonl`);
	const session = { id, cwd: '/repo', startedAt: Date.parse(at(10)) };

	process.env.CLAUDE_CONFIG_DIR = home;
	try {
		await mkdir(join(home, 'projects', '-repo'), { recursive: true });
		await Bun.write(
			file,
			// Launched by a Claude since gone: never reported done, and not out any more
			launch('t0', { command: 'old', description: 'From before', run_in_background: true }) +
				launched('t0', { backgroundTaskId: 'bold' }, 5) +
				launch('t1', { command: 'bun test', description: 'Run the e2e tests', run_in_background: true }) +
				launched('t1', { backgroundTaskId: 'b1' }, 11) +
				launched('t2', { isAsync: true, status: 'async_launched', agentId: 'a2', description: 'Audit the docs' }, 12),
		);
		expect(await backgroundOf(session)).toEqual([
			{ what: 'Run the e2e tests', at: Date.parse(at(11)), kind: 'command' },
			{ what: 'Audit the docs', at: Date.parse(at(12)), kind: 'agent' },
		]);

		// A command's output quoting a notification isn't one
		await appendFile(
			file,
			line({
				type: 'user',
				message: {
					content: [{ type: 'tool_result', tool_use_id: 't3', content: '<task-id>b1</task-id> <task-notification>' }],
				},
			}) + notification('a2', 'failed'),
		);
		expect((await backgroundOf(session)).map(({ what }) => what)).toEqual(['Run the e2e tests']);
		expect(backgroundKnown(id)).toHaveLength(1);

		await appendFile(file, notification('b1'));
		expect(await backgroundOf(session)).toEqual([]);
		expect(backgroundKnown('never-read')).toEqual([]);
	} finally {
		if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = was;
		await rm(home, { recursive: true, force: true });
	}
});
