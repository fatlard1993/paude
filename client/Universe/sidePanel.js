// When the universe opens a session's side panel of its own accord

// After a reply sent from a session's card: closed once it's gone, and a stopped one, which the reply wakes, opened in
// its side panel; a reply that didn't go leaves the card up and opens nothing. { close, wake }
export const afterReply = (session, sent) => ({ close: sent, wake: sent && session.status === 'stopped' });

// A session just placed, waited for: `arriving` ({ key, until }), the workers aboard by key, and the time. The worker
// to open once it's aboard, and what's still waited for: { worker, arriving }; past `until`, given up on
export const arrivalOf = (arriving, workers, now) => {
	if (!arriving || now > arriving.until) return { worker: null, arriving: null };

	const worker = workers.get(arriving.key);

	return worker ? { worker, arriving: null } : { worker: null, arriving };
};
