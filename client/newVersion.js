import { Notify } from '@vanilla-bean/components';
import { connectSocket } from '@vanilla-bean/components/utils/socket';

// The library's hot reload socket (@vanilla-bean/components/app's HOT_RELOAD_PATH, kept from the client because its
// module is the server's)
const HOT_RELOAD_PATH = '/hotReload';

let offer;

// A newer paude is ready (its client rebuilt, or its server back after a restart). It's offered, not loaded under the
// person mid-prompt: the toast stays until they reload, and a later build doesn't stack another
const offerNewVersion = () => {
	if (offer?.elem.isConnected) return;

	offer = new Notify({
		intent: 'info',
		icon: 'rotate-right',
		timeout: 0,
		content: 'A new version of paude is ready',
		actions: [{ textContent: 'Reload', onPointerPress: () => window.location.reload() }],
	});
};

// The library's reloadOnBuild, holding its reload. A page that never connected is served by something that isn't
// watching, and isn't retried.
export const offerNewVersions = () => {
	let connected = false;
	const socket = connectSocket(HOT_RELOAD_PATH, { onRestored: offerNewVersion });

	socket.addEventListener('open', () => (connected = true));
	socket.addEventListener('close', () => {
		if (!connected) socket.close();
	});
	socket.onMessage(data => data === 'hotReload' && offerNewVersion());
};
