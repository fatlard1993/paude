import { trustedCertificates } from '../../shared/certificates';

// A session on another paude, attached through this one, or a side shell opened in its folder there (`path`): the
// browser's socket here, relayed to that server's own socket on this machine's login there, which never leaves this
// server. Frames pass through untouched both ways; what the browser sends before that server answers waits for it.
const relay = {
	open(socket) {
		const { server, sessionId, path = 'attach' } = socket.data;
		const upstream = new WebSocket(`${server.url.replace(/^http/, 'ws')}/api/sessions/${sessionId}/${path}`, {
			headers: { authorization: `Bearer ${server.token}` },
			tls: trustedCertificates(),
		});

		upstream.binaryType = 'arraybuffer';
		socket.data.upstream = upstream;
		socket.data.waiting = [];
		upstream.addEventListener('open', () => {
			for (const message of socket.data.waiting) upstream.send(message);
			socket.data.waiting = null;
		});
		upstream.addEventListener('message', ({ data }) => socket.send(data));
		// Its own reasons for good (the login there ended, the session did) carry over; anything else is a drop the
		// browser reconnects from
		upstream.addEventListener('close', ({ code, reason }) =>
			code >= 4000 && code < 5000 ? socket.close(code, reason) : socket.close(),
		);
	},
	message(socket, message) {
		const { upstream, waiting } = socket.data;

		if (waiting) waiting.push(message);
		else if (upstream?.readyState === WebSocket.OPEN) upstream.send(message);
	},
	close(socket) {
		socket.data.upstream?.close();
	},
};

export default relay;
