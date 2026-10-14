const OPENERS = { darwin: 'open', win32: 'explorer' };

// A link or a file, opened by this machine's own browser or app for it; false where there's nothing to open it with
const openLocally = target => {
	try {
		Bun.spawn([OPENERS[process.platform] ?? 'xdg-open', target], { stdio: ['ignore', 'ignore', 'ignore'] });

		return true;
	} catch {
		return false;
	}
};

export default openLocally;
