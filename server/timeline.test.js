import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { describeTool, sessionTurns, timelineFrom } from './timeline';

const at = second => `2026-10-07T12:00:${String(second).padStart(2, '0')}.000Z`;
const prompt = (text, second) => ({
	type: 'user',
	uuid: `p${second}`,
	timestamp: at(second),
	message: { content: text },
});
const use = (second, blocks, usage) => ({
	type: 'assistant',
	timestamp: at(second),
	message: { model: 'claude-opus-5-5', usage, content: blocks },
});
const result = (second, id, content, isError = false) => ({
	type: 'user',
	timestamp: at(second),
	message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
});

test('each turn: its prompt, the tools in order with what came back, its time and context', () => {
	const lines = [
		prompt('fix the tests', 0),
		use(2, [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/repo/src/a.js', offset: 9 } }], {
			input_tokens: 10,
			cache_read_input_tokens: 1000,
			output_tokens: 20,
		}),
		result(3, 't1', 'contents'),
		use(
			4,
			[{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'bun test', description: 'Run the tests' } }],
			{
				input_tokens: 5,
				cache_read_input_tokens: 1500,
				cache_creation_input_tokens: 100,
				output_tokens: 30,
			},
		),
		result(9, 't2', [{ type: 'text', text: '1 fail' }], true),
		use(10, [{ type: 'text', text: 'One still fails.' }]),
	];
	const [turn] = timelineFrom(lines, '/repo');

	expect(turn).toMatchObject({
		id: 'p0',
		prompt: 'fix the tests',
		at: at(0),
		endedAt: at(10),
		context: 1605,
		output: 50,
	});
	expect(turn.steps).toMatchObject([
		{ tool: 'Read', summary: 'src/a.js', file: 'src/a.js', line: 10, ok: true, output: 'contents' },
		{ tool: 'Bash', summary: 'Run the tests', command: 'bun test', ok: false, output: '1 fail', endedAt: at(9) },
	]);
});

test('what the person sent mid-turn stays with the turn it went into, not a turn of its own', () => {
	const queued = (text, kind = 'human') => ({
		type: 'attachment',
		timestamp: at(2),
		attachment: { type: 'queued_command', prompt: text, origin: { kind } },
	});
	const turns = timelineFrom(
		[
			prompt('lock accounts', 0),
			queued('per user, not per session'),
			queued('a task note', 'task'),
			// Sent with an image
			queued([
				{ type: 'text', text: '[Image #2]  what is this little thing?' },
				{ type: 'image', source: { type: 'base64', data: 'iVBOR' } },
			]),
		],
		'/repo',
	);

	expect(turns).toHaveLength(1);
	expect(turns[0].added).toEqual(['per user, not per session', '[Image #2]  what is this little thing?']);
});

test('a pasted prompt shows without the tags Claude Code keeps it in', () => {
	const [turn] = timelineFrom([prompt('<pasted_content id="1">\nhello\n</pasted_content id="1">', 0)], '/repo');

	expect(turn.prompt).toBe('hello');
});

test('names what each kind of tool was about', () => {
	expect(describeTool('Edit', { file_path: '/repo/x.js' }, '/repo')).toEqual({
		summary: 'x.js',
		file: 'x.js',
		edits: true,
	});
	expect(describeTool('Grep', { pattern: 'TODO' }).summary).toBe('TODO');
	expect(describeTool('WebFetch', { url: 'https://e.x' }).summary).toBe('https://e.x');
	expect(describeTool('Read', { file_path: '/elsewhere/y.js' }, '/repo').file).toBe('/elsewhere/y.js');
});

test('a turn keeps the start and the end of what Claude last wrote, where its list of what it did often sits', () => {
	const text = `Done: the cans and the plates. ${'x'.repeat(5000)} Left: the walk cycle.`;
	const [turn] = timelineFrom([prompt('fix them', 0), use(1, [{ type: 'text', text }])], '/repo');

	expect(turn.said).toStartWith('Done: the cans and the plates.');
	expect(turn.said).toEndWith('Left: the walk cycle.');
	expect(turn.said.length).toBeLessThan(2100);
});

test('a whole transcript is read as it grows, once each line, a line still being written left until it ends', async () => {
	const home = await mkdtemp(join(os.tmpdir(), 'paude-whole-'));
	const was = process.env.CLAUDE_CONFIG_DIR;
	const id = 'w0000000-0000-4000-8000-000000000000';
	const file = join(home, 'projects', '-repo', `${id}.jsonl`);
	const line = value => `${JSON.stringify(value)}\n`;
	const read = async () => sessionTurns(id, '/repo', { whole: true });

	process.env.CLAUDE_CONFIG_DIR = home;
	try {
		await mkdir(join(home, 'projects', '-repo'), { recursive: true });
		await writeFile(
			file,
			line(prompt('fix the tests', 0)) + line(use(1, [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }])),
		);
		expect((await read()).map(turn => turn.prompt)).toEqual(['fix the tests']);

		// Cut mid-character, as a write can leave it
		const next = Buffer.from(line(prompt('the ❯ box ─ edge', 2)));
		const cut = next.indexOf(Buffer.from('❯')) + 1;

		await appendFile(file, line(result(2, 't1', 'contents')));
		await appendFile(file, next.subarray(0, cut));
		expect((await read()).map(turn => turn.prompt)).toEqual(['fix the tests']);

		await appendFile(file, next.subarray(cut));
		// Read twice at once, as a turn's end does
		const [once, twice] = await Promise.all([read(), read()]);

		expect(once.map(turn => turn.prompt)).toEqual(['fix the tests', 'the ❯ box ─ edge']);
		expect(twice).toHaveLength(2);
		expect(once[0].steps[0]).toMatchObject({ ok: true, output: 'contents' });

		// A line longer than a slice
		await appendFile(file, line({ ...prompt('a big screenshot', 3), pad: 'x'.repeat(9 * 1024 * 1024) }));
		expect((await read()).map(turn => turn.prompt)).toEqual(['fix the tests', 'the ❯ box ─ edge', 'a big screenshot']);

		// Written anew, shorter
		await writeFile(file, line(prompt('fresh', 0)));
		expect((await read()).map(turn => turn.prompt)).toEqual(['fresh']);
	} finally {
		if (was === undefined) delete process.env.CLAUDE_CONFIG_DIR;
		else process.env.CLAUDE_CONFIG_DIR = was;
		await rm(home, { recursive: true, force: true });
	}
});
