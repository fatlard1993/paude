import { Component, Elem, styled } from '@vanilla-bean/components';

import relativeTime from '../shared/relativeTime';

export { relativeTime };

const column = `
	width: 100%;
	max-width: 960px;
	margin: 0 auto;
	box-sizing: border-box;
`;

export const Header = styled.Component`
	${column}
	display: flex;
	align-items: center;
	gap: 12px;
	padding: 10px 16px;

	.title {
		font-size: 1.2em;
		font-weight: bold;
		flex: 1;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}
`;

export const Scroll = styled.Component`
	${column}
	flex: 1;
	overflow-y: auto;
	padding: 0 16px 24px;
	display: flex;
	flex-direction: column;
	gap: 8px;
`;

export const SectionTitle = styled(
	Elem,
	({ colors }) => `
		margin: 16px 0 4px;
		font-size: 0.8em;
		letter-spacing: 0.08em;
		text-transform: uppercase;
		color: ${colors.gray};
	`,
);

export const Empty = styled(
	Elem,
	({ colors }) => `
		color: ${colors.gray};
		padding: 8px 0;
	`,
);

const Card = styled(
	Component,
	({ colors }) => `
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 6px;
		background: ${colors.alpha(colors.white, 0.05)};
		color: inherit;
		text-decoration: none;
		min-width: 0;

		&:hover, &:focus-visible {
			background: ${colors.alpha(colors.white, 0.1)};
		}

		.body {
			flex: 1;
			min-width: 0;
		}

		.title {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.meta {
			color: ${colors.light(colors.gray)};
			font-size: 0.85em;
			margin-top: 2px;
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.project {
			color: ${colors.light(colors.blue)};
		}

		.remove {
			flex-shrink: 0;
			border: none;
			background: transparent;
			opacity: 0;
			cursor: pointer;
			font-size: 1em;
		}

		&:hover .remove, .remove:focus-visible {
			opacity: 0.7;
		}

		.remove:hover {
			opacity: 1;
		}

		@media (pointer: coarse) {
			.remove {
				opacity: 0.6;
			}
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
			background: hsl(38, 70%, 60%);
			box-shadow: 0 0 0 3px hsla(38, 70%, 60%, 0.25);
		}

		.flag {
			flex-shrink: 0;
			padding: 1px 8px;
			border-radius: 9px;
			font-size: 0.75em;
			white-space: nowrap;
		}

		.flag.waiting {
			background: hsla(38, 70%, 60%, 0.2);
			color: hsl(38, 80%, 70%);
		}

		.flag.unseen {
			background: ${colors.alpha(colors.blue, 0.25)};
			color: ${colors.lighter(colors.blue)};
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

export const LinkCard = ({
	href,
	title,
	meta = [],
	project,
	live,
	busy,
	waiting,
	unseen,
	watching,
	remove,
	removeLabel = 'Delete',
	appendTo,
}) => {
	const card = new Card({ tag: 'a', attributes: { href }, appendTo });
	const body = new Elem({ appendTo: card, addClass: 'body' });

	const heading = new Elem({ appendTo: body, addClass: 'title', textContent: title });

	if (watching)
		heading.elem.append(
			Object.assign(document.createElement('i'), { className: 'fa-solid fa-eye watching', title: 'Watching' }),
		);

	const metaLine = new Elem({ appendTo: body, addClass: 'meta' });

	if (project) {
		new Elem({ tag: 'span', appendTo: metaLine, addClass: 'project', textContent: project });
		if (meta.length) metaLine.elem.append(' · ');
	}

	metaLine.elem.append(meta.filter(Boolean).join(' · '));

	if (unseen) new Elem({ appendTo: card, addClass: ['flag', 'unseen'], textContent: `${unseen} new` });
	if (waiting) new Elem({ appendTo: card, addClass: ['flag', 'waiting'], textContent: 'needs you' });

	if (live || busy || waiting) {
		const state = (waiting && 'waiting') || (busy && 'busy');

		new Elem({
			appendTo: card,
			addClass: ['dot', ...(state ? [state] : [])],
			attributes: { title: { waiting: 'Claude is waiting on someone', busy: 'working' }[state] ?? 'ready' },
		});
	}

	// Inside the link, so it has to stop the click from also opening the card
	if (remove) {
		const button = document.createElement('button');

		button.className = 'remove';
		button.textContent = '🗑';
		button.title = removeLabel;
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			remove();
		});
		card.elem.append(button);
	}

	return card;
};

export const sessionCard = (session, { showProject = true, appendTo, remove }) =>
	LinkCard({
		appendTo,
		href: `#/sessions/${session.id}`,
		title: session.pinned ? `📌 ${session.title}` : session.title,
		project: showProject ? session.project : null,
		meta: [relativeTime(session.lastModified), session.gitBranch !== 'HEAD' && session.gitBranch],
		live: session.live,
		busy: session.status === 'working' || session.busy,
		waiting: session.status === 'waiting',
		unseen: session.unseen,
		watching: session.watching,
		remove,
	});
