import { roleAllows } from '../shared/roles';
import { identityKey } from './activity';

export { ROLES } from '../shared/roles';

// The owner may do everything, everywhere; a guest what their role allows, in the session their invite names
export const may = (identity, action, sessionId) => {
	if (!identity) return false;
	if (identity.owner) return true;
	if (identity.sessionId !== sessionId) return false;

	return roleAllows(identity.role, action);
};

// The author is who wrote it, not their name: two invites can carry the same one
export const mayResolve = (identity, comment) =>
	Boolean(
		identity?.owner ||
		(identity && (comment.authorId ? comment.authorId === identityKey(identity) : comment.author === identity.name)),
	);

// The routes a guest can reach, all about their own session; anything else under /api is the owner's. What their
// role allows within those is checked by the route itself.
const OWN_SESSION_ROUTES = ['/attach', '/files', '/file', '/search', '/raw'];

export const guestMayRequest = (identity, method, pathname) => {
	const own = `/api/sessions/${identity.sessionId}`;

	return (
		(method === 'GET' &&
			(pathname === '/api/auth' || pathname === own || OWN_SESSION_ROUTES.some(route => pathname === own + route))) ||
		(method === 'GET' && pathname === '/api/watching') ||
		(method === 'POST' && pathname === '/api/handoff') ||
		(method === 'PUT' && pathname === `${own}/watch`) ||
		(method === 'POST' && pathname === '/api/logout') ||
		(method === 'DELETE' && pathname === '/api/tokens/current')
	);
};
