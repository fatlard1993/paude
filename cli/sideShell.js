import serializeAddon from '@xterm/addon-serialize';

import { CLOSED } from '../shared/protocol';
import { createMirror } from './compositor';
import outputFilter from './outputFilter';
import { MOUSE_OFF } from './screen';

const { SerializeAddon } = serializeAddon;
const ESC = '\x1b';

// What a shell or the programs in it may have switched on, turned off before Claude's screen comes back (whose
// snapshot replays its own modes). The keyboard-protocol stack is left alone: the box keeps that balanced.
export const LEAVE_SHELL = `${ESC}[?2004l${ESC}[?1004l${MOUSE_OFF}${ESC}[?1l${ESC}>${ESC}[?25h${ESC}[0m`;

const endedBecause = ({ code, reason }, opened) => {
	if (code === CLOSED.unauthorized) return 'Your login no longer allows a terminal here.';
	if (code === CLOSED.ended) return reason === 'Shell exited' ? null : reason;

	return opened ? 'The connection dropped, so the side terminal ended.' : 'Could not open a side terminal.';
};

// A shell in the session's folder for this terminal alone, living as long as its socket. The mirror keeps its
// screen, so the box can draw over it and the screen can be put back after.
const openSideShell = ({ url, token }, id, { size, onOutput, onEnd }) => {
	const mirror = createMirror();
	const serializer = new SerializeAddon();
	const filter = outputFilter();
	const socket = new WebSocket(`${url.replace(/^http/, 'ws')}/api/sessions/${id}/shell`, {
		headers: { authorization: `Bearer ${token}` },
	});
	let opened = false;

	const send = message => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(message));

	mirror.loadAddon(serializer);
	mirror.resize(size.cols, size.rows);
	socket.binaryType = 'arraybuffer';
	socket.addEventListener('open', () => {
		opened = true;
		send({ type: 'hello', ...size });
	});
	socket.addEventListener('message', ({ data }) => {
		if (typeof data === 'string') return;

		const bytes = new Uint8Array(data);

		mirror.write(bytes);
		onOutput(filter(bytes));
	});
	socket.addEventListener('close', event => onEnd(endedBecause(event, opened)));

	return {
		mirror,
		input: data => send({ type: 'input', data }),
		resize: ({ cols, rows }) => {
			mirror.resize(cols, rows);
			send({ type: 'resize', cols, rows });
		},
		screen: () => serializer.serialize(),
		close: () => socket.close(),
	};
};

export default openSideShell;
