import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'fs';
import path from 'path';

// Each Claude runs under dtach, which holds its terminal open with no parent attached: the server is one more client
// of it, so a restart (an update, a crash) doesn't end the sessions, and the next server takes them back. Without
// dtach, or without a folder set for it, sessions are the server's own children as before.
let folder = null;

export const setHolderFolder = dir => {
	folder = dir && Bun.which('dtach') ? dir : null;
	if (folder) mkdirSync(folder, { recursive: true, mode: 0o700 });
};

const files = id => ({
	socket: path.join(folder, `${id}.sock`),
	pid: path.join(folder, `${id}.pid`),
	meta: path.join(folder, `${id}.json`),
});

const alive = pid => {
	try {
		process.kill(pid, 0);

		return true;
	} catch {
		return false;
	}
};

const heldPid = id => {
	const { pid, socket } = files(id);

	if (!existsSync(pid) || !existsSync(socket)) return null;

	const number = Number(readFileSync(pid, 'utf8').trim());

	return number && alive(number) ? number : null;
};

const forget = id => {
	for (const file of Object.values(files(id))) rmSync(file, { force: true });
};

// The command that shows a session in the server's PTY: created detached first when it's new, then attached to,
// with the screen redrawn by a size change whenever someone attaches
export const heldCommand = ({ id, cwd, env, command }) => {
	if (!folder) return null;

	const { socket, pid, meta } = files(id);

	if (!heldPid(id)) {
		forget(id);
		Bun.spawnSync(
			['dtach', '-n', socket, '-E', '-z', 'sh', '-c', 'umask 077; echo $$ > "$0"; exec "$@"', pid, ...command],
			{
				cwd,
				env,
			},
		);
		writeFileSync(meta, JSON.stringify({ cwd }), { mode: 0o600 });
	}

	return ['dtach', '-a', socket, '-E', '-z', '-r', 'winch'];
};

// Ends Claude itself; the attached client then sees the session close
export const endHeld = id => {
	const pid = folder && heldPid(id);

	if (!pid) return false;

	process.kill(pid, 'SIGTERM');

	return true;
};

export const isHeld = id => Boolean(folder && heldPid(id));

// After a session ends: its files go once nothing holds it any more
export const releaseHeld = id => {
	if (folder && !heldPid(id)) forget(id);
};

// Sessions still running from before this server started: [{ id, cwd }]
export const heldSessions = async () => {
	if (!folder) return [];

	const ids = readdirSync(folder)
		.filter(name => name.endsWith('.json'))
		.map(name => name.slice(0, -'.json'.length));
	const held = [];

	for (const id of ids) {
		if (!heldPid(id)) {
			forget(id);
			continue;
		}

		held.push({ id, ...(await Bun.file(files(id).meta).json()) });
	}

	return held;
};
