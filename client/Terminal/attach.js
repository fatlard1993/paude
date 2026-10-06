import { CLOSED } from '../../shared/protocol';

// A refused upgrade only shows up as an abnormal close; the server says why when asked directly
const whyRefused = async sessionId => {
	try {
		const { status } = await fetch(`/api/sessions/${sessionId}`);

		if (status === 401) return 'unauthorized';
		if (status === 404) return 'ended';
	} catch {
		// Unreachable: keep retrying
	}

	return null;
};

// Keeps one session's terminal attached across drops; each reconnect starts from a fresh snapshot.
// `onState` hears 'connected', 'reconnecting', 'ended' or 'unauthorized'; the last two are final.
const attach = (sessionId, { hello, onOutput, onMessage, onState }) => {
	let socket;
	let retry;
	let delay = 1000;
	let finished = false;

	const finish = state => {
		finished = true;
		clearTimeout(retry);
		onState(state);
	};

	const send = message => {
		if (socket?.readyState !== WebSocket.OPEN) return false;

		socket.send(JSON.stringify(message));

		return true;
	};

	const connect = () => {
		if (finished) return;

		const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

		socket = new WebSocket(`${protocol}//${window.location.host}/api/sessions/${sessionId}/attach`);
		socket.binaryType = 'arraybuffer';

		socket.addEventListener('open', () => {
			delay = 1000;
			send({ type: 'hello', ...hello() });
			onState('connected');
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

			const refused = await whyRefused(sessionId);

			if (refused) return finish(refused);

			onState('reconnecting');
			retry = setTimeout(connect, delay);
			delay = Math.min(delay * 2, 10_000);
		});
	};

	connect();

	return {
		send,
		close() {
			finished = true;
			clearTimeout(retry);
			socket.close();
		},
	};
};

export default attach;
