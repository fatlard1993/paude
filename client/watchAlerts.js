import { Notify } from '@vanilla-bean/components';

import watchChanges from '../shared/watchChanges';
import { getRemotes, getWatching } from './api';
import { showNotification } from './notify';
import { updateTabTitle } from './tabTitle';

const CHECK_MS = 15_000;
// Other servers answer slower
const REMOTE_EVERY = 4;

const keyOf = session => (session.remote ? `${session.remote.url} ${session.id}` : session.id);

const alert = async (session, what) => {
	const where = [session.project, session.remote?.name].filter(Boolean).join(' · ');
	const url = session.remote ? '/#/' : `/#/sessions/${session.id}`;
	const shown = await showNotification({
		title: `${session.title || 'A session'}${what}`,
		body: where,
		tag: `paude-watch-${keyOf(session)}`,
		url,
	});

	if (!shown && !document.hidden)
		new Notify({ type: 'info', content: `${session.title || 'A session'}${what}`, timeout: 8000 });
};

export const startWatchAlerts = ({ remotes }) => {
	let previous = null;
	let checks = 0;
	let remoteWatched = [];

	const check = async () => {
		const here = (await getWatching()).body ?? [];

		if (remotes && checks % REMOTE_EVERY === 0) {
			const remotes = (await getRemotes()).body ?? [];

			remoteWatched = remotes
				.filter(remote => !remote.error)
				.flatMap(remote => remote.watching.map(session => ({ ...session, remote })));
		}
		checks += 1;

		const all = [...here, ...remoteWatched];
		updateTabTitle({ waiting: all.filter(session => session.status === 'waiting').length });

		const onScreen = session =>
			!session.remote && window.location.hash === `#/sessions/${session.id}` && !document.hidden;

		for (const { session, what } of watchChanges({ previous, sessions: all, keyOf, onScreen })) {
			await alert(session, what === 'needs you' ? ` ${what}` : `: ${what}`);
		}

		previous = new Map(all.map(session => [keyOf(session), session]));
	};

	check();
	setInterval(check, CHECK_MS);
};
