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

// Where this page sits: paude (the bucket, home) / each page above this one / this page. Beside paude, how many
// watched sessions are waiting on you (not counting `sessionId`, the one open), a press away from any of them.
// trail: [{ label, href }]; current: what this page is (text, or a node to keep updating). Returns the elements, so a
// page can fill in a crumb it learns later. addCleanup(name, stop) ends the waiting count with the page.
export const breadcrumbs = ({ appendTo, trail = [], current, sessionId, addCleanup }) => {
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

	if (!atHome) {
		const waiting = element('button', 'waiting');

		waiting.style.display = 'none';
		into.append(waiting);

		let others = [];

		waiting.addEventListener('click', () =>
			openMenu(waiting, [
				{ heading: 'Waiting for you' },
				...others.map(session => ({
					label: session.title || session.project,
					detail: [session.project, session.remote?.name ?? serverName()].filter(Boolean).join(' · '),
					accent: tintsOf(session.hue)?.accent,
					onPress: () => openWaiting(session),
				})),
			]),
		);
		addCleanup?.(
			'waitingCount',
			onWaitingChange(sessions => {
				others = sessions.filter(session => session.remote || session.id !== sessionId);
				waiting.textContent = others.length;
				waiting.title = `${others.length} waiting for you`;
				waiting.style.display = others.length ? '' : 'none';
			}),
		);
	}

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

	return { crumbs, links, here };
};
