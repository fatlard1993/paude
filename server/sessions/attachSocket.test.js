import { describe, expect, test } from 'bun:test';

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

	test('message types that name object internals are ignored rather than thrown on', () => {
		const target = socket();

		target.data.credential = 'stub';

		for (const type of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
			expect(() => attachSocket.message(target, JSON.stringify({ type }))).not.toThrow();
		}
	});
});
