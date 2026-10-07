import { Elem, styled } from '@vanilla-bean/components';

import { element } from './dom';
import { Empty } from './Layout';

const PAGE = 30;
const SEARCH_DELAY_MS = 250;

const Box = styled(
	Elem,
	({ colors }) => `
		display: flex;
		flex-direction: column;
		gap: 6px;

		.search {
			width: 100%;
			box-sizing: border-box;
		}

		.cards {
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.more {
			align-self: center;
			margin-top: 4px;
		}

		.count {
			color: ${colors.light(colors.gray)};
			font-size: 0.85em;
		}
	`,
);

// Sessions to search and page through. With nothing typed it shows the newest `firstPage` (less any the page lists
// elsewhere, `skip`); typing searches every session the list covers (title, first prompt, project, branch), and
// Show more brings the next page. `fetchPage({ q, offset, limit })` answers { sessions, total }.
const sessionList = ({ appendTo, fetchPage, renderCard, placeholder, firstPage = 8, empty }) => {
	const box = new Box({ appendTo });
	const search = Object.assign(element('input', 'search'), { type: 'search', placeholder });
	const count = element('div', 'count');
	const list = element('div', 'cards');
	const more = element('button', 'more');
	let shown = [];
	let total = 0;
	let skip = new Set();
	let timer;
	let latest = 0;

	box.elem.append(search, count, list, more);

	const query = () => search.value.trim();

	const render = () => {
		const visible = shown.filter(session => query() || !skip.has(session.id));

		list.replaceChildren();
		if (!visible.length) new Empty({ appendTo: list, textContent: query() ? 'No sessions match.' : empty });
		for (const session of visible) renderCard(session, list);

		const left = total - shown.length;

		count.textContent = query() ? `${total} matching` : '';
		more.style.display = left > 0 && (query() || shown.length >= firstPage) ? '' : 'none';
		more.textContent = left <= PAGE ? `Show all ${left}` : `Show ${PAGE} more of ${left}`;
	};

	// A newer search wins over an older one still on its way
	const load = async ({ append = false } = {}) => {
		const ask = ++latest;
		const offset = append ? shown.length : 0;
		const { sessions, total: all } = await fetchPage({
			q: query(),
			offset,
			limit: append || query() ? PAGE : firstPage,
		});

		if (ask !== latest) return;

		shown = append ? [...shown, ...sessions] : sessions;
		total = all;
		render();
	};

	search.addEventListener('input', () => {
		clearTimeout(timer);
		timer = setTimeout(() => load(), SEARCH_DELAY_MS);
	});
	more.addEventListener('click', () => load({ append: true }));

	return {
		reload: ({ exclude } = {}) => {
			skip = exclude ?? skip;

			return load();
		},
	};
};

export default sessionList;
