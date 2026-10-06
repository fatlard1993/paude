import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeAll, expect, test } from 'bun:test';

import { CLOSED } from '../../shared/protocol';
import { createInvite, createToken, credentialOf, initAuth, revokeInvite } from '../auth';
import sideShell, { sweepSideShells } from './sideShell';

let folder;

beforeAll(async () => {
	folder = await mkdtemp(path.join(os.tmpdir(), 'paude-shell-'));
	await initAuth(path.join(folder, 'data'));
});

const credentialFor = token =>
	credentialOf(new Request('http://paude.test/', { headers: { authorization: `Bearer ${token}` } }));

// What the server's socket would be, recording what the shell sends and how it closed
const fakeSocket = credential => {
	const decoder = new TextDecoder();
	const socket = {
		output: '',
		closed: null,
		data: { route: 'shell', sessionId: 'session-1', cwd: folder, credential },
		send: data => {
			socket.output += decoder.decode(data, { stream: true });
		},
		close: code => {
			socket.closed ??= code;
			sideShell.close(socket);
		},
	};

	return socket;
};

const until = async (check, ms = 5000) => {
	for (const start = Date.now(); Date.now() - start < ms;) {
		if (check()) return true;
		await Bun.sleep(25);
	}

	return false;
};

const say = (socket, message) => sideShell.message(socket, JSON.stringify(message));

test('a shell runs in the session folder and ends with its socket', async () => {
	const socket = fakeSocket(credentialFor(await createToken('owner')));

	say(socket, { type: 'hello', cols: 80, rows: 24 });
	say(socket, { type: 'input', data: 'echo side-$((6 * 7)); pwd\r' });

	expect(await until(() => socket.output.includes('side-42') && socket.output.includes(folder))).toBe(true);

	const { shell } = socket.data;

	sideShell.close(socket);
	await shell.exited;
	expect(shell.exitCode !== null || shell.signalCode !== null).toBe(true);
});

test('typing exit closes the socket as ended', async () => {
	const socket = fakeSocket(credentialFor(await createToken('owner')));

	say(socket, { type: 'hello', cols: 80, rows: 24 });
	say(socket, { type: 'input', data: 'exit\r' });

	expect(await until(() => socket.closed === CLOSED.ended)).toBe(true);
});

test("a revoked driver's shell closes, typing or not", async () => {
	const { invite } = await createInvite({ sessionId: 'session-1', name: 'Riley', role: 'drive', hours: 1 });
	const socket = fakeSocket(credentialFor(await createToken('Riley', { invite })));

	say(socket, { type: 'hello', cols: 80, rows: 24 });
	expect(await until(() => socket.output.length > 0)).toBe(true);

	const { shell } = socket.data;

	await revokeInvite(invite.id);
	sweepSideShells();

	expect(socket.closed).toBe(CLOSED.unauthorized);
	await shell.exited;
});

test('a shell can run one command instead, and ends when it does', async () => {
	const socket = fakeSocket(credentialFor(await createToken('owner')));

	say(socket, { type: 'hello', cols: 80, rows: 24, command: 'echo ran-$((6 * 7)) in "$(pwd)"' });

	expect(await until(() => socket.closed === CLOSED.ended)).toBe(true);
	expect(socket.output).toContain(`ran-42 in ${folder}`);
});
