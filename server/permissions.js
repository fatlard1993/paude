export const ROLES = ['watch', 'comment', 'drive'];

const ROLE_ACTIONS = {
	watch: new Set(),
	comment: new Set(['note']),
	drive: new Set(['note', 'type']),
};

// What an identity may do in a session: 'type' (terminal input and size) or 'note' (chat, comments, replies).
// The owner may do everything, everywhere; a guest only in the session their invite names.
export const may = (identity, action, sessionId) => {
	if (!identity) return false;
	if (identity.owner) return true;
	if (identity.sessionId !== sessionId) return false;

	return ROLE_ACTIONS[identity.role]?.has(action) ?? false;
};

export const mayResolve = (identity, comment) =>
	Boolean(identity?.owner || (identity && comment.author === identity.name));

// The routes a guest can reach, all about their own session; anything else under /api is the owner's
export const guestMayRequest = (identity, method, pathname) => {
	const own = `/api/sessions/${identity.sessionId}`;

	return (
		(method === 'GET' && (pathname === '/api/auth' || pathname === own || pathname === `${own}/attach`)) ||
		(method === 'POST' && pathname === '/api/logout') ||
		(method === 'DELETE' && pathname === '/api/tokens/current')
	);
};
