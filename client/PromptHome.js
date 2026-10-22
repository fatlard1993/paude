import { Elem, isMac, Notify, styled } from '@vanilla-bean/components';

import tokens from '../shared/tokenCount';
import { findPromptHome, openRemote, sendPrompt, sendRemotePrompt } from './api';
import { serverName } from './identity';
import { forget, recall, remember } from './storage';
import { button, element } from './dom';
import { sessionCard } from './Layout';

const Compose = styled(
	Elem,
	({ colors, media, radius }) => `
		display: flex;
		flex-direction: column;
		border: 1px solid ${colors.border};
		border-radius: ${radius.lg};
		background: ${colors.alpha(colors.black, 0.35)};
		transition: border-color 0.15s, box-shadow 0.15s;

		&:focus-within {
			border-color: ${colors.light(colors.blue)};
			box-shadow: 0 0 0 2px ${colors.alpha(colors.blue, 0.35)};
		}

		textarea {
			min-height: 4.5em;
			max-height: 40vh;
			padding: 10px 12px;
			border: none;
			border-radius: ${radius.lg} ${radius.lg} 0 0;
			background: transparent;
			outline: none;
			resize: vertical;
		}

		.footer {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 6px;
			padding: 6px 8px;
			border-top: 1px solid ${colors.alpha(colors.white, 0.06)};
		}

		/* What the prompt goes out with: chips a page adds, left of the actions */
		.options {
			flex: 1;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 6px;
			min-width: 0;
		}

		/* A setting the prompt goes out with, as the session's bar shows it; a press opens its choices */
		.chip {
			display: inline-flex;
			align-items: center;
			gap: 6px;
			max-width: 100%;
			overflow: hidden;
		}

		.chip.lifetime.warm {
			border-color: ${colors.alpha(colors.blue, 0.5)};
			background: ${colors.alpha(colors.blue, 0.2)};
			color: ${colors.lighter(colors.blue)};
		}

		.chip.lifetime.brief {
			border-color: ${colors.alpha(colors.light(colors.warning), 0.5)};
			color: ${colors.light(colors.warning)};
		}

		.chip-name {
			flex: 1 1 140px;
			min-width: 0;
			max-width: 260px;
			padding: 3px 10px;
			border: 1px solid ${colors.border};
			border-radius: ${radius.pill};
			background: transparent;
			font-size: 0.85em;
		}

		.actions {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: 6px;
			margin-left: auto;
		}

		.actions button {
			border-radius: ${radius.md};
		}

		/* The lesser action reads as an option, not a second send */
		.actions button.secondary {
			color: ${colors.alpha(colors.white, 0.75)};
		}

		.actions button.secondary:hover {
			color: ${colors.white};
		}

		.keys {
			margin-left: 8px;
			opacity: 0.6;
			font-size: 0.8em;
		}

		@media ${media.touch} {
			.keys {
				display: none;
			}
		}
	`,
);

const SEND_KEYS = isMac() ? '⌘↵' : 'Ctrl ↵';

// A prompt's box: write what Claude should do, then send it with its actions, the last of them the main one (Ctrl or
// Command with Enter presses it). What's typed is kept in this browser under `keep` until sent() says it went, so
// leaving the page doesn't lose it. Returns the textarea, the row for options, each action's button, and sent().
export const composeBox = ({ appendTo, placeholder, actions, keep }) => {
	const box = new Compose({ appendTo });
	const prompt = Object.assign(element('textarea'), { placeholder, value: recall(keep) });
	const options = element('div', 'options');
	const row = element('div', 'actions');
	const buttons = actions.map(({ label, title, onPress }, index) => {
		const main = index === actions.length - 1;
		const node = button(element('span', 'label', label), onPress, {
			title,
			className: main ? 'primary' : 'secondary variant-flat',
		});

		if (main) node.append(element('span', 'keys', SEND_KEYS));

		return node;
	});
	const footer = element('div', 'footer');

	row.append(...buttons);
	footer.append(options, row);
	box.elem.append(prompt, footer);
	prompt.addEventListener('keydown', event => {
		if (event.key !== 'Enter' || !(event.ctrlKey || event.metaKey)) return;
		event.preventDefault();
		buttons.at(-1).click();
	});
	prompt.addEventListener('input', () => (prompt.value ? remember(keep, prompt.value) : forget(keep)));

	return { prompt, options, buttons, sent: () => forget(keep) };
};

export const Places = styled(
	Elem,
	({ colors, radius }) => `
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin-top: 10px;

		&:empty {
			display: none;
		}

		.heading {
			color: ${colors.light(colors.gray)};
			font-size: 0.85em;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}

		.place {
			display: flex;
			flex-direction: column;
			gap: 6px;
			padding: 8px;
			border-radius: ${radius.lg};
			background: ${colors.alpha(colors.white, 0.03)};
		}

		.why {
			color: ${colors.alpha(colors.white, 0.85)};
		}

		.cost {
			color: ${colors.light(colors.gray)};
			font-size: 0.85em;
		}

		.cost.cold {
			color: ${colors.light(colors.warning)};
		}

		.place > button {
			align-self: flex-start;
		}
	`,
);

// Another server's session or project page, opened there already logged in; true once it's on its way
const openThere = async (url, to) => {
	const { body, response } = await openRemote(url, to);

	if (response?.ok) window.location.href = body.link;
	else new Notify({ type: 'error', content: 'Could not reach that server' });

	return Boolean(response?.ok);
};

// What the lifetime suggested for a new session means
const LIFETIME_NOTES = {
	warm: 'Starts kept warm: pinged while you are away, so it comes back cached',
	brief: "Starts short-lived: deleted once Claude's cache lets go of it with nobody in it",
};

// What sending there costs, from the session's cache meter
const costOf = meter => {
	if (!meter) return null;
	if (meter.warm) return element('div', 'cost', `Cached: about ${tokens(meter.warmCost)} to send it there`);

	return element(
		'div',
		'cost cold',
		`The cache has let go: about ${tokens(meter.coldCost)} to send it there, caching all ${tokens(meter.context)} again`,
	);
};

// Finds where `prompt` belongs and shows it in `places`: the sessions it carries on, each with what sending costs, and
// a new session (startFresh(project) starts it). onSent once it has gone to a session or another server.
export const placePrompt = async ({ places, prompt, project, startFresh, onSent }) => {
	const into = places.elem;

	if (!prompt) return new Notify({ type: 'warning', content: 'Say what Claude should do first' });

	into.replaceChildren(element('div', 'heading', 'Finding where it goes…'));

	const { body, response } = await findPromptHome(prompt, project);

	if (!response?.ok) {
		into.replaceChildren();

		return new Notify({ type: 'warning', content: "Couldn't place it just now" });
	}

	const { matches, fresh } = body;

	into.replaceChildren(element('div', 'heading', matches.length ? 'Carries on' : 'No conversation carries this on'));
	for (const { session, remote, why, meter } of matches) {
		const place = element('div', 'place');

		into.append(place);
		sessionCard(
			{ ...session, remote },
			{
				appendTo: place,
				showProject: !project,
				server: remote?.name ?? serverName(),
				...(remote && { onOpen: () => openThere(remote.url, { sessionId: session.id }) }),
			},
		);
		place.append(
			element('div', 'why', why),
			...[costOf(meter)].filter(Boolean),
			button('Send it here', async () => {
				const { response: sent } = remote
					? await sendRemotePrompt(remote.url, session.id, prompt)
					: await sendPrompt(session.id, prompt);

				if (!sent?.ok) return new Notify({ type: 'error', content: 'Could not send it there' });
				onSent?.();
				if (!remote) return (window.location.hash = `#/sessions/${session.id}`);
				await openThere(remote.url, { sessionId: session.id });
			}),
		);
	}

	const place = element('div', 'place');

	into.append(element('div', 'heading', 'Or a new session'), place);
	if (fresh.why) place.append(element('div', 'why', fresh.why));
	if (fresh.lifetime && fresh.lifetime !== 'ordinary')
		place.append(element('div', 'cost', LIFETIME_NOTES[fresh.lifetime]));
	if (fresh.remote)
		place.append(
			button(
				`Start it in ${fresh.project} on ${fresh.remote.name}`,
				async () =>
					(await openThere(fresh.remote.url, { project: fresh.project, draft: prompt, lifetime: fresh.lifetime })) &&
					onSent?.(),
			),
		);
	else if (fresh.project || project)
		place.append(
			button(`Start it in ${fresh.project ?? project}`, () => startFresh(fresh.project ?? project, fresh.lifetime)),
		);
};

// A prompt carried from home to the project page it starts in, there to pick its worktree
const DRAFT_KEY = 'paude.draft.';

// A prompt for a project page to start with, and the lifetime suggested for it
export const keepDraft = (project, text, lifetime) => {
	try {
		sessionStorage.setItem(DRAFT_KEY + project, JSON.stringify({ text, lifetime }));
	} catch {
		// Without storage the project page opens with an empty box
	}
};

export const carryDraft = (project, text, lifetime) => {
	keepDraft(project, text, lifetime);
	window.location.hash = `#/projects/${encodeURIComponent(project)}`;
};

// { text, lifetime }, or null for none
export const takeDraft = project => {
	try {
		const kept = sessionStorage.getItem(DRAFT_KEY + project);

		sessionStorage.removeItem(DRAFT_KEY + project);

		return kept ? JSON.parse(kept) : null;
	} catch {
		return null;
	}
};
