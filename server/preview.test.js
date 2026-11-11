import { expect, test } from 'bun:test';

import { newVersionReady, previewSocket } from './preview';

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

// A stand-in for a game's own server: its socket, and the server it's on
const gameServer = () => {
	const game = { peer: null };

	game.server = Bun.serve({
		hostname: '127.0.0.1',
		port: 0,
		fetch: (request, server) => (server.upgrade(request) ? undefined : new Response('no', { status: 400 })),
		websocket: {
			open: ws => (game.peer = ws),
			message: () => {},
		},
	});

	return game;
};

// The page's end of the relay: what it's sent, and whether it was closed
const pageSocket = (name, target, hold) => {
	const page = { received: [], closed: false };

	page.socket = {
		data: { name, target, protocols: [], headers: {}, hold },
		send: message => page.received.push(message),
		close: () => (page.closed = true),
	};

	return page;
};

test("a held game's live reload is kept from its page, which is told a new version is ready", async () => {
	const game = gameServer();
	const page = pageSocket('held-share', `ws://127.0.0.1:${game.server.port}/`, true);

	previewSocket.open(page.socket);
	await wait(200);

	game.peer.send('hotReload');
	await wait(100);
	expect(page.received).toEqual([]);
	expect(newVersionReady('held-share')).toBe(true);

	// Everything else still reaches the page as it always did
	game.peer.send('a message');
	await wait(50);
	expect(page.received).toEqual(['a message']);

	previewSocket.close(page.socket);
	game.server.stop(true);
});

test('a held game whose server restarts keeps its page open, and the page is told a newer version is ready', async () => {
	const game = gameServer();
	const page = pageSocket('restarted-share', `ws://127.0.0.1:${game.server.port}/`, true);

	previewSocket.open(page.socket);
	await wait(200);
	expect(newVersionReady('restarted-share')).toBe(false);

	game.peer.close();
	await wait(1500);

	expect(page.closed).toBe(false);
	expect(newVersionReady('restarted-share')).toBe(true);

	previewSocket.close(page.socket);
	game.server.stop(true);
});

test("another app's live reload goes on to its page as it always did", async () => {
	const game = gameServer();
	const page = pageSocket('plain-share', `ws://127.0.0.1:${game.server.port}/`, false);

	previewSocket.open(page.socket);
	await wait(200);

	game.peer.send('hotReload');
	await wait(100);
	expect(page.received).toEqual(['hotReload']);
	expect(newVersionReady('plain-share')).toBe(false);

	previewSocket.close(page.socket);
	game.server.stop(true);
});
