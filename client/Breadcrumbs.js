import { Elem, Notify, styled } from '@vanilla-bean/components';

import { tintsOf } from '../shared/hues';
import { openRemote } from './api';
import { element } from './dom';
import favicon from './favicon.svg';
import { serverName } from './identity';
import { openMenu } from './menu';
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

		/* On a phone the bucket stands for paude */
		@media (max-width: 600px) {
			.root .label {
				display: none;
			}
		}
	`,
);

// A session waiting on someone: opened here, or on its own server already logged in
const openWaiting = async session => {
	if (!session.remote) {
		window.location.hash = `#/sessions/${session.id}`;

		return;
	}

	const { body, response } = await openRemote(session.remote.url, { sessionId: session.id });

	if (response?.ok) window.location.href = body.link;
	else new Notify({ type: 'error', content: `Could not reach ${session.remote.name}.` });
};

// Where this page sits: paude (the bucket, home) / each page above this one / this page, with the watched sessions
// waiting on you counted where they live: the project's on its crumb, the rest (other projects, other servers) beside
// paude, each a press away. The open session (sessionId) isn't counted. trail: [{ label, href }]; current: what this
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
					detail: [session.project, session.remote?.name ?? serverName()].filter(Boolean).join(' · '),
					accent: tintsOf(session.hue)?.accent,
					onPress: () => openWaiting(session),
				})),
			]),
		);

		return counted;
	};
	const elsewhere = badge(root, 'Waiting for you');
	let projectBadge = null;
	const show = (counted, list, what) => {
		counted.list = list;
		counted.button.textContent = list.length;
		counted.button.title = `${list.length} waiting for you${what}`;
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
			projectBadge = badge(crumb, `Waiting for you in ${name}`);
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
