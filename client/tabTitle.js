let serverName = null;
let waiting = 0;

const render = () => {
	document.title = `${waiting ? `(${waiting}) ` : ''}${serverName ? `${serverName} · ` : ''}paude`;
};

export const setServerName = name => {
	serverName = name;
	render();
};

export const setWaiting = count => {
	waiting = count;
	render();
};
