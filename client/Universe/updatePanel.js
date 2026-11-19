import { Notify } from '@vanilla-bean/components';

import { getUpdate, startUpdate } from '../api';
import { button, element } from '../dom';

const POLL_MS = 2000;

const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

// A machine's paude, against what it would pull: what's coming, and a button to bring it in. The installer runs it
// there, restarting that paude under itself; this polls through the restart and says how it ended.
export const updatePanel = ({ appendTo, place, addClass = [] }) => {
	const elem = element('div', ['update-panel', ...addClass].join(' '));
	let timer;
	let watching = false;

	appendTo.append(elem);

	const render = (state, { unreachable = false } = {}) => {
		elem.replaceChildren();

		const say = (text, className = '') => elem.append(element('p', className, text));
		const log = text => text && elem.append(element('pre', 'log', text));

		if (unreachable) {
			say(watching ? 'Restarting…' : "Couldn't ask it.", watching ? '' : 'error');

			return;
		}

		if (state.running) {
			say('Updating…');
			log(state.last?.log);

			return;
		}

		if (state.kind === 'development') {
			say('This paude runs a checkout in development: it updates itself as its files are saved.');

			return;
		}

		if (state.kind === 'manual') {
			say("This paude wasn't started by the installer, so it's updated where it runs: run the installer there.");

			return;
		}

		if (state.last?.exit) {
			say('The last update failed:', 'error');
			log(state.last.log);
		}

		if (!state.behind) {
			say(`Up to date${state.head ? `, at ${state.head}` : ''}.`);
			elem.append(button('Check again', () => refresh({ fresh: true }), { icon: 'rotate' }));

			return;
		}

		say(`${plural(state.behind, 'commit')} behind${state.head ? `, at ${state.head}` : ''}:`);

		const list = element('ul', 'incoming');

		for (const { sha, subject } of state.incoming) {
			const item = element('li');

			item.append(element('code', '', sha), ` ${subject}`);
			list.append(item);
		}
		if (state.behind > state.incoming.length)
			list.append(element('li', 'more', `and ${state.behind - state.incoming.length} more`));
		elem.append(list);
		elem.append(button('Update', update, { icon: 'download' }));
	};

	const poll = () => {
		clearTimeout(timer);
		if (elem.isConnected && !elem.hidden) timer = setTimeout(refresh, POLL_MS);
	};

	const settle = state => {
		if (!watching || state.running) return;
		watching = false;
		if (state.last?.exit === 0)
			new Notify({ intent: 'success', content: `Updated${state.head ? ` to ${state.head}` : ''}`, timeout: 4000 });
	};

	async function refresh({ fresh = false } = {}) {
		let answer;

		try {
			answer = await getUpdate(place, fresh);
		} catch {
			answer = {};
		}

		if (!answer.response?.ok) {
			render(null, { unreachable: true });
			if (watching) poll();

			return;
		}

		settle(answer.body);
		render(answer.body);
		if (answer.body.running || watching) poll();
	}

	async function update() {
		elem.classList.add('busy');

		const { body, response } = await startUpdate(place).catch(() => ({}));

		elem.classList.remove('busy');
		if (!response?.ok) {
			new Notify({ intent: 'danger', content: (typeof body === 'string' && body) || "Couldn't start the update" });

			return refresh();
		}

		watching = true;
		render(body);
		poll();
	}

	return { elem, refresh, stop: () => clearTimeout(timer) };
};
