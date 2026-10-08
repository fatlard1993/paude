import { CLOSED } from './protocol';

// Why the server closed or refused the socket, when it's for good: the login ended, the session did, or it won't
// start (and why not): { state, reason }
const whyRefused = async (url, sessionId, headers) => {
	try {
		const response = await fetch(`${url}/api/sessions/${sessionId}`, { headers });

		if (response.status === 401) return { state: 'unauthorized' };
		if (response.status === 404) return { state: 'ended' };

		const { startFailure } = response.ok ? await response.json() : {};

		if (startFailure) return { state: 'failed', reason: startFailure };
	} catch {
		// Unreachable: keep retrying
	}

	return null;
};

// Keeps one session attached across drops, from a browser (its cookie) or the terminal (a bearer token in
// `headers`); each reconnect starts from a fresh snapshot. `onState` hears 'connected', 'reconnecting', 'ended',
// 'unauthorized' or 'failed' (to start, with the reason); the last three are final.
const sessionSocket = ({ url, sessionId, headers, hello, onOutput, onMessage, onState, startAfter = 0 }) => {
	let socket;
	let retry;
	let delay = 1000;
	let finished = false;

	const finish = (state, reason) => {
		if (finished) return;
		finished = true;
		clearTimeout(retry);
		onState(state, reason);
	};

	const send = message => {
		if (socket?.readyState !== WebSocket.OPEN) return false;

		socket.send(JSON.stringify(message));

		return true;
	};

	const connect = () => {
		if (finished) return;

		socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/sessions/${sessionId}/attach`, headers && { headers });
		socket.binaryType = 'arraybuffer';

		socket.addEventListener('open', () => {
			delay = 1000;
			onState('connected');
			send({ type: 'hello', ...hello() });
		});

		socket.addEventListener('message', ({ data }) => {
			if (typeof data !== 'string') return onOutput(new Uint8Array(data));

			const message = JSON.parse(data);

			if (message.type === 'exit') return finish('ended');

			onMessage(message);
		});

		socket.addEventListener('close', async ({ code }) => {
			if (finished) return;
			if (code === CLOSED.unauthorized) return finish('unauthorized');
			if (code === CLOSED.ended) return finish('ended');

			const refused = await whyRefused(url, sessionId, headers);

			if (refused) return finish(refused.state, refused.reason);

			onState('reconnecting');
			retry = setTimeout(connect, delay);
			delay = Math.min(delay * 2, 10_000);
		});
	};

	retry = setTimeout(connect, startAfter);

	return {
		send,
		close() {
			finished = true;
			clearTimeout(retry);
			socket?.close();
		},
	};
};

export default sessionSocket;
