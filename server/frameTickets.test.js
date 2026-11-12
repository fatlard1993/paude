import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeEach, describe, expect, test } from 'bun:test';

import { createLogin, createToken, credentialOf, endLogin, initAuth, revokeToken, setPassword } from './auth';
import { FRAME_TICKET, clearFrameTickets, frameGrant, issueFrameTicket, redeemFrameTicket } from './frameTickets';
import { previewFetch } from './preview';
import sharesRoutes from './router/shares';
import { addShare, initShares } from './shares';

// The app a share shows: it says what it was asked for, and whether any of paude's cookies or its ticket reached it
const app = Bun.serve({
	port: 0,
	hostname: '127.0.0.1',
	fetch: request => {
		const url = new URL(request.url);

		return new Response(`app:${url.pathname}${url.search}|${request.headers.get('cookie') ?? ''}`);
	},
});

afterAll(() => app.stop(true));

const SESSION = 'frame-session';
let share;
let owner;

const bearer = token => ({ authorization: `Bearer ${token}` });
const cookieOf = response => response.headers.get('set-cookie')?.split(';')[0];

beforeEach(async () => {
	const dataDir = await mkdtemp(path.join(os.tmpdir(), 'paude-frame-'));

	await initAuth(dataDir);
	await setPassword('correct horse battery');
	await initShares(dataDir);
	clearFrameTickets();
	share = await addShare(SESSION, { kind: 'port', port: app.port });
	// The other paude's login here, as `paude login` gives it
	owner = await createToken('dellbook');
});

const askFrame = (token, name = share.name, session = SESSION) =>
	sharesRoutes(
		new Request(`http://paude.test/api/sessions/${session}/shares/${name}/frame`, { method: 'POST', headers: bearer(token) }),
	);

// The frame's request to the preview, at the path its address names, with whatever cookies the frame has
const preview = (where, cookie) =>
	previewFetch(new Request(new URL(where, 'https://preview.test'), { headers: cookie ? { cookie } : {} }), {});

const ticketAddress = async () => {
	const { url } = await (await askFrame(owner)).json();
	const address = new URL(url);

	return `${address.pathname}${address.search}`;
};

describe('tickets', () => {
	test('one use, for the share it was given for', async () => {
		const [login] = [await createLogin()];
		const credential = credentialOf(new Request('http://x', { headers: { cookie: `paude_login=${login}` } }));
		const ticket = issueFrameTicket('game', credential);

		expect(redeemFrameTicket(ticket, 'other')).toBeNull();

		const again = issueFrameTicket('game', credential);
		const granted = redeemFrameTicket(again, 'game');

		expect(granted.grant).toBeString();
		expect(frameGrant(granted.grant)).toMatchObject({ shareName: 'game', credential });
		expect(redeemFrameTicket(again, 'game')).toBeNull();
		expect(frameGrant('made-up')).toBeNull();
	});

	test("a grant ends with the login that asked for it", async () => {
		const login = await createLogin();
		const request = new Request('http://x', { headers: { cookie: `paude_login=${login}` } });
		const granted = redeemFrameTicket(issueFrameTicket('game', credentialOf(request)), 'game');

		expect(frameGrant(granted.grant)).not.toBeNull();
		await endLogin(request);
		expect(frameGrant(granted.grant)).toBeNull();
	});
});

describe('a share framed on another paude', () => {
	test('is asked for by someone who can see the session, and only for its own shares', async () => {
		const asked = await askFrame(owner);
		const { url } = await asked.json();

		expect(asked.status).toBe(200);
		expect(url).toContain(`/s/${share.name}/?${FRAME_TICKET}=`);
		expect((await askFrame(owner, 'not-a-share')).status).toBe(404);
		expect((await askFrame('not-a-token')).status).toBe(403);
	});

	test('opens with its ticket: a frame cookie, then the app, without paude cookies or the ticket reaching it', async () => {
		const opened = await preview(await ticketAddress());

		expect(opened.status).toBe(302);
		expect(opened.headers.get('location')).toBe(`/s/${share.name}/`);

		const set = opened.headers.get('set-cookie');

		expect(set).toContain('SameSite=None');
		expect(set).toContain('Secure');
		expect(set).toContain('Partitioned');
		expect(set).toContain('HttpOnly');

		const cookie = cookieOf(opened);
		const page = await preview(`/s/${share.name}/`, cookie);
		const body = await page.text();

		expect(page.status).toBe(200);
		expect(body.startsWith('app:/|')).toBe(true);
		expect(body).not.toContain('paude-frame');
	});

	test('routes what it asks for that names no share (its socket, its assets) by its frame cookie', async () => {
		const cookie = cookieOf(await preview(await ticketAddress()));
		const asset = await preview('/assets/game.js', cookie);

		expect(asset.status).toBe(200);
		expect((await asset.text()).startsWith('app:/assets/game.js|')).toBe(true);
	});

	test('a ticket used once is spent, and without one or a cookie the frame is turned away', async () => {
		const address = await ticketAddress();

		await preview(address);
		expect((await preview(address)).status).toBe(401);
		expect((await preview(`/s/${share.name}/`)).status).toBe(401);
		expect((await preview(`/s/${share.name}/`, `paude-frame-${share.name}=forged`)).status).toBe(401);
	});

	test("a frame cookie lets in only its own share", async () => {
		const other = await addShare('another-session', { kind: 'port', port: app.port });
		const cookie = cookieOf(await preview(await ticketAddress()));
		const renamed = cookie.replace(`paude-frame-${share.name}=`, `paude-frame-${other.name}=`);

		expect((await preview(`/s/${other.name}/`, renamed)).status).toBe(401);
	});

	test('stops letting the frame in once the login that asked is revoked', async () => {
		const cookie = cookieOf(await preview(await ticketAddress()));

		expect((await preview(`/s/${share.name}/`, cookie)).status).toBe(200);
		await revokeToken(new Request('http://x', { headers: bearer(owner) }));
		expect((await preview(`/s/${share.name}/`, cookie)).status).toBe(401);
	});
});
