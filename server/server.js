import router from './router/router';
import attachSocket from './sessions/attachSocket';
import sideShell from './sessions/sideShell';

const reloadSockets = {};

const reloadClients = () => {
	Object.entries(reloadSockets).forEach(([clientId, socket]) => {
		console.log(`Reloading ${clientId}`);

		socket.send('hotReload');
	});
};

export const spawnBuild = async () => {
	const buildProcess = Bun.spawn(['bun', 'run', 'build:watch']);

	for await (const chunk of buildProcess.stdout) {
		const line = new TextDecoder().decode(chunk);

		console.log(line);

		if (line === 'build.success\n') reloadClients();
	}
};

export default {
	async init({ host, port }) {
		const server = Bun.serve({
			hostname: host,
			port,
			// Nothing paude accepts comes close; the limits keep one client from tying up memory
			maxRequestBodySize: 1024 * 1024,
			fetch: router,
			websocket: {
				maxPayloadLength: 1024 * 1024,
				// Claude's redraws are mostly repeated escape sequences; compressed, they cost a fraction on a slow link
				perMessageDeflate: true,
				open(socket) {
					if (socket.data.clientId) reloadSockets[socket.data.clientId] = socket;
				},
				message(socket, message) {
					if (socket.data.route === 'attach') attachSocket.message(socket, message);
					else if (socket.data.route === 'shell') sideShell.message(socket, message);
				},
				close(socket) {
					if (socket.data.route === 'attach') attachSocket.close(socket);
					else if (socket.data.route === 'shell') sideShell.close(socket);
					else delete reloadSockets[socket.data.clientId];
				},
			},
		});

		console.log(`Listening on ${server.hostname}:${server.port}`);

		if (process.env.NODE_ENV === 'development') {
			await spawnBuild();
		}
	},
};
