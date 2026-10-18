import relativeTime from './relativeTime';

// Watched ones first, then most recently active; projects never used follow, alphabetically
export const byWatchedThenRecent = (a, b) =>
	Boolean(b.watching) - Boolean(a.watching) ||
	(b.lastActivity ?? 0) - (a.lastActivity ?? 0) ||
	a.name.localeCompare(b.name);

// A project emptied out still shows when it was last active
export const projectSummary = ({ sessionCount, lastActivity }) =>
	[sessionCount ? `${sessionCount} session${sessionCount === 1 ? '' : 's'}` : 'no sessions', relativeTime(lastActivity)]
		.filter(Boolean)
		.join(' · ');
