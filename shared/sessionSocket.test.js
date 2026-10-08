import { expect, test } from 'bun:test';

import sessionSocket from './sessionSocket';

test("a session that won't start ends the retrying, with why", async () => {
	const server = Bun.serve({
		port: 0,
		fetch: request =>
			new URL(request.url).pathname.endsWith('/attach')
				? new Response('Session not found', { status: 404 })
				: Response.json({ id: 'x', startFailure: 'its folder is gone (/somewhere)' }),
	});
	const states = [];

	try {
		await new Promise(resolve =>
			sessionSocket({
				url: `http://127.0.0.1:${server.port}`,
				sessionId: 'x',
				hello: () => ({}),
				onOutput: () => {},
				onMessage: () => {},
				onState: (state, reason) => {
					states.push([state, reason]);
					if (state !== 'reconnecting') resolve();
				},
			}),
		);
	} finally {
		server.stop(true);
	}

	expect(states).toEqual([['failed', 'its folder is gone (/somewhere)']]);
});
