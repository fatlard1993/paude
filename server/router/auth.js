import { watchIfNew } from '../activity';
import { mayListRemotes, serverName } from '../serverSettings';
import {
	checkPassword,
	createHandoff,
	getServerId,
	createInvite,
	createLogin,
	createToken,
	credentialOf,
	endLogin,
	identityOf,
	inviteFromToken,
	listInvites,
	loginCookie,
	passwordIsSet,
	redeemHandoff,
	revokeInvite,
	revokeToken,
	setPassword,
} from '../auth';
import { ROLES, guestMayRequest } from '../permissions';
import requestMatch from '../utils/requestMatch';

const OPEN_ROUTES = new Set(['/api/auth', '/api/login', '/api/tokens', '/api/join', '/api/handoff/redeem']);
const INVITE_HOURS = [1, 24, 24 * 7];

const refused = outcome =>
	typeof outcome === 'number'
		? new Response('Too many tries', { status: 429, headers: { 'Retry-After': String(outcome) } })
		: new Response('Wrong password', { status: 401 });

const deadInvite = () => new Response('That invite has expired or was revoked', { status: 410 });

export const guard = request => {
	const { pathname } = new URL(request.url);

	if (!pathname.startsWith('/api/') || OPEN_ROUTES.has(pathname)) return null;

	const identity = identityOf(credentialOf(request));

	if (!identity) return new Response('Login required', { status: 401 });
	if (!identity.owner && !guestMayRequest(identity, request.method, pathname)) {
		return new Response('Not part of your invite', { status: 403 });
	}

	return null;
};

const authRoutes = async request => {
	let match;

	if (requestMatch('GET', '/api/auth', request)) {
		const identity = identityOf(credentialOf(request));

		return Response.json({
			authenticated: Boolean(identity),
			passwordSet: passwordIsSet(),
			identity: identity && { ...identity, ...((await mayListRemotes(identity)) && { remotes: true }) },
			serverId: getServerId(),
			name: await serverName(),
		});
	}

	if (requestMatch('POST', '/api/login', request)) {
		const { password } = await request.json();
		const outcome = await checkPassword(request, password);

		if (outcome !== true) return refused(outcome);

		return new Response(null, { status: 204, headers: { 'Set-Cookie': loginCookie(await createLogin()) } });
	}

	if (requestMatch('POST', '/api/join', request)) {
		const invite = inviteFromToken((await request.json()).token);

		if (!invite) return deadInvite();

		await watchIfNew({ owner: false, inviteId: invite.id }, invite.sessionId);

		return Response.json(
			{ sessionId: invite.sessionId },
			{ headers: { 'Set-Cookie': loginCookie(await createLogin({ invite })) } },
		);
	}

	// A one-time code a logged-in client trades for a browser login: paude web, or another paude opening a session here
	if (requestMatch('POST', '/api/handoff', request)) {
		return Response.json({ code: createHandoff(identityOf(credentialOf(request))) });
	}

	if (requestMatch('POST', '/api/handoff/redeem', request)) {
		const login = await redeemHandoff((await request.json()).code);

		if (!login) return new Response('That link has expired', { status: 410 });

		return new Response(null, { status: 204, headers: { 'Set-Cookie': loginCookie(login) } });
	}

	// set-password, while this server runs: from this machine's own token only
	if (requestMatch('PUT', '/api/password', request)) {
		if (!identityOf(credentialOf(request))?.local) return new Response('Only from this machine', { status: 403 });

		await setPassword((await request.json()).password);

		return new Response(null, { status: 204 });
	}

	if (requestMatch('POST', '/api/logout', request)) {
		await endLogin(request);

		return new Response(null, { status: 204, headers: { 'Set-Cookie': loginCookie('', { clear: true }) } });
	}

	// The terminal client trades the password, or an invite's token, for a long-lived token it sends as a bearer
	if (requestMatch('POST', '/api/tokens', request)) {
		const { password, invite: inviteToken, name } = await request.json();
		const device = String(name || 'terminal').slice(0, 60);

		if (inviteToken !== undefined) {
			const invite = inviteFromToken(inviteToken);

			if (!invite) return deadInvite();

			await watchIfNew({ owner: false, inviteId: invite.id }, invite.sessionId);

			return Response.json({ token: await createToken(device, { invite }) });
		}

		const outcome = await checkPassword(request, password);

		if (outcome !== true) return refused(outcome);

		return Response.json({ token: await createToken(device) });
	}

	if (requestMatch('DELETE', '/api/tokens/current', request)) {
		return new Response(null, { status: (await revokeToken(request)) ? 204 : 404 });
	}

	match = requestMatch('GET', '/api/sessions/:id/invites', request);
	if (match) return Response.json(listInvites(match.id));

	match = requestMatch('POST', '/api/sessions/:id/invites', request);
	if (match) {
		const { name, role, hours } = await request.json();
		const cleanName = String(name ?? '')
			.trim()
			.slice(0, 40);

		if (!cleanName) return new Response('An invite needs a name', { status: 400 });
		if (!ROLES.includes(role)) return new Response(`Role must be one of ${ROLES.join(', ')}`, { status: 400 });
		if (!INVITE_HOURS.includes(hours))
			return new Response(`Expiry must be ${INVITE_HOURS.join(', ')} hours`, { status: 400 });

		const { invite, token } = await createInvite({ sessionId: match.id, name: cleanName, role, hours });

		return Response.json({ id: invite.id, name: invite.name, role, expires: invite.expires, token });
	}

	match = requestMatch('DELETE', '/api/invites/:id', request);
	if (match) return new Response(null, { status: (await revokeInvite(match.id)) ? 204 : 404 });

	return null;
};

export default authRoutes;
