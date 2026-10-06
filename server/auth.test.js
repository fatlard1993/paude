import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, setDefaultTimeout, test } from 'bun:test';

import {
	checkPassword,
	createLogin,
	createToken,
	endLogin,
	createInvite,
	credentialOf,
	credentialValid,
	identityOf,
	initAuth,
	inviteFromToken,
	isAuthenticated,
	passwordIsSet,
	loginCookie,
	revokeInvite,
	revokeToken,
	setPassword,
	createHandoff,
	redeemHandoff,
	ensureLocalToken,
} from './auth';
import { guard } from './router/auth';

// The lockout tests run several real argon2 checks each, which a busy machine takes longer than the default over
setDefaultTimeout(20_000);

const PASSWORD = 'correct horse battery';

const request = ({ cookie, bearer, address = '203.0.113.1', url = 'http://paude.test/api/projects' } = {}) => {
	const headers = {
		'x-forwarded-for': address,
		...(cookie && { cookie: `other=1; paude_login=${cookie}` }),
		...(bearer && { authorization: `Bearer ${bearer}` }),
	};

	return { url, method: 'GET', headers: { get: name => headers[name.toLowerCase()] ?? null } };
};

let dataDir;

beforeEach(async () => {
	dataDir = await mkdtemp(path.join(os.tmpdir(), 'paude-auth-'));
	await initAuth(dataDir);
	await setPassword(PASSWORD);
});

describe('passwords', () => {
	test('accepts the right one and refuses others', async () => {
		expect(passwordIsSet()).toBe(true);
		expect(await checkPassword(request({ address: 'a' }), PASSWORD)).toBe(true);
		expect(await checkPassword(request({ address: 'a' }), 'nope')).toBe(false);
		expect(await checkPassword(request({ address: 'a' }), undefined)).toBe(false);
	});

	test('locks an address out after five misses, even for the right password', async () => {
		const from = request({ address: 'locked' });

		for (let attempt = 0; attempt < 5; attempt++) await checkPassword(from, 'nope');

		expect(await checkPassword(from, PASSWORD)).toBeGreaterThan(0);
		expect(await checkPassword(request({ address: 'someone else' }), PASSWORD)).toBe(true);
	});

	test('a burst of parallel guesses gets two checks at most; the rest are told to wait', async () => {
		const from = request({ address: 'burst' });
		const outcomes = await Promise.all(Array.from({ length: 12 }, () => checkPassword(from, 'nope')));

		expect(outcomes.filter(outcome => outcome === false)).toHaveLength(2);
		expect(outcomes.filter(outcome => typeof outcome === 'number')).toHaveLength(10);
	});

	test('guesses checked in parallel each count, so pairs still reach the lockout', async () => {
		const from = request({ address: 'pairs' });

		for (let round = 0; round < 3; round++)
			await Promise.all([checkPassword(from, 'nope'), checkPassword(from, 'nope')]);

		expect(await checkPassword(from, PASSWORD)).toBeGreaterThan(0);
	});

	test('IPv6 addresses in one /64 share a lockout', async () => {
		for (let attempt = 0; attempt < 5; attempt++)
			await checkPassword(request({ address: `2001:db8:1:2::${attempt}` }), 'nope');

		expect(await checkPassword(request({ address: '2001:db8:1:2::ffff' }), PASSWORD)).toBeGreaterThan(0);
	});

	test('the hash on disk is not the password', async () => {
		const stored = await Bun.file(path.join(dataDir, 'auth.json')).text();

		expect(stored).not.toContain(PASSWORD);
	});
});

describe('logins', () => {
	test('a session cookie authenticates until it is ended', async () => {
		const token = await createLogin();

		expect(isAuthenticated(request({ cookie: token }))).toBe(true);
		expect(isAuthenticated(request({ cookie: `${token}x` }))).toBe(false);
		expect(isAuthenticated(request())).toBe(false);

		await endLogin(request({ cookie: token }));

		expect(isAuthenticated(request({ cookie: token }))).toBe(false);
	});

	test('sessions survive a restart', async () => {
		const token = await createLogin();

		await initAuth(dataDir);

		expect(isAuthenticated(request({ cookie: token }))).toBe(true);
	});

	test('a bearer token authenticates, and is stored only as a hash', async () => {
		const token = await createToken('laptop');

		expect(isAuthenticated(request({ bearer: token }))).toBe(true);
		expect(isAuthenticated(request({ bearer: 'guess' }))).toBe(false);
		expect(await Bun.file(path.join(dataDir, 'auth.json')).text()).not.toContain(token);
	});

	test('a new password signs everything out', async () => {
		const cookie = await createLogin();
		const bearer = await createToken('laptop');

		await setPassword('another long password');

		expect(isAuthenticated(request({ cookie }))).toBe(false);
		expect(isAuthenticated(request({ bearer }))).toBe(false);
	});

	test('a password set by another process signs this one out', async () => {
		await initAuth(dataDir, { watchForChanges: true });

		const cookie = await createLogin();
		const outsider = {
			...(await Bun.file(path.join(dataDir, 'auth.json')).json()),
			passwordHash: await Bun.password.hash('a different password'),
			logins: [],
			tokens: [],
		};

		await Bun.write(path.join(dataDir, 'auth.json'), JSON.stringify(outsider));
		await Bun.sleep(300);

		expect(isAuthenticated(request({ cookie }))).toBe(false);
		expect(await checkPassword(request({ address: 'fresh' }), PASSWORD)).toBe(false);
	});

	test('a credential kept from earlier stops being valid once its login ends or its token is revoked', async () => {
		const cookie = await createLogin();
		const bearer = await createToken('laptop');
		const fromLogin = credentialOf(request({ cookie }));
		const fromToken = credentialOf(request({ bearer }));

		await endLogin(request({ cookie }));
		expect(await revokeToken(request({ bearer }))).toBe(true);

		expect(credentialValid(fromLogin)).toBe(false);
		expect(credentialValid(fromToken)).toBe(false);
		expect(credentialValid(null)).toBe(false);
	});

	test('the cookie is locked down', () => {
		expect(loginCookie('abc')).toContain('HttpOnly; Secure; SameSite=Strict');
		expect(loginCookie('', { clear: true })).toContain('Max-Age=0');
	});
});

describe('guard', () => {
	test('refuses the API without a login, including the terminal socket', () => {
		expect(guard(request())?.status).toBe(401);
		expect(guard(request({ url: 'http://paude.test/api/sessions/abc/attach' }))?.status).toBe(401);
	});

	test('lets through the login routes and the page itself', () => {
		for (const url of [
			'http://paude.test/api/auth',
			'http://paude.test/api/login',
			'http://paude.test/api/tokens',
			'http://paude.test/',
		]) {
			expect(guard(request({ url }))).toBeNull();
		}
	});

	test('lets a logged-in request through', async () => {
		expect(guard(request({ cookie: await createLogin() }))).toBeNull();
	});
});

describe('invites', () => {
	test('a joined invite is a guest with its own name, role and session', async () => {
		const { token } = await createInvite({ sessionId: 's1', name: 'ana', role: 'comment', hours: 24 });
		const invite = inviteFromToken(token);
		const cookie = await createLogin({ invite });

		expect(identityOf(credentialOf(request({ cookie })))).toMatchObject({
			owner: false,
			name: 'ana',
			role: 'comment',
			sessionId: 's1',
		});
		expect(identityOf(credentialOf(request({ cookie: await createLogin() })))).toEqual({ owner: true });
		expect(inviteFromToken('not-a-real-token')).toBeUndefined();
	});

	test('revoking an invite ends its logins and terminal tokens but leaves other logins alone', async () => {
		const { invite, token } = await createInvite({ sessionId: 's1', name: 'ana', role: 'drive', hours: 1 });
		const cookie = await createLogin({ invite: inviteFromToken(token) });
		const bearer = await createToken('ana-laptop', { invite });
		const ownerCookie = await createLogin();

		await revokeInvite(invite.id);

		expect(isAuthenticated(request({ cookie }))).toBe(false);
		expect(isAuthenticated(request({ bearer }))).toBe(false);
		expect(isAuthenticated(request({ cookie: ownerCookie }))).toBe(true);
		expect(inviteFromToken(token)).toBeUndefined();
	});

	test('an expired invite stops working', async () => {
		const { invite, token } = await createInvite({ sessionId: 's1', name: 'ana', role: 'watch', hours: 1 });
		const cookie = await createLogin({ invite });

		invite.expires = Date.now() - 1;

		expect(isAuthenticated(request({ cookie }))).toBe(false);
		expect(inviteFromToken(token)).toBeUndefined();
	});

	test('the guard keeps a guest inside their own session', async () => {
		const { invite } = await createInvite({ sessionId: 's1', name: 'ana', role: 'drive', hours: 1 });
		const cookie = await createLogin({ invite });

		expect(guard(request({ cookie, url: 'http://paude.test/api/sessions/s1/attach' }))).toBeNull();
		expect(guard(request({ cookie, url: 'http://paude.test/api/sessions/s2/attach' }))?.status).toBe(403);
		expect(guard(request({ cookie, url: 'http://paude.test/api/projects' }))?.status).toBe(403);
	});

	test('a new password revokes every invite too', async () => {
		const { token } = await createInvite({ sessionId: 's1', name: 'ana', role: 'drive', hours: 1 });

		await setPassword('another long password');

		expect(inviteFromToken(token)).toBeUndefined();
	});
});

describe('handoff and the local token', () => {
	test("a guest's code logs in as that guest; an owner's carries whether it came from this machine", async () => {
		const { invite } = await createInvite({ sessionId: 's1', name: 'Sam', role: 'comment', hours: 1 });
		const guest = await redeemHandoff(createHandoff({ owner: false, inviteId: invite.id }));

		expect(identityOf(credentialOf(request({ cookie: guest })))).toMatchObject({ owner: false, inviteId: invite.id });

		const remote = await redeemHandoff(createHandoff({ owner: true }));
		const local = await redeemHandoff(createHandoff({ owner: true, local: true }));

		expect(identityOf(credentialOf(request({ cookie: remote })))).toEqual({ owner: true });
		expect(identityOf(credentialOf(request({ cookie: local })))).toEqual({ owner: true, local: true });
	});

	test('a code works once, and not after its invite is revoked', async () => {
		const code = createHandoff({ owner: true });

		expect(await redeemHandoff(code)).toBeTruthy();
		expect(await redeemHandoff(code)).toBeNull();

		const { invite } = await createInvite({ sessionId: 's1', name: 'Sam', role: 'comment', hours: 1 });
		const guestCode = createHandoff({ owner: false, inviteId: invite.id });

		await revokeInvite(invite.id);
		expect(await redeemHandoff(guestCode)).toBeNull();
	});

	test("this machine's token survives a new password; other logins don't", async () => {
		await ensureLocalToken(dataDir);

		const local = (await Bun.file(path.join(dataDir, 'local-token')).text()).trim();
		const other = await createToken('laptop');

		await setPassword('another password');
		expect(identityOf(credentialOf(request({ bearer: local })))).toEqual({ owner: true, local: true });
		expect(credentialOf(request({ bearer: other }))).toBeNull();
	});
});
