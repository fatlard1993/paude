import { join } from 'path';

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

const BUILD_WATCHER = 'client/build.js --watch';

// A restart that doesn't run exit handlers (bun --watch, bun --hot) leaves the last watcher running; it goes first.
// The pid is checked against what it runs before anything is killed, in case the number has been reused since.
const stopPreviousWatcher = async pidFile => {
	const pid = Number((await Bun.file(pidFile).exists()) ? (await Bun.file(pidFile).text()).trim() : '');

	if (!pid) return;

	const running = Bun.spawnSync(['ps', '-o', 'command=', '-p', String(pid)], { stdout: 'pipe', stderr: 'ignore' });

	if (running.stdout.toString().includes(BUILD_WATCHER)) process.kill(pid, 'SIGTERM');
};

// One client build watcher for the life of a development server, reloading open pages after each build
export const spawnBuild = async dataDir => {
	const pidFile = join(dataDir, 'build-watch.pid');

	await stopPreviousWatcher(pidFile);

	const buildProcess = Bun.spawn(['bun', ...BUILD_WATCHER.split(' ')], { stdout: 'pipe' });

	await Bun.write(pidFile, String(buildProcess.pid));
	process.on('exit', () => buildProcess.kill());

	for await (const chunk of buildProcess.stdout) {
		const line = new TextDecoder().decode(chunk);

		console.log(line);

		if (line === 'build.success\n') reloadClients();
	}
};

export default {
	async init({ host, port, data }) {
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
			await spawnBuild(data);
		}
	},
};
