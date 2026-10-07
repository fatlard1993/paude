import { serverName } from './identity';

let waiting = 0;

export const updateTabTitle = ({ waiting: count = waiting } = {}) => {
	waiting = count;
	document.title = `${waiting ? `(${waiting}) ` : ''}${serverName() ? `${serverName()} · ` : ''}paude`;
};
