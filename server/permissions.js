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

// Resolving or deleting a comment is its author's, or the owner's. The author is who wrote it, not their name: two
// invites can carry the same one.
export const mayManage = (identity, comment) =>
	Boolean(
		identity?.owner ||
		(identity && (comment.authorId ? comment.authorId === identityKey(identity) : comment.author === identity.name)),
	);

// The routes a guest can reach, all about their own session; anything else under /api is the owner's. What their
// role allows within those is checked by the route itself.
const OWN_SESSION_ROUTES = [
	'/attach',
	'/asking',
	'/answer',
	'/continue',
	'/catch-up',
	'/shell',
	'/files',
	'/file',
	'/search',
	'/raw',
	'/changes',
	'/diffs',
	'/turn-changes',
	'/timeline',
	'/symbols',
	'/links',
];

export const guestMayRequest = (identity, method, pathname) => {
	const own = `/api/sessions/${identity.sessionId}`;

	return (
		(method === 'GET' &&
			(pathname === '/api/auth' || pathname === own || OWN_SESSION_ROUTES.some(route => pathname === own + route))) ||
		// The Git panel's reads and actions; the route checks which the role allows
		(['GET', 'POST'].includes(method) && pathname.startsWith(`${own}/git/`)) ||
		// Its tasks and processes; the route checks who may start or stop them
		(['GET', 'POST'].includes(method) &&
			(pathname.startsWith(`${own}/tasks`) || pathname.startsWith(`${own}/processes/`))) ||
		// What the session shares; the route checks who may add or stop one
		(['GET', 'POST', 'PATCH', 'DELETE'].includes(method) &&
			(pathname === `${own}/shares` || pathname.startsWith(`${own}/shares/`))) ||
		(method === 'GET' && pathname === '/api/watching') ||
		(method === 'POST' && pathname === '/api/handoff') ||
		(method === 'POST' && pathname === `${own}/replace`) ||
		(method === 'POST' && pathname === `${own}/links/mark`) ||
		(method === 'GET' && pathname === `${own}/environment`) ||
		(method === 'PUT' && (pathname === `${own}/watch` || pathname === `${own}/file`)) ||
		(method === 'POST' && pathname === '/api/logout') ||
		(method === 'DELETE' && pathname === '/api/tokens/current')
	);
};
