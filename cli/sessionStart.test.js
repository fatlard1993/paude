import { expect, test } from 'bun:test';

import { parseStart, readAnswers } from './sessionStart';

test("paude start's words are the prompt, its options where and how, and -- ends the options", () => {
	expect(parseStart(['write', 'the', 'notes'])).toEqual({ prompt: 'write the notes' });
	expect(parseStart(['--project', 'shop', '--worktree', 'notes', '--model', 'sonnet', 'go'])).toEqual({
		project: 'shop',
		worktree: 'notes',
		model: 'sonnet',
		prompt: 'go',
	});
	expect(parseStart(['--', '--project', 'is', 'words'])).toEqual({ prompt: '--project is words' });
	// None: read from stdin
	expect(parseStart(['--project', 'shop'])).toEqual({ project: 'shop', prompt: null });
	expect(parseStart(['--project'])).toEqual({ error: '--project needs a value' });
	expect(parseStart(['--fast', 'go'])).toEqual({ error: 'Not understood: --fast' });
});

test('the answers stream back as lines of JSON, however the chunks fall', async () => {
	const encoder = new TextEncoder();
	const chunks = ['{"asked":true}\n{"wai', 'ting":true}\n', '{"started":{"id":"a"},"by":"chase"}'];
	const body = (async function* () {
		for (const chunk of chunks) yield encoder.encode(chunk);
	})();
	const read = [];

	for await (const answer of readAnswers(body)) read.push(answer);
	expect(read).toEqual([{ asked: true }, { waiting: true }, { started: { id: 'a' }, by: 'chase' }]);
});
