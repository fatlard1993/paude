import { roleAllows } from '../shared/roles';
import { identityKey } from './activity';

export { ROLES } from '../shared/roles';

// Whether a session is theirs: every session is the owner's; a guest's is the one their invite names, or, for a game
// maker (an invite to make arcade games of their own), each game they've made
export const ownsSession = (identity, sessionId) =>
	Boolean(
		identity &&
		(identity.owner || (identity.maker ? identity.sessionIds.includes(sessionId) : identity.sessionId === sessionId)),
	);

// The owner may do everything, everywhere; a guest what their role allows, in a session of theirs
export const may = (identity, action, sessionId) => {
	if (!identity) return false;
	if (identity.owner) return true;
	if (!ownsSession(identity, sessionId)) return false;

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
	'/arcade',
	'/artifacts',
	'/artifact',
	'/shell',
	'/files',
	'/file',
	'/search',
	'/raw',
	'/changes',
	'/diffs',
	'/turn-changes',
	'/timeline',
	'/verification',
	'/feed',
	'/symbols',
	'/links',
	'/decisions',
];

// What a guest sends to their session: an answer to what Claude asks, a prompt, a line to say and a recording to hear
// (the arcade's), the game put back, and carrying on after a limit; each route checks the role allows it
const OWN_SESSION_POSTS = ['/answer', '/prompt', '/speech', '/hear', '/arcade/undo', '/continue'];

// A game maker reaches what a guest of each of their games would, and makes new games and lists theirs. Not the
// universe: it's scoped to one session, and theirs are many.
export const guestMayRequest = (identity, method, pathname) => {
	if (!identity.maker) return sessionGuestMayRequest(identity, method, pathname);

	if (method === 'POST' && pathname === '/api/arcade') return true;
	if (method === 'GET' && pathname === '/api/arcade/mine') return true;
	if (pathname.startsWith('/api/universe') || pathname.startsWith('/api/projects/')) return false;

	const named = /^\/api\/sessions\/([^/]+)/.exec(pathname)?.[1];
	const sessionId = named && identity.sessionIds.includes(decodeURIComponent(named)) ? decodeURIComponent(named) : null;

	return sessionGuestMayRequest({ ...identity, sessionId }, method, pathname);
};

const sessionGuestMayRequest = (identity, method, pathname) => {
	const own = `/api/sessions/${identity.sessionId}`;

	return (
		(method === 'GET' &&
			(pathname === '/api/auth' || pathname === own || OWN_SESSION_ROUTES.some(route => pathname === own + route))) ||
		(method === 'POST' && OWN_SESSION_POSTS.some(route => pathname === own + route)) ||
		// The Git panel's reads and actions; the route checks which the role allows
		(['GET', 'POST'].includes(method) && pathname.startsWith(`${own}/git/`)) ||
		// Its tasks and processes; the route checks who may start or stop them
		(['GET', 'POST'].includes(method) &&
			(pathname.startsWith(`${own}/tasks`) || pathname.startsWith(`${own}/processes/`))) ||
		// What the session shares; the route checks who may add or stop one
		(['GET', 'POST', 'PATCH', 'DELETE'].includes(method) &&
			(pathname === `${own}/shares` || pathname.startsWith(`${own}/shares/`))) ||
		(method === 'GET' && pathname === '/api/watching') ||
		// The universe, scoped to their session and its project there; the icon route checks the project is theirs
		(method === 'GET' && (pathname === '/api/universe' || /^\/api\/projects\/[^/]+\/icon$/.test(pathname))) ||
		(method === 'POST' && pathname === '/api/handoff') ||
		(method === 'POST' && pathname === `${own}/replace`) ||
		// Making, moving and deleting files; the route checks the role may edit
		(method === 'POST' && (pathname === `${own}/files` || pathname.startsWith(`${own}/files/`))) ||
		(method === 'PUT' && pathname === `${own}/files/upload`) ||
		// Tours: catching up on the session, and walking through its code
		(method === 'POST' && (pathname === `${own}/catch-up` || pathname === `${own}/tour`)) ||
		(method === 'POST' && pathname === `${own}/links/mark`) ||
		(method === 'POST' && pathname === `${own}/decisions/dismiss`) ||
		(method === 'GET' && pathname === `${own}/environment`) ||
		(method === 'PUT' && [`${own}/watch`, `${own}/seen`, `${own}/file`].includes(pathname)) ||
		(method === 'POST' && pathname === '/api/logout') ||
		(method === 'DELETE' && pathname === '/api/tokens/current')
	);
};
