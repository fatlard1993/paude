// Several newest-first listings read as one: each source pages on its own (`({ offset, limit, ...asked })` answers
// { sessions, total }, `asked` being whatever narrows it, a q or a filter), and each page takes the newest of what they
// have. Pages come in order; asking from offset 0, or for something else, starts over.
const mergedPages = (sources, newness = session => session.lastModified ?? 0) => {
	let query;
	let states = [];

	return async ({ offset, limit, ...asked }) => {
		const key = JSON.stringify(asked);

		if (!offset || key !== query) {
			query = key;
			states = sources.map(source => ({ source, buffer: [], fetched: 0, total: Infinity }));
		}

		const current = states;

		await Promise.all(
			current.map(async state => {
				if (state.buffer.length >= limit || state.fetched >= state.total) return;

				const { sessions, total } = await state.source({ ...asked, offset: state.fetched, limit });

				state.buffer.push(...sessions);
				state.fetched += sessions.length;
				state.total = sessions.length ? total : state.fetched;
			}),
		);

		const page = [];

		while (page.length < limit) {
			const next = current
				.filter(state => state.buffer.length)
				.reduce((best, state) => (!best || newness(state.buffer[0]) > newness(best.buffer[0]) ? state : best), null);

			if (!next) break;
			page.push(next.buffer.shift());
		}

		return { sessions: page, total: current.reduce((sum, state) => sum + state.total, 0) };
	};
};

export default mergedPages;
