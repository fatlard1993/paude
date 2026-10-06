import notifier from './notify';
import { api } from './servers';

const CHECK_MS = 15_000;

const startWatchAlerts = (servers, onScreen) => {
	const notify = notifier();
	let previous = null;

	const check = async () => {
		const all = (
			await Promise.all(
				servers.map(server =>
					api(server, '/api/watching').then(
						sessions => sessions.map(session => ({ ...session, server, key: `${server.url} ${session.id}` })),
						() => [],
					),
				),
			)
		).flat();

		for (const session of previous ? all : []) {
			const before = previous.get(session.key);
			const title = session.title || 'A session';

			if (!before || session.id === onScreen()) continue;
			if (session.status === 'waiting' && before.status !== 'waiting')
				notify(`paude · ${session.server.label}`, `${title} needs you`);
			else if (session.unseen > before.unseen)
				notify(`paude · ${session.server.label}`, `${title}: ${session.unseen} new since you looked`);
		}

		previous = new Map(all.map(session => [session.key, session]));
	};

	check();
	setInterval(check, CHECK_MS).unref();
};

export default startWatchAlerts;
