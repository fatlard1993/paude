import { readdir } from 'fs/promises';
import { join } from 'path';

import { claudeHome } from './transcript';

const alive = pid => {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return error.code === 'EPERM';
	}
};

// The Claude Code process that has this conversation open, from the note each one keeps in Claude's sessions folder
// (<pid>.json, naming its session): { pid, kind, jobId }, or null for none still alive. A note left by a process that
// died is passed over.
export const claudeHolding = async (id, { isAlive = alive } = {}) => {
	const folder = join(claudeHome(), 'sessions');
	const names = (await readdir(folder).catch(() => [])).filter(name => name.endsWith('.json'));

	for (const name of names) {
		const note = await Bun.file(join(folder, name))
			.json()
			.catch(() => null);

		if (note?.sessionId === id && Number.isInteger(note.pid) && isAlive(note.pid))
			return { pid: note.pid, kind: note.kind, jobId: note.jobId };
	}

	return null;
};

// Why paude won't take it up too, in words for whoever tried to open it
export const heldWhy = ({ pid, kind, jobId }) =>
	kind === 'bg' && jobId
		? `it's running in Claude Code's background; \`claude attach ${jobId}\` reaches it there, and \`claude stop ${jobId}\` hands it back to paude`
		: `it's open in another Claude Code (pid ${pid}); close that one first`;
