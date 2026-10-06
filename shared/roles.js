export const ROLES = ['watch', 'comment', 'drive'];

// 'type' is terminal input and size; 'note' is chat, comments and replies; 'files' is browsing the project
const ROLE_ACTIONS = {
	watch: new Set(),
	comment: new Set(['note', 'files']),
	drive: new Set(['note', 'files', 'type']),
};

// What a role may do; the owner may do everything
export const roleAllows = (role, action) => role === 'owner' || (ROLE_ACTIONS[role]?.has(action) ?? false);
