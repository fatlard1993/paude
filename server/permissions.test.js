import { describe, expect, test } from 'bun:test';

import { guestMayRequest, may, mayResolve } from './permissions';

const owner = { owner: true, name: 'chase' };
const guest = role => ({ owner: false, name: 'ana', role, sessionId: 's1' });

describe('may', () => {
	test('roles grant typing and notes cumulatively', () => {
		expect([may(guest('watch'), 'note', 's1'), may(guest('watch'), 'type', 's1')]).toEqual([false, false]);
		expect([may(guest('comment'), 'note', 's1'), may(guest('comment'), 'type', 's1')]).toEqual([true, false]);
		expect([may(guest('drive'), 'note', 's1'), may(guest('drive'), 'type', 's1')]).toEqual([true, true]);
	});

	test('a guest has no say in any other session; the owner has it in all', () => {
		expect(may(guest('drive'), 'type', 's2')).toBe(false);
		expect(may(owner, 'type', 's2')).toBe(true);
		expect(may(null, 'note', 's1')).toBe(false);
	});
});

test('comments are resolved by their author or the owner', () => {
	expect(mayResolve(guest('comment'), { author: 'ana' })).toBe(true);
	expect(mayResolve(guest('comment'), { author: 'ben' })).toBe(false);
	expect(mayResolve(owner, { author: 'ben' })).toBe(true);
});

describe('guestMayRequest', () => {
	test('reaches only its own session', () => {
		const ana = guest('drive');

		expect(guestMayRequest(ana, 'GET', '/api/sessions/s1')).toBe(true);
		expect(guestMayRequest(ana, 'GET', '/api/sessions/s1/attach')).toBe(true);
		expect(guestMayRequest(ana, 'GET', '/api/sessions/s2/attach')).toBe(false);
		expect(guestMayRequest(ana, 'GET', '/api/projects')).toBe(false);
		expect(guestMayRequest(ana, 'GET', '/api/sessions')).toBe(false);
		expect(guestMayRequest(ana, 'POST', '/api/invites')).toBe(false);
	});
});
