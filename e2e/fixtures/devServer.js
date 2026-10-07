#!/usr/bin/env bun
// A dev server as a session would start one: a page that loads its script by an absolute path (as Vite's do) and
// talks to the server over a WebSocket, which echoes
const server = Bun.serve({
	port: Number(process.argv[2] ?? 0),
	fetch(request, bun) {
		const { pathname } = new URL(request.url);

		if (request.headers.get('upgrade') === 'websocket')
			return bun.upgrade(request) ? undefined : new Response('no', { status: 400 });
		if (pathname === '/assets/app.js')
			return new Response(
				"document.title = 'app loaded'; const socket = new WebSocket(`${location.origin.replace('http', 'ws')}/live`); socket.onmessage = event => (document.body.dataset.echo = event.data); socket.onopen = () => socket.send('ping');",
				{ headers: { 'content-type': 'text/javascript' } },
			);
		if (pathname === '/')
			return new Response('<!doctype html><script src="/assets/app.js"></script><p>dev server</p>', {
				headers: { 'content-type': 'text/html' },
			});

		return new Response('not found', { status: 404 });
	},
	websocket: { message: (socket, message) => socket.send(`echo ${message}`) },
});

console.log(server.port);
