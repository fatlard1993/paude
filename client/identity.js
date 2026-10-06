// Who's using this page, from /api/auth: { owner: true }, or a guest's { owner: false, name, role, sessionId }
let current = null;

export const setIdentity = identity => {
	current = identity;
};

export const identity = () => current;

// The same key the server keeps reactions and authorship under
export const identityKey = () => (current?.owner ? 'owner' : current?.inviteId && `invite:${current.inviteId}`);

export const canType = () => Boolean(current?.owner || current?.role === 'drive');

export const canBrowse = () => canNote();

export const canNote = () => Boolean(current?.owner || current?.role === 'drive' || current?.role === 'comment');
