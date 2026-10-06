import relativeTime from './relativeTime';

// Most recently active first; projects never used follow, alphabetically
export const byRecentActivity = (a, b) => (b.lastActivity ?? 0) - (a.lastActivity ?? 0) || a.name.localeCompare(b.name);

export const projectSummary = ({ sessionCount, lastActivity }) =>
	sessionCount
		? `${sessionCount} session${sessionCount === 1 ? '' : 's'} · ${relativeTime(lastActivity)}`
		: 'no sessions yet';
