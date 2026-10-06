// What's worth telling a watcher since the last check: a session that started waiting on someone, or has news.
// `previous` maps keyOf(session) to how it was; the one on screen never alerts.
const watchChanges = ({ previous, sessions, keyOf, onScreen = () => false }) =>
	sessions.flatMap(session => {
		const before = previous?.get(keyOf(session));

		if (!before || onScreen(session)) return [];
		if (session.status === 'waiting' && before.status !== 'waiting') return [{ session, what: 'needs you' }];
		if (session.unseen > before.unseen) return [{ session, what: `${session.unseen} new since you looked` }];

		return [];
	});

export default watchChanges;
