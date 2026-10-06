import { expect, test } from 'bun:test';

import { readProgress, recentLines } from './progress';

const streamOf = chunks =>
	new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(new TextEncoder().encode(chunk));
				controller.close();
			},
		}),
	);

test('output arrives as it streams, split anywhere, and the last message is the answer', async () => {
	let output = '';
	const result = await readProgress(
		streamOf([
			'{"output":"inst',
			'alling\\n"}\n{"waiting":true}\n{"out',
			'put":"done\\n"}\n{"id":"abc"}\n{"waiting":true}\n',
		]),
		text => {
			output += text;
		},
	);

	expect(output).toBe('installing\ndone\n');
	expect(result).toEqual({ id: 'abc' });
	expect(await readProgress(streamOf([]), () => {})).toEqual({ error: 'The server stopped answering.' });
});

test('recent lines drop colors and keep only the latest state of a redrawn progress line', () => {
	const output = '\x1b[32m✔\x1b[0m resolved\nfetching 10%\rfetching 60%\rfetching 100%\nlinking\x07\n';

	expect(recentLines(output, 10)).toEqual(['✔ resolved', 'fetching 100%', 'linking']);
	expect(recentLines(output, 1)).toEqual(['linking']);
});
