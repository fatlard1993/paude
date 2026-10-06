import watchChanges from '../shared/watchChanges';
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

		const changes = watchChanges({
			previous,
			sessions: all,
			keyOf: session => session.key,
			onScreen: session => session.id === onScreen(),
		});

		for (const { session, what } of changes) {
			const title = session.title || 'A session';

			notify(`paude · ${session.server.label}`, what === 'needs you' ? `${title} ${what}` : `${title}: ${what}`);
		}

		previous = new Map(all.map(session => [session.key, session]));
	};

	check();
	setInterval(check, CHECK_MS).unref();
};

export default startWatchAlerts;
