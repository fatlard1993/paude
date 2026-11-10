import { Dialog, Elem, isMac, Notify, styled } from '@vanilla-bean/components';

import { tintsOf } from '../shared/hues';
import { LIFETIMES } from '../shared/lifetimes';
import { MODELS } from '../shared/models';
import tokens from '../shared/tokenCount';
import { READING, makesGame } from '../shared/arcade';
import { carriedInto, promptPlan, startWith } from '../shared/promptPlan';
import {
	createSession,
	findPromptHome,
	openRemote,
	sendPrompt,
	sendRemotePrompt,
	setSessionArcade,
	startRemoteSession,
} from './api';
import { goToArcade, makeArcade } from './Arcade/makeArcade';
import { serverName } from './identity';
import { forget, recall, remember } from './storage';
import { button, element } from './dom';
import { intoBox, micButton } from './micButton';
import { openMenu } from './menu';

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

		/* Where it goes and what a new session is started with: small fields in the row, not each a row of its own */
		.options select.choice {
			width: auto;
			max-width: 16em;
			flex: 0 1 auto;
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

		.chip.lifetime.going {
			border-color: ${colors.alpha(colors.green, 0.5)};
			background: ${colors.alpha(colors.green, 0.2)};
			color: ${colors.lighter(colors.green)};
		}

		.chip.lifetime.fabled {
			border-color: ${colors.alpha(colors.purple, 0.5)};
			background: ${colors.alpha(colors.purple, 0.2)};
			color: ${colors.lighter(colors.purple)};
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
	const mic = micButton({ onText: words => intoBox(prompt, words), className: 'secondary variant-flat' });

	if (mic) row.prepend(mic);
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

		.model {
			display: flex;
			flex-direction: column;
			gap: 2px;
			padding: 0 ${space.md};
			color: ${colors.muted};
			font-size: 0.85em;
		}

		.model .pick {
			display: flex;
			align-items: center;
			gap: ${space.sm};
			white-space: nowrap;
		}

		.model select {
			min-width: 0;
			font: inherit;
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

// The model a new session runs on, as suggested (and why) and changeable before it starts: { node, value() }
const modelPicker = (suggested, why, chosen) => {
	const node = element('div', 'model');
	const picking = element('label', 'pick');
	const select = element('select');

	for (const [model, { label, detail }] of Object.entries(MODELS)) {
		const option = element('option', '', `${label}${model === suggested ? ' (suggested)' : ''}: ${detail}`);

		option.value = model;
		select.append(option);
	}
	// What was already picked where the prompt was written stands; the suggestion is only marked
	select.value = (chosen in MODELS && chosen) || (suggested in MODELS ? suggested : 'default');
	picking.append('Runs on', select);
	node.append(picking, ...(why ? [element('div', 'model-why', why)] : []));

	return { node, value: () => (select.value === 'default' ? undefined : select.value) };
};

// How long the new session lasts, Haiku's suggestion picked (ordinary when it made none): every lifetime, the ones that
// act unattended on the owner's usage included, since this is the person choosing
const lifetimePicker = (suggested, chosen) => {
	const node = element('div', 'model');
	const picking = element('label', 'pick');
	const select = element('select');

	for (const [lifetime, { label, detail }] of Object.entries(LIFETIMES)) {
		const option = element('option', '', `${label}${lifetime === suggested ? ' (suggested)' : ''}: ${detail}`);

		option.value = lifetime;
		select.append(option);
	}
	select.value = (chosen in LIFETIMES && chosen) || (suggested in LIFETIMES ? suggested : 'ordinary');
	picking.append('Lasts', select);
	node.append(picking);

	return { node, value: () => select.value };
};

// Whether what's sent goes to the arcade, and how Claude writes there: a chip for a compose box's options, kept per
// browser. value() is a READING key, or null for an ordinary session.
const ARCADE_KEPT = 'paude.prompt.arcade';

export const arcadePicker = () => {
	const node = element('button', 'chip variant-chip');
	let reading = recall(ARCADE_KEPT);

	const show = () => {
		node.replaceChildren(
			element('i', 'fa-solid fa-gamepad'),
			` ${reading in READING ? `Arcade: ${READING[reading].label}` : 'No arcade'}`,
		);
		node.classList.toggle('active', reading in READING);
		node.title =
			reading in READING
				? `Makes a new game in the arcade, ${READING[reading].detail}. Click to change`
				: 'An ordinary session. Click to make a game in the arcade instead: big talk, choices to tap';
	};

	node.type = 'button';
	node.addEventListener('click', () =>
		openMenu(node, [
			{ heading: 'Make a game of it in the arcade?' },
			{ label: 'No arcade', ...(!(reading in READING) && { icon: 'check' }), onPress: () => pick(null) },
			...Object.entries(READING).map(([key, { label, detail }]) => ({
				label: `Arcade: ${label}`,
				detail,
				...(key === reading && { icon: 'check' }),
				onPress: () => pick(key),
			})),
		]),
	);

	const pick = key => {
		reading = key;
		if (key) remember(ARCADE_KEPT, key);
		else forget(ARCADE_KEPT);
		show();
	};

	show();

	return { node, value: () => (reading in READING ? reading : null) };
};

// Each place a prompt can go, as { heading, lines, accent, go, after }: the sessions it carries on, then a new session
// in the project that fits, here or on another server, with the model it runs on and how long it lasts to pick under
// it (`after`). go() takes it there and resolves true once it's on its way.
const placesFor = (
	{ matches, fresh },
	{ prompt, project, startFresh, onArrive, arcade, model: runs, lifetime: lasts },
) => {
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
			// Sent for the arcade: the session switches into it (Claude starting again with its rules) and opens there
			if (arcade && !remote) {
				await setSessionArcade(session.id, { on: true, reading: arcade });
				window.location.hash = `#/arcade/${session.id}`;

				return true;
			}
			if (onArrive) return onArrive({ id: session.id, remote }) ?? true;
			if (remote) return await openThere(remote.url, { sessionId: session.id });
			window.location.hash = `#/sessions/${session.id}`;

			return true;
		},
	}));
	const where = fresh.project ?? project;
	const model = modelPicker(fresh.model, fresh.modelWhy, runs);
	const lifetime = lifetimePicker(fresh.lifetime, lasts);
	const after = element('div', 'pickers');

	after.append(model.node, lifetime.node);

	// Sent for the arcade, it can also become a game of its own: a project made from the game scaffold, the prompt its
	// idea, Claude building it in the arcade
	const newGame = arcade && {
		heading: 'A new game',
		lines: [
			element('div', 'name', 'Make a game of it'),
			element('div', 'where', `from the game scaffold, on ${serverName() ?? 'this machine'}`),
		],
		go: async () => {
			const made = await makeArcade({ name: '', idea: prompt, reading: arcade }, null, element('pre'));

			if (!made?.id) return failed(made?.error || 'The game could not be made');

			return goToArcade(made.id, null);
		},
	};

	if (!where) return [...sessions, ...(newGame ? [newGame] : [])];

	return [
		...sessions,
		...(newGame ? [newGame] : []),
		{
			heading: 'A new session',
			lines: [
				element('div', 'name', `Start it in ${where}`),
				element('div', 'where', fresh.remote?.name ?? serverName() ?? 'this machine'),
				fresh.why && element('div', 'why', fresh.why),
			],
			after,
			fresh: true,
			go: () => {
				if (startFresh && !fresh.remote) return startFresh(where, lifetime.value(), model.value());

				return startSessionIn({
					prompt,
					project: where,
					remote: fresh.remote,
					model: model.value(),
					lifetime: lifetime.value(),
					arcade,
					onArrive,
				});
			},
		},
	];
};

// A new session started in `project` with `prompt`, and gone to: no looking for one it carries on, nothing asked. On
// another paude with `remote` ({ url, name }); run on `model` and lasting `lifetime` (each as picked, or left out for
// the ordinary); in the arcade with `arcade`. `model: 'suggest'` asks what the prompt wants first, which is the one
// wait there can be. Goes to `onArrive({ id, remote })` when given, else to the session's page. Resolves true once
// it's on its way.
export const startSessionIn = async ({ prompt, project, remote, model, lifetime, arcade, onArrive }) => {
	let suggested;

	if (promptPlan({ project, remote, arcade, model }).suggest) {
		const { body, response } = await findPromptHome(prompt, project);

		suggested = response?.ok ? body.fresh?.model : undefined;
	}

	const { model: tier, mode } = startWith({ model, lifetime, suggested });

	if (remote) {
		const { body, response } = await startRemoteSession(remote.url, project, prompt, mode, tier);

		if (!response?.ok) return failed(`Could not start it on ${remote.name}`);
		if (onArrive) return onArrive({ id: body.id, remote }) ?? true;

		return await openThere(remote.url, { sessionId: body.id });
	}

	const { body, response } = await createSession(
		project,
		prompt,
		undefined,
		mode,
		tier,
		arcade ? { reading: arcade } : undefined,
	);

	if (!response?.ok) return failed(`Could not start it in ${project}`);
	if (arcade) {
		window.location.hash = `#/arcade/${body.id}`;

		return true;
	}
	if (onArrive) return onArrive({ id: body.id }) ?? true;
	window.location.hash = `#/sessions/${body.id}`;

	return true;
};

// What a new session is started with, picked where its prompt is written rather than asked after it's sent: the
// model it runs on (the default, a tier, or whatever paude suggests for the prompt) and how long it lasts. Two small
// fields for a prompt box's options: { nodes, value() → { model, lifetime } }
export const sessionChoices = () => {
	const model = element('select', 'choice');
	const lifetime = element('select', 'choice');

	for (const [key, { label, detail }] of Object.entries(MODELS))
		model.append(Object.assign(element('option', '', label), { value: key, title: detail }));
	model.append(
		Object.assign(element('option', '', 'Suggest a model'), {
			value: 'suggest',
			title: 'paude reads the prompt and picks the model that fits it',
		}),
	);
	model.title = 'The model a new session runs on';
	model.setAttribute('aria-label', 'Model');
	for (const [key, { label, detail }] of Object.entries(LIFETIMES))
		lifetime.append(Object.assign(element('option', '', label), { value: key, title: detail }));
	lifetime.title = 'How long a new session lasts';
	lifetime.setAttribute('aria-label', 'How long it lasts');

	return { nodes: [model, lifetime], value: () => ({ model: model.value, lifetime: lifetime.value }) };
};

// Finds where `prompt` belongs, in a dialog that shows it looking, then offers each place it could go; each goes
// straight into its session (or to `onArrive({ id, remote })` when given, to open it elsewhere), and a single place is
// gone to without asking, unless it's a new session, whose model is to pick. A new session here starts in the
// project's own folder, or with startFresh(project, lifetime, model) when given (resolving true once started). onSent
// once it's gone.
// `remote` ({ url, name }): the project is on that paude, so the prompt starts a session there without asking Haiku
// where it goes; this paude can't place it among sessions it doesn't have
// `model` and `lifetime`: what was already picked for a new session where the prompt was written, which the dialog's
// own pickers then start on, so nothing chosen is asked again ('suggest', or none, leaves it to the suggestion)
export const placePrompt = async ({
	prompt,
	project,
	remote,
	startFresh,
	onArrive,
	onSent,
	arcade = null,
	model,
	lifetime,
}) => {
	if (!prompt) return new Notify({ intent: 'warning', content: 'Say what Claude should do first' });

	const body = new Placing({});
	let closed = false;
	const dialog = new Dialog({
		size: 'standard',
		header: makesGame({ arcade, project, remote }) ? 'A new game' : 'Where it goes',
		body,
		buttons: ['Cancel'],
		onButtonPress: ({ closeDialog }) => closeDialog(),
		onClose: () => (closed = true),
	});
	const close = () => !closed && dialog.close();

	// Sent to the arcade with no project said: it's a new game, which was chosen when the arcade was. Made straight
	// away, what the making prints shown while it does; nothing is looked for, and nothing asked a second time
	if (makesGame({ arcade, project, remote })) {
		const progress = element('pre', 'making');

		body.elem.replaceChildren(looking('Making the game…'), progress);

		const made = await makeArcade({ name: '', idea: prompt, reading: arcade }, null, progress);

		if (!made?.id) {
			close();

			return failed(made?.error || 'The game could not be made');
		}
		onSent?.();
		close();

		return goToArcade(made.id, null);
	}

	body.elem.replaceChildren(looking('Finding the sessions it carries on…'));

	const { body: found, response } = remote
		? {
				body: {
					matches: [],
					fresh: {
						project,
						remote,
						lifetime: 'ordinary',
						model: 'default',
						why: `${project} is a project on ${remote.name}`,
					},
				},
				response: { ok: true },
			}
		: await findPromptHome(prompt, project);

	if (closed) return;
	if (!response?.ok) {
		close();

		return new Notify({ intent: 'warning', content: "Couldn't place it just now" });
	}

	const places = placesFor(found, {
		prompt,
		project,
		startFresh,
		onArrive,
		arcade,
		...carriedInto({ model, lifetime }),
	});
	const go = async (place, pressed) => {
		const buttons = [...body.elem.querySelectorAll('button.place, .model select')];

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

	if (places.length === 1 && !places[0].fresh) {
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
		body.elem.append(pressed, ...(place.after ? [place.after] : []));
	}
	body.elem.querySelector('button.place')?.focus();
};

// Home's prompt, kept until sent; the universe's new prompt, placed as from home, is the same one
export const HOME_PROMPT_KEY = 'paude.prompt';

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
