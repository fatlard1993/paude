import { Notify } from '@vanilla-bean/components';

import { getRemotes, getWatching } from './api';
import { showNotification } from './notify';

const CHECK_MS = 15_000;
// Other servers answer slower; they're asked every fourth check
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

// Watched sessions, on this server and the others this one knows, checked in the background: a notification when
// one starts waiting on someone or has news, unless it's the one on screen, and a count of waiting ones in the tab
export const startWatchAlerts = ({ local }) => {
	let previous = null;
	let checks = 0;
	let remoteWatched = [];

	const check = async () => {
		const here = (await getWatching()).body ?? [];

		if (local && checks % REMOTE_EVERY === 0) {
			const remotes = (await getRemotes()).body ?? [];

			remoteWatched = remotes
				.filter(remote => !remote.error)
				.flatMap(remote => remote.watching.map(session => ({ ...session, remote })));
		}
		checks += 1;

		const all = [...here, ...remoteWatched];
		const waiting = all.filter(session => session.status === 'waiting').length;

		document.title = waiting ? `(${waiting}) paude` : 'paude';

		for (const session of previous ? all : []) {
			const before = previous.get(keyOf(session));
			const onScreen = !session.remote && window.location.hash === `#/sessions/${session.id}` && !document.hidden;

			if (!before || onScreen) continue;
			if (session.status === 'waiting' && before.status !== 'waiting') await alert(session, ' needs you');
			else if (session.unseen > before.unseen) await alert(session, `: ${session.unseen} new since you looked`);
		}

		previous = new Map(all.map(session => [keyOf(session), session]));
	};

	check();
	setInterval(check, CHECK_MS);
};
