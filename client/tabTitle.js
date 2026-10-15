import { serverName } from './identity';

let waiting = 0;
let page = '';

// The page open (a session's name, a project) leads, so tabs of the same server tell apart before they truncate
export const updateTabTitle = ({ waiting: count = waiting, page: named = page } = {}) => {
	waiting = count;
	page = named;
	document.title = `${waiting ? `(${waiting}) ` : ''}${[page, serverName(), 'paude'].filter(Boolean).join(' · ')}`;
};
