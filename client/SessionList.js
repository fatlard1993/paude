import { Elem, styled } from '@vanilla-bean/components';

import { element } from './dom';
import { Empty } from './Layout';

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

		.pager {
			display: flex;
			align-items: center;
			justify-content: center;
			gap: 12px;
			margin-top: 4px;
		}

		.pager .where {
			color: ${colors.light(colors.gray)};
			font-size: 0.85em;
			font-variant-numeric: tabular-nums;
		}

		.count {
			color: ${colors.light(colors.gray)};
			font-size: 0.85em;
		}
	`,
);

// Sessions to search and page through, `pageSize` at a time: with nothing typed the newest (less any the page lists
// elsewhere, `skip`); typing searches every session the list covers (title, first prompt, project, branch).
// `fetchPage({ q, offset, limit })` answers { sessions, total }, in order: pages seen are kept, so going back asks
// for nothing and going on asks only for what follows.
const sessionList = ({ appendTo, fetchPage, renderCard, placeholder, pageSize = 8, empty }) => {
	const box = new Box({ appendTo });
	const search = Object.assign(element('input', 'search'), { type: 'search', placeholder });
	const count = element('div', 'count');
	const list = element('div', 'cards');
	const pager = element('div', 'pager');
	const previous = element('button', 'previous', '‹ Prev');
	const where = element('span', 'where');
	const next = element('button', 'next', 'Next ›');
	let loaded = [];
	let fetched = 0;
	let total = 0;
	let page = 0;
	let skip = new Set();
	let timer;
	let latest = 0;

	pager.append(previous, where, next);
	box.elem.append(search, count, list, pager);

	const query = () => search.value.trim();
	const wanted = session => query() || !skip.has(session.id);
	// What the list holds once those listed elsewhere are left out
	const listed = () => Math.max(query() ? total : total - skip.size, loaded.length);

	const render = () => {
		const first = page * pageSize;
		const shown = loaded.slice(first, first + pageSize);
		const all = listed();

		list.replaceChildren();
		if (!shown.length) new Empty({ appendTo: list, textContent: query() ? 'No sessions match.' : empty });
		for (const session of shown) renderCard(session, list);

		count.textContent = query() ? `${total} matching` : '';
		pager.style.display = all > pageSize ? '' : 'none';
		where.textContent = `${first + 1}–${first + shown.length} of ${all}`;
		previous.disabled = page === 0;
		next.disabled = first + pageSize >= all;
	};

	// Pages fetched until `page` is full or there's no more; a newer search or page wins over an older one
	const load = async (to, { fresh = false } = {}) => {
		const ask = ++latest;

		if (fresh) {
			loaded = [];
			fetched = 0;
			total = Infinity;
		}

		while (loaded.length < (to + 1) * pageSize && fetched < total) {
			const { sessions, total: all } = await fetchPage({ q: query(), offset: fetched, limit: pageSize });

			if (ask !== latest) return;

			total = sessions.length ? all : fetched;
			fetched += sessions.length;
			loaded.push(...sessions.filter(wanted));
		}

		page = Math.min(to, Math.max(Math.ceil(loaded.length / pageSize) - 1, 0));
		render();
	};

	search.addEventListener('input', () => {
		clearTimeout(timer);
		timer = setTimeout(() => load(0, { fresh: true }), SEARCH_DELAY_MS);
	});
	previous.addEventListener('click', () => load(page - 1));
	next.addEventListener('click', () => load(page + 1));

	return {
		reload: ({ exclude } = {}) => {
			skip = exclude ?? skip;

			return load(0, { fresh: true });
		},
	};
};

export default sessionList;
