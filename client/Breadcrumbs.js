import { Elem, Notify, styled } from '@vanilla-bean/components';

import { tintsOf } from '../shared/hues';
import { openRemote } from './api';
import { element } from './dom';
import favicon from './favicon.svg';
import { serverName } from './identity';
import { openMenu } from './menu';
import { hueOf, onServersChange } from './servers';
import { onWaitingChange } from './waiting';

const Trail = styled(
	Elem,
	({ colors }) => `
		display: flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		flex: 1;
		white-space: nowrap;

		a.crumb {
			display: flex;
			align-items: center;
			gap: 6px;
			color: ${colors.light(colors.gray)};
			text-decoration: none;
			overflow: hidden;
			text-overflow: ellipsis;
		}

		a.crumb:hover {
			color: ${colors.white};
		}

		.root {
			display: flex;
			align-items: center;
			gap: 6px;
			flex-shrink: 0;
		}

		/* At home paude is where you are */
		span.root {
			color: ${colors.white};
			font-weight: bold;
			font-size: 1.2em;
		}

		.root img {
			width: 22px;
			height: 22px;
		}

		/* A project's name gives way to the session's before it goes */
		.trail {
			max-width: 30vw;
			flex-shrink: 1;
		}

		.separator {
			color: ${colors.alpha(colors.white, 0.3)};
			flex-shrink: 0;
		}

		.current {
			min-width: 0;
			overflow: hidden;
			text-overflow: ellipsis;
			font-weight: bold;
		}

		.waiting {
			flex-shrink: 0;
			padding: 1px 8px;
			border: none;
			border-radius: 10px;
			background: hsl(35, 90%, 55%);
			color: ${colors.black};
			font: inherit;
			font-size: 0.8em;
			font-weight: bold;
			cursor: pointer;
		}

		/* Only news, nothing asking: worth a look, not a wait */
		.waiting.news {
			background: ${colors.lightest(colors.teal)};
		}

		/* Which paude this is, in the color its cards carry, and a press away from the others */
		.server-switch {
			display: flex;
			align-items: center;
			gap: 6px;
			flex-shrink: 0;
			padding: 2px 8px;
			border-radius: 10px;
			background: hsl(var(--server-hue) 60% 50% / 0.18);
			color: hsl(var(--server-hue) 70% 75%);
			font: inherit;
			font-size: 0.85em;
		}

		.server-switch:hover {
			background: hsl(var(--server-hue) 60% 50% / 0.3);
		}

		.server-switch .fa-chevron-down {
			font-size: 0.75em;
			opacity: 0.7;
		}

		/* On a phone the bucket stands for paude, and the switch keeps only its arrow */
		@media (max-width: 600px) {
			.root .label,
			.server-switch .name {
				display: none;
			}
		}
	`,
);

// A session that needs someone: opened here, or on its own server already logged in
const openWaiting = async session => {
	if (!session.remote) {
		window.location.hash = `#/sessions/${session.id}`;

		return;
	}

	const { body, response } = await openRemote(session.remote.url, { sessionId: session.id });

	if (response?.ok) window.location.href = body.link;
	else new Notify({ type: 'error', content: `Could not reach ${session.remote.name}.` });
};

const goToServer = async server => {
	const { body, response } = await openRemote(server.url, { home: true });

	if (response?.ok) window.location.href = body.link;
	else new Notify({ type: 'error', content: `Could not reach ${server.name}.` });
};

const summaryOf = server => {
	if (server.error) return server.error;

	const projects = server.projects?.length ?? 0;
	const waiting = server.watching?.filter(session => session.status === 'waiting').length ?? 0;

	return [`${projects} project${projects === 1 ? '' : 's'}`, waiting && `${waiting} waiting for you`]
		.filter(Boolean)
		.join(' · ');
};

// Which paude this is, shown once this machine knows of others, and a menu of them: each opens at its home page,
// logged in
const serverSwitch = addCleanup => {
	const switcher = element('button', 'server-switch variant-flat');
	const here = serverName() ?? 'this machine';
	const accent = name => `hsl(${hueOf(name)} 60% 60%)`;
	let others = [];

	switcher.style.setProperty('--server-hue', hueOf(here));
	switcher.style.display = 'none';
	switcher.title = `paude on ${here}: switch to another`;
	switcher.append(element('span', 'name', here), element('i', 'fa-solid fa-chevron-down'));
	switcher.addEventListener('click', () =>
		openMenu(switcher, [
			{ heading: 'Your paudes' },
			{ label: `✓ ${here}`, detail: 'This one', accent: accent(here), onPress: () => (window.location.hash = '#/') },
			...others.map(server => ({
				label: server.name,
				detail: summaryOf(server),
				accent: accent(server.name),
				onPress: () => goToServer(server),
			})),
		]),
	);

	const stop = onServersChange(servers => {
		others = servers ?? [];
		switcher.style.display = others.length ? '' : 'none';
	});

	addCleanup?.('serverSwitch', stop);

	return switcher;
};

// Where this page sits: paude (the bucket, home) / each page above this one / this page, with the watched sessions
// that need you (asking, or with news since you looked) counted where they live: the project's on its crumb, the rest
// (other projects, other servers) beside paude, each a press away. The open session (sessionId) isn't counted. trail: [{ label, href }]; current: what this
// page is (text, or a node to keep updating); project: the project this page is in, when it's known up front.
// Returns the elements and setProject(name, crumb), for a page that learns its project later. addCleanup(name, stop)
// ends the counting with the page.
export const breadcrumbs = ({ appendTo, trail = [], current, project, sessionId, addCleanup }) => {
	const crumbs = new Trail({ appendTo, addClass: 'breadcrumbs' });
	const into = crumbs.elem;
	const atHome = !trail.length && current === undefined;
	const root = element(atHome ? 'span' : 'a', 'crumb root');
	const icon = element('img');

	Object.assign(icon, { src: favicon, alt: '' });
	root.append(icon, element('span', 'label', 'paude'));
	if (!atHome) root.href = '#/';
	root.title = serverName() ? `paude on ${serverName()}` : 'paude';
	into.append(root);

	const servers = serverSwitch(addCleanup);

	root.after(servers);

	const links = trail.map(({ label, href }) => {
		const link = element('a', 'crumb trail', label);

		link.href = href;
		into.append(element('span', 'separator', '/'), link);

		return link;
	});

	let here = null;

	if (current !== undefined) {
		here = typeof current === 'string' ? element('span', '', current) : (current.elem ?? current);
		here.classList.add('current');
		into.append(element('span', 'separator', '/'), here);
	}

	// Home lists what's waiting itself
	if (atHome) return { crumbs, links, here, setProject: () => {} };

	let waiting = [];
	let inProject = null;
	const inThisProject = session => !session.remote && session.project === inProject;
	const badge = (after, heading) => {
		const button = element('button', 'waiting');
		const counted = { button, list: [], after };

		button.style.display = 'none';
		after.after(button);
		button.addEventListener('click', () =>
			openMenu(button, [
				{ heading },
				...counted.list.map(session => ({
					label: session.title || session.project,
					detail: [
						session.status === 'waiting' ? 'asking' : `${session.unseen} new`,
						session.project,
						session.remote?.name ?? serverName(),
					]
						.filter(Boolean)
						.join(' · '),
					accent: tintsOf(session.hue)?.accent,
					onPress: () => openWaiting(session),
				})),
			]),
		);

		return counted;
	};
	const elsewhere = badge(servers, 'For you');
	let projectBadge = null;
	const show = (counted, list, what) => {
		const asking = list.filter(session => session.status === 'waiting').length;
		const news = list.length - asking;

		counted.list = list;
		counted.button.textContent = list.length;
		counted.button.title = [asking && `${asking} asking`, news && `${news} with news`]
			.filter(Boolean)
			.join(', ')
			.concat(what);
		counted.button.classList.toggle('news', !asking);
		counted.button.style.display = list.length ? '' : 'none';
	};
	const render = () => {
		const others = waiting.filter(session => session.remote || session.id !== sessionId);

		show(
			elsewhere,
			others.filter(session => !inThisProject(session)),
			inProject ? ' elsewhere' : '',
		);
		if (projectBadge) show(projectBadge, others.filter(inThisProject), ` in ${inProject}`);
	};
	const setProject = (name, crumb) => {
		inProject = name;
		if (!projectBadge || projectBadge.after !== crumb) {
			projectBadge?.button.remove();
			projectBadge = badge(crumb, `For you in ${name}`);
		}
		render();
	};

	addCleanup?.(
		'waitingCount',
		onWaitingChange(sessions => {
			waiting = sessions;
			render();
		}),
	);
	if (project) setProject(project, here ?? links.at(-1));

	return { crumbs, links, here, setProject };
};
