import { Card, Content, Elem, EmptyState, styled, theme } from '@vanilla-bean/components';

import { relativeTime } from '@vanilla-bean/components/utils/date';
import { tintsOf } from '../shared/hues';
import { LIFETIMES, clockTime } from '../shared/lifetimes';
import { AskingCard, showAsking, showLimit } from './Asking';
import { element } from './dom';
import { contextMenu, openMenu } from './menu';
import { hueOf } from './servers';

// Each page's scrolling part: its parts down a centered column
export class Scroll extends styled(
	Content,
	() => `
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 0;
		padding: 12px 16px calc(24px + ${theme.safeArea.bottom});
		--content-gutter: 16px;
	`,
) {
	static schema = {
		column: { default: true },
	};
}

// The library's empty state as paude's: a plain line where nothing is
export const Empty = styled(
	EmptyState,
	() => `
		display: block;
		flex: none;
		padding: 8px 0;
		text-align: left;

		& > .message {
			max-width: none;
		}
	`,
);

// The library's card, with a session's or project's parts in a row; its accent is the session's own color, or the
// project's folder color, in kitty-bg's tints
const SessionCard = styled(
	Card,
	({ colors, media, radius }) => `
		display: flex;
		align-items: center;
		gap: 10px;

		.body {
			flex: 1;
			min-width: 0;
		}

		/* What Claude asks takes the card's whole width, under its title and flags */
		&:has(> .asking) {
			flex-wrap: wrap;
		}

		> .asking {
			order: 1;
			flex: 1 0 100%;
		}

		.title {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.meta {
			color: ${colors.muted};
			font-size: 0.85em;
			margin-top: 2px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.project {
			color: ${colors.light(colors.blue)};
		}

		.server {
			display: inline-block;
			margin-right: 6px;
			padding: 0 6px;
			border-radius: ${radius.lg};
			color: hsl(var(--server-hue) 70% 75%);
			background: hsl(var(--server-hue) 60% 50% / 0.18);
		}

		.remove, .watch, .more {
			flex-shrink: 0;
			opacity: 0;
			font-size: 1em;
		}

		&:hover :is(.remove, .watch), :is(.remove, .watch):focus-visible, .watch.active {
			opacity: 0.7;
		}

		/* Always there, faintly, so what a card offers can be found without hovering */
		.more {
			opacity: 0.45;
		}

		&:hover .more, .more:focus-visible {
			opacity: 0.8;
		}

		:is(.remove, .watch, .more):hover {
			opacity: 1;
		}

		@media ${media.touch} {
			.remove, .watch {
				opacity: 0.6;
			}
		}

		.state {
			display: flex;
			align-items: center;
			gap: 6px;
			flex-shrink: 0;
			color: ${colors.muted};
			font-size: 0.8em;
		}

		.flag.archived {
			background: ${colors.alpha(colors.white, 0.1)};
			color: ${colors.muted};
		}

		.dot {
			width: 9px;
			height: 9px;
			border-radius: 50%;
			flex-shrink: 0;
			background: ${colors.green};
		}

		.dot.busy {
			background: ${colors.light(colors.orange)};
			animation: pulse 1.2s ease-in-out infinite;
		}

		.dot.waiting {
			background: ${colors.light(colors.warning)};
			box-shadow: 0 0 0 3px ${colors.alpha(colors.light(colors.warning), 0.25)};
		}

		.flag {
			flex-shrink: 0;
			padding: 1px 8px;
			border-radius: 9px;
			font-size: 0.75em;
			white-space: nowrap;
		}

		.flag.waiting {
			background: ${colors.alpha(colors.light(colors.warning), 0.2)};
			color: ${colors.lighter(colors.warning)};
		}

		.flag.unseen {
			background: ${colors.alpha(colors.blue, 0.25)};
			color: ${colors.lighter(colors.blue)};
		}

		.lifetime-mark {
			margin-right: 6px;

			&.was {
				opacity: 0.45;
			}
		}

		.watching {
			margin-left: 6px;
			opacity: 0.5;
			font-size: 0.8em;
		}

		@keyframes pulse {
			50% { opacity: 0.3; }
		}
	`,
);

// The library gives a vbc-input checkbox the theme's checkbox look
export const checkbox = checked => Object.assign(element('input'), { type: 'checkbox', checked });

// Inside the link, so it has to stop the click from also opening the card
const cardButton = (card, { className, icon, title, onPress }) => {
	const button = element('button', `${className} variant-flat`);

	button.append(Object.assign(document.createElement('i'), { className: `fa-solid fa-${icon}` }));
	button.title = title;
	button.addEventListener('click', event => {
		event.preventDefault();
		event.stopPropagation();
		onPress(button);
	});
	card.elem.append(button);
};

export const LinkCard = ({
	href,
	title,
	marks = [],
	meta = [],
	project,
	server,
	live,
	busy,
	waiting,
	unseen,
	watching,
	archived,
	onWatch,
	menu,
	remove,
	removeLabel = 'Delete',
	removeIcon = 'trash-can',
	onOpen,
	accent,
	appendTo,
}) => {
	const card = new SessionCard({ tag: 'a', attributes: { href }, accent, interactive: true, appendTo });

	if (onOpen) {
		card.elem.addEventListener('click', event => {
			event.preventDefault();
			onOpen();
		});
	}
	const body = new Elem({ appendTo: card, addClass: 'body' });

	const heading = new Elem({ appendTo: body, addClass: 'title', textContent: title });

	heading.elem.prepend(...marks);

	if (watching && !onWatch)
		heading.elem.append(
			Object.assign(document.createElement('i'), { className: 'fa-solid fa-eye watching', title: 'Watching' }),
		);

	const metaLine = new Elem({ appendTo: body, addClass: 'meta' });

	if (server) {
		const tag = new Elem({ tag: 'span', appendTo: metaLine, addClass: 'server', textContent: server });

		tag.elem.style.setProperty('--server-hue', hueOf(server));
	}

	if (project) {
		new Elem({ tag: 'span', appendTo: metaLine, addClass: 'project', textContent: project });
		if (meta.length) metaLine.elem.append(' · ');
	}

	metaLine.elem.append(meta.filter(Boolean).join(' · '));

	if (archived) new Elem({ appendTo: card, addClass: ['flag', 'archived'], textContent: 'archived' });
	if (unseen) new Elem({ appendTo: card, addClass: ['flag', 'unseen'], textContent: `${unseen} new` });
	if (waiting) new Elem({ appendTo: card, addClass: ['flag', 'waiting'], textContent: 'needs you' });

	// Running or not, said in words: needs you (the flag says it), working, or ready for a prompt
	if (live || busy || waiting) {
		const state = (waiting && 'waiting') || (busy && 'busy');
		const holder = new Elem({ appendTo: card, addClass: 'state' });

		new Elem({ appendTo: holder, addClass: ['dot', ...(state ? [state] : [])] });
		if (!waiting) holder.elem.append(busy ? 'working' : 'ready');
	}

	if (onWatch)
		cardButton(card, {
			className: watching ? 'watch active' : 'watch',
			icon: watching ? 'eye' : 'eye-slash',
			title: watching
				? 'Watching every session in it, new ones too. Click to stop watching them all.'
				: 'Click to watch every session in it, new ones too.',
			onPress: onWatch,
		});
	if (remove) cardButton(card, { className: 'remove', icon: removeIcon, title: removeLabel, onPress: remove });
	if (menu) {
		cardButton(card, { className: 'more', icon: 'ellipsis', title: 'More', onPress: more => openMenu(more, menu()) });
		contextMenu(card.elem, menu);
	}

	return card;
};

// A session waiting on someone shows what Claude asks, and one a usage limit stopped how to carry on: answerable
// here when it's this server's
const withAsking = (card, session) => {
	if (session.limit) {
		const limit = new AskingCard({ appendTo: card, addClass: 'asking' });
		const show = state =>
			showLimit(limit, session.id, state, {
				canAct: !session.remote,
				onChanged: when =>
					when === 'now' ? limit.elem.remove() : show({ ...state, armed: when === 'reset', triedAt: null }),
			});

		show(session.limit);

		return card;
	}
	if (session.status !== 'waiting' || !session.asking) return card;

	const asking = new AskingCard({ appendTo: card, addClass: 'asking' });

	showAsking(asking, session.id, session.asking, {
		canAnswer: !session.remote,
		onAnswered: () => asking.elem.remove(),
	});

	return card;
};

// How long a session lasts, ahead of its title (an ordinary one goes unmarked), and struck through, what it was before
// the last switch while that can still be put back
const lifetimeMarks = ({ lifetime, switched }) => {
	const marks = [];
	const was = switched?.until > Date.now() && LIFETIMES[switched.was];
	const now = LIFETIMES[lifetime];

	if (was?.mark)
		marks.push(
			Object.assign(element('s', 'lifetime-mark was', was.mark), {
				title: `Was ${was.label.toLowerCase()}; its lifetime menu puts it back until ${clockTime(switched.until)}`,
			}),
		);
	if (now?.mark)
		marks.push(Object.assign(element('span', 'lifetime-mark', now.mark), { title: `${now.label}: ${now.detail}` }));

	return marks;
};

// `when` says when it last changed in the words its list's group uses; a relative time otherwise
export const sessionCard = (session, { showProject = true, appendTo, menu, server, onOpen, when }) =>
	withAsking(
		LinkCard({
			appendTo,
			href: `#/sessions/${session.id}`,
			title: session.title,
			marks: lifetimeMarks(session),
			project: showProject ? session.project : null,
			server,
			meta: [
				when ?? relativeTime(session.lastModified ?? session.activeAt),
				session.worktree && `⎇ ${session.worktree}`,
				session.gitBranch !== 'HEAD' && session.gitBranch !== session.worktree && session.gitBranch,
			],
			live: session.live,
			busy: session.status === 'working' || session.busy,
			waiting: session.status === 'waiting',
			unseen: session.unseen,
			watching: session.watching,
			archived: session.archived,
			accent: tintsOf(session.hue)?.accent,
			menu,
			onOpen,
		}),
		session,
	);
