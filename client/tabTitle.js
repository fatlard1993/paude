import { serverName } from './identity';

let waiting = [];
let page = '';
let here = null;

// The page open (a session's name, a project) leads, so tabs of the same server tell apart before they truncate. The
// session open here shows its own state as a mark, so the count is of the others.
export const updateTabTitle = ({ waiting: sessions = waiting, page: named = page, here: open = here } = {}) => {
	waiting = sessions;
	page = named;
	here = open;

	const others = waiting.filter(session => session.remote || session.id !== here?.id).length;

	document.title = [
		here?.asking ? '❗' : here?.news && '●',
		others && `(${others})`,
		[page, serverName(), 'paude'].filter(Boolean).join(' · '),
	]
		.filter(Boolean)
		.join(' ');
};
