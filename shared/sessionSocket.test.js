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

// A server that takes the socket and then says nothing: a connection that died while looking open
const silentServer = () => {
	const opened = [];
	const server = Bun.serve({
		port: 0,
		fetch: (request, bun) => (bun.upgrade(request) ? undefined : new Response('no', { status: 400 })),
		websocket: { open: socket => opened.push(socket), message: () => {} },
	});

	return { server, opened };
};

const attachTo = (server, options) => {
	const states = [];
	const connection = sessionSocket({
		url: `http://127.0.0.1:${server.port}`,
		sessionId: 'x',
		hello: () => ({}),
		onOutput: () => {},
		onMessage: () => {},
		onState: state => states.push(state),
		...options,
	});

	return { states, connection };
};

const until = async check => {
	for (let tries = 0; tries < 100 && !check(); tries++) await Bun.sleep(20);
};

test('woken, a socket that no longer answers is replaced at once', async () => {
	const { server, opened } = silentServer();
	const { states, connection } = attachTo(server, { answerMs: 100 });

	try {
		await until(() => opened.length === 1);
		connection.wake();
		await until(() => opened.length === 2);
		expect(opened.length).toBe(2);
		expect(states).toEqual(['connected', 'reconnecting', 'connected']);
	} finally {
		connection.close();
		server.stop(true);
	}
});

test('a socket quiet too long is asked for a word back, and replaced when none comes', async () => {
	const { server, opened } = silentServer();
	const { connection } = attachTo(server, { quietMs: 150, answerMs: 100 });

	try {
		await until(() => opened.length === 2);
		expect(opened.length).toBe(2);
	} finally {
		connection.close();
		server.stop(true);
	}
});

test('a socket that answers is kept', async () => {
	const opened = [];
	const server = Bun.serve({
		port: 0,
		fetch: (request, bun) => (bun.upgrade(request) ? undefined : new Response('no', { status: 400 })),
		websocket: {
			open: socket => opened.push(socket),
			message: (socket, raw) => JSON.parse(raw).type === 'ping' && socket.send(JSON.stringify({ type: 'pong' })),
		},
	});
	const { states, connection } = attachTo(server, { answerMs: 100 });

	try {
		await until(() => opened.length === 1);
		connection.wake();
		await Bun.sleep(300);
		expect(opened.length).toBe(1);
		expect(states).toEqual(['connected']);
	} finally {
		connection.close();
		server.stop(true);
	}
});
