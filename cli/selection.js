// The text this person last selected in their terminal. On Linux that's the primary selection, which selecting
// fills without a copy; macOS has none, so it's whatever was last copied.
const READERS = [
	process.env.WAYLAND_DISPLAY && ['wl-paste', '--primary', '--no-newline'],
	process.env.DISPLAY && ['xclip', '-o', '-selection', 'primary'],
	process.platform === 'darwin' && ['pbpaste'],
].filter(Boolean);

const readSelection = () => {
	for (const command of READERS) {
		try {
			const { success, stdout } = Bun.spawnSync(command, { stdout: 'pipe', stderr: 'ignore', timeout: 1000 });

			if (success && stdout.length) return stdout.toString();
		} catch {
			// That reader isn't installed; try the next
		}
	}

	return null;
};

export default readSelection;
