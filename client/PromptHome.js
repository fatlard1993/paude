import { Elem, Input, Notify, styled } from '@vanilla-bean/components';

import tokens from '../shared/tokenCount';
import { findPromptHome, openRemote, sendPrompt, sendRemotePrompt } from './api';
import { serverName } from './identity';
import { button, element } from './dom';
import { sessionCard } from './Layout';

// A prompt's box: write what Claude should do, then find where it goes before sending it
export const Composer = styled(
	Input,
	() => `
		width: 100%;
		min-height: 4.5em;
		max-height: 40vh;
		box-sizing: border-box;
	`,
);

export const Places = styled(
	Elem,
	({ colors }) => `
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
			border-radius: 8px;
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
			color: hsl(35, 90%, 62%);
		}

		.place > button {
			align-self: flex-start;
		}
	`,
);

// Another server's session or project page, opened there already logged in
const openThere = async (url, to) => {
	const { body, response } = await openRemote(url, to);

	if (response?.ok) window.location.href = body.link;
	else new Notify({ type: 'error', content: 'Could not reach that server' });
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
// a new session (startFresh(project) starts it)
export const placePrompt = async ({ places, prompt, project, startFresh }) => {
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
				if (!remote) return (window.location.hash = `#/sessions/${session.id}`);
				await openThere(remote.url, { sessionId: session.id });
			}),
		);
	}

	const place = element('div', 'place');

	into.append(element('div', 'heading', 'Or a new session'), place);
	if (fresh.why) place.append(element('div', 'why', fresh.why));
	if (fresh.remote)
		place.append(
			button(`Start it in ${fresh.project} on ${fresh.remote.name}`, () =>
				openThere(fresh.remote.url, { project: fresh.project, draft: prompt }),
			),
		);
	else if (fresh.project || project)
		place.append(button(`Start it in ${fresh.project ?? project}`, () => startFresh(fresh.project ?? project)));
};

// A prompt carried from home to the project page it starts in, there to pick its worktree
const DRAFT_KEY = 'paude.draft.';

export const keepDraft = (project, text) => {
	try {
		sessionStorage.setItem(DRAFT_KEY + project, text);
	} catch {
		// Without storage the project page opens with an empty box
	}
};

export const carryDraft = (project, text) => {
	keepDraft(project, text);
	window.location.hash = `#/projects/${encodeURIComponent(project)}`;
};

export const takeDraft = project => {
	try {
		const text = sessionStorage.getItem(DRAFT_KEY + project);

		sessionStorage.removeItem(DRAFT_KEY + project);

		return text;
	} catch {
		return null;
	}
};
