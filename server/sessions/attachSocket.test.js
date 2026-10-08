import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { describe, expect, spyOn, test } from 'bun:test';

import { createLogin, credentialOf, initAuth } from '../auth';

import { CLOSED } from '../../shared/protocol';
import attachSocket from './attachSocket';

const socket = () => {
	const closes = [];

	return { data: { credential: null }, closes, close: (code, reason) => closes.push([code, reason]) };
};

describe('attach socket messages', () => {
	test('a socket whose login is gone is closed instead of handled', () => {
		const target = socket();

		attachSocket.message(target, JSON.stringify({ type: 'chat', text: 'hi' }));

		expect(target.closes).toEqual([[CLOSED.unauthorized, 'Login ended']]);
	});

	test('message types that name object internals are ignored rather than thrown on', async () => {
		await initAuth(await mkdtemp(path.join(os.tmpdir(), 'paude-socket-')));

		const login = await createLogin();
		const target = socket();

		// A live owner login, so each message gets past the credential check to the handler lookup
		target.data.credential = credentialOf(
			new Request('http://paude.test/', { headers: { cookie: `paude_login=${login}` } }),
		);
		expect(target.data.credential).not.toBeNull();

		const failures = spyOn(console, 'error').mockImplementation(() => {});

		for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
			expect(() => attachSocket.message(target, JSON.stringify({ type }))).not.toThrow();
		}
		await Bun.sleep(10);
		expect(target.closes).toEqual([]);
		expect(failures).not.toHaveBeenCalled();
		failures.mockRestore();
	});

	test('a ping is answered, so a client can tell its socket still reaches the server', async () => {
		const login = await createLogin();
		const target = { ...socket(), sent: [] };

		target.send = message => target.sent.push(JSON.parse(message));
		target.data.credential = credentialOf(
			new Request('http://paude.test/', { headers: { cookie: `paude_login=${login}` } }),
		);
		attachSocket.message(target, JSON.stringify({ type: 'ping' }));
		await Bun.sleep(10);
		expect(target.sent).toEqual([{ type: 'pong' }]);
	});
});
