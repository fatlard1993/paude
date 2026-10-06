/* eslint-disable no-console */

if (process.env.NODE_ENV === 'development') {
	const socket = new WebSocket(`ws://${window.location.host}/ws`);

	socket.addEventListener('message', event => {
		if (event.data === 'hotReload') window.location.reload();
	});

	socket.addEventListener('error', error => {
		console.error('WS Error:', error);

		socket.close();
	});
}
