import { Dialog, Elem, isMac, Notify, styled } from '@vanilla-bean/components';

import { tintsOf } from '../shared/hues';
import tokens from '../shared/tokenCount';
import { createSession, findPromptHome, openRemote, sendPrompt, sendRemotePrompt, startRemoteSession } from './api';
import { serverName } from './identity';
import { forget, recall, remember } from './storage';
import { button, element } from './dom';

const Compose = styled(
	Elem,
	({ colors, media, radius, space }) => `
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
			padding: ${space.md};
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
			gap: ${space.sm};
			padding: ${space.sm};
			border-top: 1px solid ${colors.alpha(colors.white, 0.06)};
		}

		/* What the prompt goes out with: chips a page adds, left of the actions */
		.options {
			flex: 1;
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: ${space.sm};
			min-width: 0;
		}

		/* A setting the prompt goes out with, as the session's bar shows it; a press opens its choices */
		.chip {
			display: inline-flex;
			align-items: center;
			gap: ${space.sm};
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
			padding: ${space.xs} ${space.md};
			border: 1px solid ${colors.border};
			border-radius: ${radius.pill};
			background: transparent;
			font-size: 0.85em;
		}

		.actions {
			display: flex;
			flex-wrap: wrap;
			justify-content: flex-end;
			gap: ${space.sm};
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
			margin-left: ${space.sm};
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

// The dialog a prompt is placed in: a spinner while it looks, then a button for each place it could go
const Placing = styled(
	Elem,
	({ colors, radius, space }) => `
		display: flex;
		flex-direction: column;
		gap: ${space.sm};

		.looking {
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: ${space.md};
			padding: ${space.lg} 0;
			color: ${colors.muted};
		}

		.spinner {
			width: 28px;
			height: 28px;
			border: 3px solid ${colors.alpha(colors.white, 0.12)};
			border-top-color: ${colors.light(colors.blue)};
			border-radius: 50%;
			animation: paude-placing 0.8s linear infinite;
		}

		@keyframes paude-placing {
			to {
				transform: rotate(360deg);
			}
		}

		@media (prefers-reduced-motion: reduce) {
			.spinner {
				animation-duration: 2.4s;
			}
		}

		.heading {
			margin-top: ${space.sm};
			color: ${colors.muted};
			font-size: 0.85em;
			text-transform: uppercase;
			letter-spacing: 0.05em;
		}

		button.place {
			display: flex;
			flex-direction: column;
			align-items: flex-start;
			gap: 2px;
			width: 100%;
			height: auto;
			padding: ${space.sm} ${space.md};
			border-radius: ${radius.md};
			box-shadow: inset 3px 0 var(--accent, transparent);
			text-align: left;
			white-space: normal;
		}

		.name {
			font-weight: bold;
		}

		.where,
		.cost {
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.why {
			color: ${colors.alpha(colors.white, 0.85)};
		}

		.cost.cold {
			color: ${colors.light(colors.warning)};
		}

		button.place:disabled {
			opacity: 0.5;
		}

		button.place.going {
			opacity: 1;
		}
	`,
);

// Another server's session or project page, opened there already logged in; true once it's on its way
const openThere = async (url, to) => {
	const { body, response } = await openRemote(url, to);

	if (response?.ok) window.location.href = body.link;
	else new Notify({ intent: 'danger', content: 'Could not reach that server' });

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

const failed = content => {
	new Notify({ intent: 'danger', content });

	return false;
};

const looking = text => {
	const node = element('div', 'looking');

	node.append(element('div', 'spinner'), element('div', '', text));

	return node;
};

// Each place a prompt can go, as { heading, lines, accent, go }: the sessions it carries on, then a new session in the
// project that fits, here or on another server. go() takes it there and resolves true once it's on its way.
const placesFor = ({ matches, fresh }, { prompt, project, startFresh }) => {
	const sessions = matches.map(({ session, remote, why, meter }) => ({
		heading: 'Carries on',
		lines: [
			element('div', 'name', session.title || session.project),
			element('div', 'where', [session.project, remote?.name ?? serverName()].filter(Boolean).join(' · ')),
			element('div', 'why', why),
			costOf(meter),
		],
		accent: tintsOf(session.hue)?.accent,
		go: async () => {
			const { response } = remote
				? await sendRemotePrompt(remote.url, session.id, prompt)
				: await sendPrompt(session.id, prompt);

			if (!response?.ok) return failed('Could not send it there');
			if (remote) return await openThere(remote.url, { sessionId: session.id });
			window.location.hash = `#/sessions/${session.id}`;

			return true;
		},
	}));
	const where = fresh.project ?? project;
	const mode = /^(warm|brief)$/.test(fresh.lifetime ?? '') ? fresh.lifetime : undefined;

	if (!where) return sessions;

	return [
		...sessions,
		{
			heading: 'A new session',
			lines: [
				element('div', 'name', `Start it in ${where}`),
				element('div', 'where', fresh.remote?.name ?? serverName() ?? 'this machine'),
				fresh.why && element('div', 'why', fresh.why),
				mode && element('div', 'cost', LIFETIME_NOTES[mode]),
			],
			go: async () => {
				if (fresh.remote) {
					const { body, response } = await startRemoteSession(fresh.remote.url, where, prompt, mode);

					if (!response?.ok) return failed(`Could not start it on ${fresh.remote.name}`);

					return await openThere(fresh.remote.url, { sessionId: body.id });
				}
				if (startFresh) return startFresh(where, fresh.lifetime);

				const { body, response } = await createSession(where, prompt, undefined, mode);

				if (!response?.ok) return failed(`Could not start it in ${where}`);
				window.location.hash = `#/sessions/${body.id}`;

				return true;
			},
		},
	];
};

// Finds where `prompt` belongs, in a dialog that shows it looking, then offers each place it could go; each goes
// straight into its session, and a single place is gone to without asking. A new session here starts in the project's
// own folder, or with startFresh(project, lifetime) when given (resolving true once started). onSent once it's gone.
export const placePrompt = async ({ prompt, project, startFresh, onSent }) => {
	if (!prompt) return new Notify({ intent: 'warning', content: 'Say what Claude should do first' });

	const body = new Placing({});
	let closed = false;
	const dialog = new Dialog({
		size: 'standard',
		header: 'Where it goes',
		body,
		buttons: ['Cancel'],
		onButtonPress: ({ closeDialog }) => closeDialog(),
		onClose: () => (closed = true),
	});
	const close = () => !closed && dialog.close();

	body.elem.replaceChildren(looking('Finding the sessions it carries on…'));

	const { body: found, response } = await findPromptHome(prompt, project);

	if (closed) return;
	if (!response?.ok) {
		close();

		return new Notify({ intent: 'warning', content: "Couldn't place it just now" });
	}

	const places = placesFor(found, { prompt, project, startFresh });
	const go = async (place, pressed) => {
		const buttons = [...body.elem.querySelectorAll('button.place')];

		for (const each of buttons) each.disabled = true;
		pressed?.classList.add('going');
		body.elem.append(looking('Taking it there…'));

		const gone = await place.go();

		if (gone) {
			onSent?.();
			close();

			return;
		}

		body.elem.querySelector('.looking')?.remove();
		for (const each of buttons) each.disabled = false;
		pressed?.classList.remove('going');
	};

	if (places.length === 1) {
		body.elem.replaceChildren(looking('Taking it there…'));
		const gone = await places[0].go();

		if (gone) onSent?.();
		close();

		return;
	}
	if (!places.length) {
		body.elem.replaceChildren(
			element('div', 'why', 'Nothing carries this on, and no project fits it: start it from a project of yours.'),
		);

		return;
	}

	body.elem.replaceChildren();
	let heading = null;

	for (const place of places) {
		if (place.heading !== heading) body.elem.append(element('div', 'heading', (heading = place.heading)));

		const pressed = element('button', 'place variant-flat');

		pressed.append(...place.lines.filter(Boolean));
		if (place.accent) pressed.style.setProperty('--accent', place.accent);
		pressed.addEventListener('click', () => go(place, pressed));
		body.elem.append(pressed);
	}
	body.elem.querySelector('button.place')?.focus();
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
