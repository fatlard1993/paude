import os from 'os';

import { CLOSED } from '../../shared/protocol';
import { identityOf } from '../auth';
import { may } from '../permissions';
import { sessionEnvironment } from './PtySession';

// Enough for a few people with a few each; a page that leaks them can't fill the machine
const MAX_SHELLS = 16;
const KILL_AFTER_MS = 2000;

const shells = new Set();

const loginShell = () => [process.env.SHELL || os.userInfo().shell || '/bin/sh', '-l'];

const clamp = (value, min, max) => Math.min(Math.max(Math.round(Number(value)) || min, min), max);

// The PTY's hangup ends the shell and whatever it started in the foreground; anything ignoring that is killed
const end = socket => {
	const { shell } = socket.data;

	shells.delete(socket);
	if (!shell || shell.exitCode !== null || shell.signalCode !== null) return;

	shell.kill('SIGHUP');
	setTimeout(() => shell.exitCode === null && shell.kill('SIGKILL'), KILL_AFTER_MS).unref();
};

const spawn = (socket, { cols, rows }) => {
	if (shells.size >= MAX_SHELLS) return socket.close(CLOSED.ended, 'Too many side terminals are open');

	try {
		socket.data.shell = Bun.spawn(loginShell(), {
			cwd: socket.data.cwd,
			env: { ...sessionEnvironment(), TERM: 'xterm-256color', COLORTERM: 'truecolor' },
			terminal: { cols: clamp(cols, 20, 500), rows: clamp(rows, 5, 200), data: (terminal, data) => socket.send(data) },
		});
	} catch {
		return socket.close(CLOSED.ended, 'The shell could not start');
	}

	shells.add(socket);
	socket.data.shell.exited.then(() => {
		shells.delete(socket);
		socket.close(CLOSED.ended, 'Shell exited');
	});
};

const allowed = socket => {
	const identity = identityOf(socket.data.credential);

	if (may(identity, 'type', socket.data.sessionId)) return true;

	socket.close(CLOSED.unauthorized, 'Login ended');

	return false;
};

// A shell in the session's folder for the one person who opened it, living only as long as their socket
export default {
	message(socket, raw) {
		if (!allowed(socket)) return;

		let message;

		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}

		const { shell } = socket.data;

		if (message?.type === 'hello' && !shell) spawn(socket, message);
		else if (message?.type === 'input' && typeof message.data === 'string') shell?.terminal.write(message.data);
		else if (message?.type === 'resize')
			shell?.terminal.resize(clamp(message.cols, 20, 500), clamp(message.rows, 5, 200));
	},
	close: end,
};

// A revoked login or a lost role closes its shells, even ones nobody is typing into
export const sweepSideShells = () => {
	for (const socket of shells) allowed(socket);
};
