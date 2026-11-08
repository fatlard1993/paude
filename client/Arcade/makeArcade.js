import { READING } from '../../shared/arcade';
import { readProgress, recentLines } from '../../shared/progress';
import { openRemote } from '../api';
import { element } from '../dom';

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

// A select of how well the person building reads, and a line saying what that means
export const readingSelect = () => {
	const reading = element('select');
	const hint = element('div', 'meta');

	for (const [key, { label }] of Object.entries(READING)) {
		const option = element('option', '', label);

		option.value = key;
		reading.append(option);
	}
	reading.value = 'learning';
	hint.textContent = READING[reading.value].detail;
	reading.addEventListener('change', () => (hint.textContent = READING[reading.value].detail));

	return { reading, hint };
};

// Makes the game ({ name, player, reading }) here, or on `remote` ({ name, url }); what the making prints goes to
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
