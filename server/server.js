import { hotReload, serve } from '@vanilla-bean/components/app';

import router from './router/router';
import attachSocket from './sessions/attachSocket';
import remoteAttach from './sessions/remoteAttach';
import sideShell from './sessions/sideShell';

// How long the client's files are left quiet before it's built again and its pages reloaded, in development. A change
// is rarely one write (a save then a format, a session's run of edits), and at the library's own tenth of a second
// each was a build and a reload of every open page, which the universe stutters through. The library's own wait is
// this from its next release, with a `watch` option on serve to set it; until paude is on that, it's set here.
export const RELOAD_QUIET_MS = 30_000;

export default {
	init: async ({ host, port }) => {
		// Watched from here, ahead of serve, which would start the watch with the library's wait: the first to start it
		// sets how long it waits, and serve's own call then only joins it
		if (process.env.NODE_ENV === 'development') await hotReload.watch(undefined, { debounce: RELOAD_QUIET_MS });

		return serve({
			hostname: host,
			port,
			// Nothing paude accepts comes close; the limits keep one client from tying up memory
			maxRequestBodySize: 1024 * 1024,
			router,
			websocket: {
				maxPayloadLength: 1024 * 1024,
				// Claude's redraws are mostly repeated escape sequences; compressed, they cost a fraction on a slow link
				perMessageDeflate: true,
				open(socket) {
					if (socket.data.route === 'remoteAttach') remoteAttach.open(socket);
				},
				message(socket, message) {
					if (socket.data.route === 'remoteAttach') remoteAttach.message(socket, message);
					else if (socket.data.route === 'attach') attachSocket.message(socket, message);
					else if (socket.data.route === 'shell') sideShell.message(socket, message);
				},
				close(socket) {
					if (socket.data.route === 'remoteAttach') remoteAttach.close(socket);
					else if (socket.data.route === 'attach') attachSocket.close(socket);
					else if (socket.data.route === 'shell') sideShell.close(socket);
				},
			},
		});
	},
};
