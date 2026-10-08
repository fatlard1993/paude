import { CLOSED } from './protocol';

// Quiet this long, the socket is asked for a word back; silent this long after, it's taken for dead (a phone woke
// with it, a network changed under it) and a new one opens
const QUIET_MS = 25_000;
const ANSWER_MS = 5_000;
const ASK_TIMEOUT_MS = 8_000;

// Why the server closed or refused the socket, when it's for good: the login ended, the session did, or it won't
// start (and why not): { state, reason }
const whyRefused = async (url, sessionId, headers) => {
	try {
		const response = await fetch(`${url}/api/sessions/${sessionId}`, {
			headers,
			signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
		});

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
// 'unauthorized' or 'failed' (to start, with the reason); the last three are final. `wake()` checks the socket at
// once, for a page coming back into view.
const sessionSocket = ({
	url,
	sessionId,
	headers,
	hello,
	onOutput,
	onMessage,
	onState,
	startAfter = 0,
	quietMs = QUIET_MS,
	answerMs = ANSWER_MS,
}) => {
	let socket;
	let retry;
	let delay = 1000;
	let finished = false;
	let heardAt = Date.now();
	let answerWait = null;

	const stopChecking = () => {
		clearTimeout(answerWait);
		answerWait = null;
	};

	const finish = (state, reason) => {
		if (finished) return;
		finished = true;
		clearTimeout(retry);
		clearInterval(heartbeat);
		stopChecking();
		onState(state, reason);
	};

	const send = message => {
		if (socket?.readyState !== WebSocket.OPEN) return false;

		socket.send(JSON.stringify(message));

		return true;
	};

	const connect = () => {
		if (finished) return;

		const own = new WebSocket(
			`${url.replace(/^http/, 'ws')}/api/sessions/${sessionId}/attach`,
			headers && { headers },
		);

		socket = own;
		own.binaryType = 'arraybuffer';

		// A socket given up on can still say something later; only the current one is listened to
		own.addEventListener('open', () => {
			if (socket !== own) return;
			delay = 1000;
			heardAt = Date.now();
			onState('connected');
			send({ type: 'hello', ...hello() });
		});

		own.addEventListener('message', ({ data }) => {
			if (socket !== own) return;
			heardAt = Date.now();
			stopChecking();
			if (typeof data !== 'string') return onOutput(new Uint8Array(data));

			const message = JSON.parse(data);

			if (message.type === 'pong') return;
			if (message.type === 'exit') return finish('ended');

			onMessage(message);
		});

		own.addEventListener('close', async ({ code }) => {
			if (finished || socket !== own) return;
			stopChecking();
			if (code === CLOSED.unauthorized) return finish('unauthorized');
			if (code === CLOSED.ended) return finish('ended');

			const refused = await whyRefused(url, sessionId, headers);

			if (refused) return finish(refused.state, refused.reason);

			onState('reconnecting');
			retry = setTimeout(connect, delay);
			delay = Math.min(delay * 2, 10_000);
		});
	};

	// Now, rather than after the backoff: a page back in view shouldn't wait out a timer that slept with it
	const reconnectNow = () => {
		if (finished) return;
		clearTimeout(retry);
		stopChecking();

		const stale = socket;

		socket = null;
		stale?.close();
		delay = 1000;
		onState('reconnecting');
		connect();
	};

	// Asks for a word back; a socket that stays silent is dead though it still looks open
	const check = () => {
		if (finished || answerWait) return;
		if (socket?.readyState !== WebSocket.OPEN) return reconnectNow();

		send({ type: 'ping' });
		answerWait = setTimeout(reconnectNow, answerMs);
	};

	const heartbeat = setInterval(() => Date.now() - heardAt >= quietMs && check(), quietMs / 5);

	retry = setTimeout(connect, startAfter);

	return {
		send,
		wake: check,
		close() {
			finished = true;
			clearTimeout(retry);
			clearInterval(heartbeat);
			stopChecking();
			socket?.close();
		},
	};
};

export default sessionSocket;
