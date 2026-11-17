// What's worth telling a watcher since the last check: a session that started waiting on someone, or has news.
// `previous` maps keyOf(session) to how it was (see lookedAt); the one on screen never alerts. News from a session
// still waiting on what it left running in the background waits too: Claude goes on by itself once that's done.
const watchChanges = ({ previous, sessions, keyOf, onScreen = () => false }) =>
	sessions.flatMap(session => {
		const before = previous?.get(keyOf(session));

		if (!before || onScreen(session)) return [];
		if (session.status === 'waiting' && before.status !== 'waiting') return [{ session, what: 'needs you' }];
		if (session.unseen > before.unseen && !session.background)
			return [{ session, what: `${session.unseen} new since you looked` }];

		return [];
	});

// How the sessions were at this check, for the next to compare with: one waiting on its background work keeps the news
// it had before, so what came meanwhile is told once that work is back
export const lookedAt = (previous, sessions, keyOf) =>
	new Map(
		sessions.map(session => {
			const before = previous?.get(keyOf(session));

			return [keyOf(session), session.background && before ? { ...session, unseen: before.unseen } : session];
		}),
	);

export default watchChanges;
