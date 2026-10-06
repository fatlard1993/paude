import {
	checkPassword,
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
	revokeInvite,
	revokeToken,
} from '../auth';
import { ROLES, guestMayRequest } from '../permissions';
import requestMatch from '../utils/requestMatch';

const OPEN_ROUTES = new Set(['/api/auth', '/api/login', '/api/tokens', '/api/join']);
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

		return Response.json({ authenticated: Boolean(identity), passwordSet: passwordIsSet(), identity });
	}

	if (requestMatch('POST', '/api/login', request)) {
		const { password } = await request.json();
		const outcome = await checkPassword(request, password);

		if (outcome !== true) return refused(outcome);

		return new Response(null, { status: 204, headers: { 'Set-Cookie': loginCookie(await createLogin()) } });
	}

	// An invite link's token, traded for a login bound to that invite
	if (requestMatch('POST', '/api/join', request)) {
		const invite = inviteFromToken((await request.json()).token);

		if (!invite) return deadInvite();

		return Response.json(
			{ sessionId: invite.sessionId },
			{ headers: { 'Set-Cookie': loginCookie(await createLogin({ invite })) } },
		);
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

			return invite ? Response.json({ token: await createToken(device, { invite }) }) : deadInvite();
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
