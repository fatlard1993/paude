import { READING } from '../../shared/arcade';
import { readProgress, recentLines } from '../../shared/progress';
import { Notify } from '@vanilla-bean/components';

import { openRemote } from '../api';
import { element } from '../dom';
import { forget, recall, remember } from '../storage';

// Making a new arcade game, from wherever a page offers it (the home page's card, the universe's dock): the game
// made on this paude or on another this machine is logged into, where it then lives and runs, and the browser taken
// to its arcade there.

// A select of where the game is made: 'Here', and each of `remotes` ({ name, url }); hidden when there's only here
export const whereSelect = remotes => {
	const where = element('select', 'where');

	where.replaceChildren(
		...[{ url: '', name: 'Here' }, ...remotes].map(remote => {
			const option = element('option', '', remote.url ? `On ${remote.name}` : 'Here');

			option.value = remote.url;

			return option;
		}),
	);
	// Not the hidden attribute: the field's own display rule outranks it
	where.style.display = remotes.length ? '' : 'none';
	where.title = 'Which paude makes the game: the game lives and runs there';

	return where;
};

// A select of how Claude writes to the person building, and a line saying what that means
export const readingSelect = () => {
	const reading = element('select');
	const hint = element('div', 'meta');

	for (const [key, { label }] of Object.entries(READING)) {
		const option = element('option', '', label);

		option.value = key;
		reading.append(option);
	}
	reading.value = 'reading';
	reading.title = 'How Claude writes to whoever is building';
	hint.textContent = READING[reading.value].detail;
	reading.addEventListener('change', () => (hint.textContent = READING[reading.value].detail));

	return { reading, hint };
};

// Makes the game ({ name, idea, reading }, name and idea each optional) here, or on `remote` ({ name, url }); what the making prints goes to
// `progress` (a pre) as it comes. { id } once its session runs, or { error }.
export const makeArcade = async (game, remote, progress) => {
	const response = await fetch(remote ? '/api/remotes/arcade' : '/api/arcade', {
		method: 'POST',
		headers: { 'content-type': 'application/json' },
		body: JSON.stringify(remote ? { url: remote.url, ...game } : game),
	}).catch(() => null);

	if (!response) return { error: 'Could not reach the server.' };
	if (!response.ok) return { error: await response.text() };

	let output = '';

	return readProgress(response, arrived => {
		output += arrived;
		if (!progress) return;
		progress.textContent = recentLines(output, 10).join('\n');
		progress.scrollTop = progress.scrollHeight;
	});
};

// To the game's arcade: on this page, or logged in on the other paude's
export const goToArcade = async (id, remote) => {
	if (!remote) {
		window.location.hash = `#/arcade/${id}`;

		return true;
	}

	const { body, response } = await openRemote(remote.url, { arcade: id });

	if (!response?.ok) return false;
	window.location.href = body.link;

	return true;
};

const DRAFT_KEY = 'paude.arcade.draft';

const savedDraft = () => {
	try {
		return JSON.parse(recall(DRAFT_KEY) || '{}') ?? {};
	} catch {
		return {};
	}
};

// The form that makes a game, the same wherever it's offered (the home page's card, the ship's dock): what it's
// called if that's known, the idea so far if there is one, how Claude writes, and where it's made (who's building
// is whoever made it, and Claude is told who's in the session as that changes)
// (`remotes`, { name, url }, hidden until there are any). Making it streams into the progress line; made, the browser
// goes to its arcade, and `onMade` hears. { form, hint, setRemotes, reset, focus }: `hint` is the form's last child,
// for whoever adds a button before it. `asMaker`: for a game maker, who builds as themself, here: no
// reading or place to pick. What's typed in it is kept in this browser until the game is made, so closing it or leaving the
// page doesn't lose it.
export const newArcadeForm = ({ remotes = [], onMade, asMaker = false } = {}) => {
	const form = element('form', 'new-arcade');
	const name = element('input');
	const idea = element('textarea');
	const { reading, hint } = readingSelect();
	const make = element('button', '', 'Make it');
	const progress = element('pre', 'progress');
	let where = whereSelect(remotes);
	let known = remotes;
	let busy = false;

	name.placeholder = "What's it called? (optional: Claude can help name it)";
	name.maxLength = 60;
	idea.placeholder =
		'The idea, as rough or detailed as you like (optional: leave it blank to brainstorm one with Claude)';
	idea.rows = 2;
	idea.maxLength = 4000;
	progress.style.display = 'none';
	const draft = savedDraft();

	name.value = draft.name ?? '';
	idea.value = draft.idea ?? '';
	form.addEventListener('input', () => {
		const typed = { name: name.value, idea: idea.value };

		if (Object.values(typed).some(Boolean)) remember(DRAFT_KEY, JSON.stringify(typed));
		else forget(DRAFT_KEY);
	});
	form.append(...(asMaker ? [name, idea, make, progress] : [name, idea, reading, where, make, progress, hint]));

	const reset = () => {
		name.value = '';
		idea.value = '';
		forget(DRAFT_KEY);
		progress.textContent = '';
		progress.style.display = 'none';
	};

	form.addEventListener('submit', async event => {
		event.preventDefault();
		if (busy) return;
		busy = true;
		make.disabled = true;
		progress.textContent = '';
		progress.style.display = 'block';

		const remote = known.find(other => other.url && other.url === where.value) ?? null;
		const made = await makeArcade(
			{ name: name.value.trim(), idea: idea.value.trim(), reading: reading.value },
			remote,
			progress,
		);

		busy = false;
		make.disabled = false;
		if (!made?.id) {
			progress.style.display = 'none';
			new Notify({ intent: 'danger', content: made?.error || 'The game could not be made.' });

			return;
		}
		reset();
		onMade?.(made, remote);
		if (!(await goToArcade(made.id, remote)))
			new Notify({ intent: 'danger', content: `The game is made, but ${remote.name} could not be opened from here.` });
	});

	return {
		form,
		hint,
		// The paudes to pick from, found later or again; a pick already made is kept when it's still among them
		setRemotes: found => {
			known = found;

			const picker = whereSelect(found);

			picker.value = found.some(remote => remote.url === where.value) ? where.value : '';
			where.replaceWith(picker);
			where = picker;
		},
		reset,
		focus: () => name.focus({ preventScroll: true }),
	};
};
