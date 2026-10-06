import { existsSync } from 'fs';
import path from 'path';

import { showsImages } from './graphics';
import readSelection from './selection';
import { bold, dim, green, orange } from './screen';
import { allServers, api, localStatus } from './servers';

const REPO = path.join(import.meta.dir, '..');

const has = command => Boolean(Bun.which(command));

const version = command => {
	try {
		return Bun.spawnSync([command, '--version'], { stdout: 'pipe', stderr: 'ignore', timeout: 5000 })
			.stdout.toString()
			.trim()
			.split('\n')[0];
	} catch {
		return null;
	}
};

const KITTY = Boolean(process.env.KITTY_WINDOW_ID) || process.env.TERM === 'xterm-kitty';

// What works here and what doesn't, each with what to do about it
const checks = async () => {
	const local = await localStatus();
	const rows = [
		['Bun', true, Bun.version],
		[
			'Claude Code',
			has('claude'),
			has('claude') ? version('claude') : 'install it, then log in: https://claude.com/claude-code',
		],
		[
			'curl',
			has('curl'),
			has('curl') ? 'sessions can report working, needs you and ready' : 'install curl, or sessions show no status',
		],
		[
			'dtach',
			has('dtach'),
			has('dtach')
				? 'sessions keep running through a server restart'
				: 'install dtach (apt or brew) so sessions survive restarts and updates',
		],
		[
			'Web client',
			existsSync(path.join(REPO, 'client/build/index.html')),
			existsSync(path.join(REPO, 'client/build/index.html')) ? 'built' : 'run bun run build in the paude folder',
		],
		["This machine's paude", local.ok, local.detail],
		[
			'Images in the terminal',
			showsImages() && (has('magick') || has('convert')),
			showsImages()
				? has('magick') || has('convert')
					? 'kitty graphics, with ImageMagick for formats other than PNG'
					: 'PNG only: install ImageMagick for the rest'
				: 'needs kitty, WezTerm or Ghostty',
		],
		[
			'Commenting on a selection',
			!readSelection.unavailable,
			readSelection.unavailable
				? 'install wl-clipboard (Wayland) or xclip (X11)'
				: 'reads what you select in the terminal',
		],
		[
			'Notifications',
			KITTY || ['iTerm.app', 'WezTerm', 'ghostty'].includes(process.env.TERM_PROGRAM),
			'kitty, iTerm2, WezTerm and Ghostty show them; other terminals ignore them',
		],
	];

	for (const server of await allServers().catch(() => [])) {
		if (server.local) continue;

		try {
			const { identity } = await api(server, '/api/auth');

			rows.push([
				`Login: ${server.label}`,
				Boolean(identity),
				identity ? (identity.owner ? 'owner' : `guest (${identity.role})`) : 'ended: log in again',
			]);
		} catch (error) {
			rows.push([`Login: ${server.label}`, false, error.message]);
		}
	}

	return rows;
};

const doctor = async () => {
	for (const [name, ok, detail] of await checks()) {
		console.log(`${ok ? green('✓') : orange('✗')} ${bold(name)}  ${dim(detail ?? '')}`);
	}
};

export default doctor;
