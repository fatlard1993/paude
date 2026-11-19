// An invite's role, by what it hands someone: one surface and nothing else (`try`, `play`), or a way into the session
// itself, each of those holding the one before it (`watch`, `comment`, `drive`). The ids are what's stored and what
// other paudes read; the names are what people see.
export const ROLES = ['try', 'play', 'watch', 'comment', 'drive'];

// 'output' is the page the session serves and what it shares; 'screen' is its terminal as it runs, read, and its ship
// in the universe; 'talk' is prompting and answering Claude in words (the arcade's); 'note' is chat, comments and
// replies; 'files' is reading the project (its files, git, what it made, its record, its tasks); 'type' is acting in
// it: terminal input and size, a shell, editing files, git's actions, tasks and shares
const ROLE_ACTIONS = {
	try: new Set(['output']),
	play: new Set(['output', 'screen', 'talk']),
	watch: new Set(['output', 'screen']),
	comment: new Set(['output', 'screen', 'note', 'files']),
	drive: new Set(['output', 'screen', 'talk', 'note', 'files', 'type']),
};

// Each role as the People panel offers it: its name, what it opens, and the family it's in
export const ROLE_INFO = {
	try: { name: 'Try it', opens: 'the app the session serves, and what it shares; no terminal, no files', only: true },
	play: { name: 'Play', opens: 'the arcade: the game, and talking with Claude in big type, read aloud', only: true },
	watch: { name: 'Look in', opens: 'the terminal live, read only, and the session aboard its ship' },
	comment: { name: 'Review', opens: 'and chat and comment, and read its files, git, what it made and its record' },
	drive: {
		name: 'Pair',
		opens: 'and type to Claude, use a shell, edit files, commit and push, run tasks and share',
		warns: true,
	},
};

export const roleName = role => ROLE_INFO[role]?.name ?? role;

// What a role may do; the owner may do everything
export const roleAllows = (role, action) => role === 'owner' || (ROLE_ACTIONS[role]?.has(action) ?? false);
