import { expect, test } from 'bun:test';

import { describeTool, timelineFrom } from './timeline';

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
