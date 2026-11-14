import { serve } from '@vanilla-bean/components/app';

import router from './router/router';
import attachSocket from './sessions/attachSocket';
import remoteAttach from './sessions/remoteAttach';
import sideShell from './sessions/sideShell';

// How long the client's files are left quiet before it's built again, in development. A change is rarely one write (a
// save then a format, a session's run of edits); each build offers its open pages the new version (client/newVersion.js),
// which they load when they choose. The library's own wait, said here so it's paude's to change.
export const RELOAD_QUIET_MS = 3000;

export default {
	init: ({ host, port }) =>
		serve({
			watch: { debounce: RELOAD_QUIET_MS },
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
		}),
};
