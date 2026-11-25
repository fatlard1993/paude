import { Notify } from '@vanilla-bean/components';
import { connectSocket } from '@vanilla-bean/components/utils/socket';

import { isNewBuild } from './builtChunks';

// The library's hot reload socket (@vanilla-bean/components/app's HOT_RELOAD_PATH, kept from the client because its
// module is the server's)
const HOT_RELOAD_PATH = '/hotReload';

let offer;

// A newer paude may be ready (its client rebuilt, or its server back after a restart); the page served now says whether
// it is. It's offered, not loaded under the person mid-prompt: the toast stays until they reload, and a later build
// doesn't stack another
const offerNewVersion = async () => {
	if (offer?.elem.isConnected) return;

	const served = await fetch('/', { cache: 'no-store' })
		.then(response => (response.ok ? response.text() : ''))
		.catch(() => '');

	if (offer?.elem.isConnected || !isNewBuild(served, document.documentElement.outerHTML)) return;

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
