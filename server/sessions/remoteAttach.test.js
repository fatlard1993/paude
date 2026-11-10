import { afterEach, expect, test } from 'bun:test';

import relay from './remoteAttach';

const servers = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

// Another paude's attach socket: it takes only this machine's login there, says hello back, echoes, and ends the
// session for good on 'bye'
const remoteServer = () => {
	const heard = [];
	const server = Bun.serve({
		port: 0,
		fetch(request, server) {
			heard.push({ path: new URL(request.url).pathname, auth: request.headers.get('authorization') });
			if (request.headers.get('authorization') !== 'Bearer secret') return new Response('no', { status: 401 });

			return server.upgrade(request) ? undefined : new Response('no', { status: 400 });
		},
		websocket: {
			open: socket => socket.send(new Uint8Array([1, 2, 3])),
			message: (socket, message) => {
				if (message === 'bye') socket.close(4404, 'ended');
				else if (message === 'drop') socket.close(1001);
				else socket.send(`echo ${message}`);
			},
			close: () => heard.push('closed'),
		},
	});

	servers.push(server);

	return { url: `http://localhost:${server.port}`, heard };
};

const relayServer = (remote, token = 'secret') => {
	const server = Bun.serve({
		port: 0,
		fetch: (request, server) =>
			server.upgrade(request, {
				data: { route: 'remoteAttach', server: { url: remote.url, token }, sessionId: 'abc-1' },
			})
				? undefined
				: new Response('no', { status: 400 }),
		websocket: relay,
	});

	servers.push(server);

	return `ws://localhost:${server.port}`;
};

const nextMessage = socket =>
	new Promise(resolve => socket.addEventListener('message', ({ data }) => resolve(data), { once: true }));

test("a remote session's socket is relayed on this machine's login there, both ways, its frames untouched", async () => {
	const remote = remoteServer();
	const socket = new WebSocket(relayServer(remote));

	socket.binaryType = 'arraybuffer';
	// Sent before the other server has answered: it waits, and arrives
	socket.addEventListener('open', () => socket.send('hello'));

	expect([...new Uint8Array(await nextMessage(socket))]).toEqual([1, 2, 3]);
	expect(await nextMessage(socket)).toBe('echo hello');
	expect(remote.heard).toEqual([{ path: '/api/sessions/abc-1/attach', auth: 'Bearer secret' }]);

	const closed = new Promise(resolve => socket.addEventListener('close', resolve));

	socket.send('bye');
	expect((await closed).code).toBe(4404);
});

const closeOf = socket => new Promise(resolve => socket.addEventListener('close', ({ code }) => resolve(code)));

test('refused there (a login that ended) or not answering, the socket here closes as a drop to reconnect from', async () => {
	const refused = new WebSocket(relayServer(remoteServer(), 'stale'));
	const unanswered = new WebSocket(relayServer({ url: 'http://localhost:1' }));

	for (const code of await Promise.all([closeOf(refused), closeOf(unanswered)])) expect(code).not.toBeGreaterThan(3999);
});

test('dropped there for no reason of its own, the socket here closes as a drop too', async () => {
	const socket = new WebSocket(relayServer(remoteServer()));

	socket.addEventListener('open', () => socket.send('drop'));
	expect(await closeOf(socket)).not.toBeGreaterThan(3999);
});

test('the browser leaving closes the socket there, even before it answered', async () => {
	const remote = remoteServer();
	const socket = new WebSocket(relayServer(remote));

	await nextMessage(socket);
	socket.close();
	await Bun.sleep(50);
	expect(remote.heard).toContain('closed');

	const early = remoteServer();
	const hasty = new WebSocket(relayServer(early));

	hasty.addEventListener('open', () => hasty.close());
	await closeOf(hasty);
	await Bun.sleep(100);
	// However far it got there, nothing is left open
	const closed = early.heard.filter(heard => heard === 'closed').length;

	expect(closed).toBe(early.heard.length - closed);
});
