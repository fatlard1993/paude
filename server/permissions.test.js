import { describe, expect, test } from 'bun:test';

import { guestMayRequest, may, mayManage, ownsSession } from './permissions';

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
	expect(mayManage(guest('comment'), { author: 'ana' })).toBe(true);
	expect(mayManage(guest('comment'), { author: 'ben' })).toBe(false);
	expect(mayManage(owner, { author: 'ben' })).toBe(true);
});

describe('guestMayRequest', () => {
	test('takes the tours of its own session: catching up, and walking through code', () => {
		const ana = guest('comment');

		expect(guestMayRequest(ana, 'POST', '/api/sessions/s1/catch-up')).toBe(true);
		// The arcade's: what a guest answers, says and hears in their session, and the game put back
		for (const route of ['/answer', '/prompt', '/speech', '/hear', '/arcade/undo'])
			expect(guestMayRequest(ana, 'POST', `/api/sessions/s1${route}`)).toBe(true);
		expect(guestMayRequest(ana, 'GET', '/api/sessions/s1/arcade')).toBe(true);
		expect(guestMayRequest(ana, 'POST', '/api/sessions/s2/answer')).toBe(false);
		expect(guestMayRequest(ana, 'POST', '/api/sessions/s1/arcade/host')).toBe(false);
		expect(guestMayRequest(ana, 'POST', '/api/sessions/s1/tour')).toBe(true);
		expect(guestMayRequest(ana, 'POST', '/api/sessions/s2/tour')).toBe(false);
	});

	test('reaches only its own session', () => {
		const ana = guest('drive');

		expect(guestMayRequest(ana, 'GET', '/api/sessions/s1')).toBe(true);
		expect(guestMayRequest(ana, 'GET', '/api/sessions/s1/attach')).toBe(true);
		expect(guestMayRequest(ana, 'GET', '/api/sessions/s2/attach')).toBe(false);
		expect(guestMayRequest(ana, 'GET', '/api/sessions/s1/file')).toBe(true);
		expect(guestMayRequest(ana, 'GET', '/api/sessions/s2/files')).toBe(false);
		expect(guestMayRequest(ana, 'GET', '/api/projects')).toBe(false);
		expect(guestMayRequest(ana, 'GET', '/api/sessions')).toBe(false);
		expect(guestMayRequest(ana, 'POST', '/api/invites')).toBe(false);
	});
});

test('a comment is resolvable by whoever wrote it, not by someone sharing their name', async () => {
	const { mayManage } = await import('./permissions');
	const sam = { owner: false, inviteId: 'a', name: 'Sam', role: 'comment', sessionId: 's' };
	const otherSam = { owner: false, inviteId: 'b', name: 'Sam', role: 'comment', sessionId: 's' };
	const comment = { author: 'Sam', authorId: 'invite:a' };

	expect(mayManage(sam, comment)).toBe(true);
	expect(mayManage(otherSam, comment)).toBe(false);
	expect(mayManage({ owner: true }, comment)).toBe(true);
});

test('files are part of comment and drive, not view', async () => {
	const { may } = await import('./permissions');

	expect(may({ owner: false, role: 'comment', sessionId: 's' }, 'files', 's')).toBe(true);
	expect(may({ owner: false, role: 'watch', sessionId: 's' }, 'files', 's')).toBe(false);
});

describe('a game maker', () => {
	const ben = {
		owner: false,
		maker: true,
		name: 'Ben',
		role: 'drive',
		view: 'arcade',
		sessionId: null,
		sessionIds: ['g1', 'g2'],
	};

	test('drives every game they made, and no other session', () => {
		expect([may(ben, 'type', 'g1'), may(ben, 'type', 'g2'), may(ben, 'type', 's9')]).toEqual([true, true, false]);
		expect([ownsSession(ben, 'g2'), ownsSession(ben, 's9'), ownsSession(null, 'g1')]).toEqual([true, false, false]);
	});

	test("reaches each of their games as that game's guest would, makes new games, lists theirs, and nothing else", () => {
		expect(guestMayRequest(ben, 'GET', '/api/sessions/g1/arcade')).toBe(true);
		expect(guestMayRequest(ben, 'POST', '/api/sessions/g2/answer')).toBe(true);
		expect(guestMayRequest(ben, 'GET', '/api/sessions/s9/arcade')).toBe(false);
		expect(guestMayRequest(ben, 'POST', '/api/sessions/s9/prompt')).toBe(false);
		expect(guestMayRequest(ben, 'POST', '/api/arcade')).toBe(true);
		expect(guestMayRequest(ben, 'GET', '/api/arcade/mine')).toBe(true);
		expect(guestMayRequest(ben, 'GET', '/api/universe')).toBe(false);
		expect(guestMayRequest(ben, 'GET', '/api/projects')).toBe(false);
		expect(guestMayRequest(ben, 'POST', '/api/makers')).toBe(false);
	});

	test("an ordinary guest still can't make games", () => {
		expect(guestMayRequest(guest('drive'), 'POST', '/api/arcade')).toBe(false);
		expect(guestMayRequest(guest('drive'), 'GET', '/api/arcade/mine')).toBe(false);
	});
});
