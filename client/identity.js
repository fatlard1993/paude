import { roleAllows } from '../shared/roles';

// Who's using this page, from /api/auth: { owner: true }, or a guest's { owner: false, name, role, sessionId }
let current = null;

export const setIdentity = identity => {
	current = identity;
};

export const identity = () => current;

// What this server goes by (paude name), or null
let name = null;

export const setServerName = given => {
	name = given;
};

export const serverName = () => name;

// The same key the server keeps reactions and authorship under
export const identityKey = () => (current?.owner ? 'owner' : current?.inviteId && `invite:${current.inviteId}`);

const allows = action => Boolean(current) && roleAllows(current.owner ? 'owner' : current.role, action);

export const canType = () => allows('type');

export const canNote = () => allows('note');

export const canBrowse = () => allows('files');
