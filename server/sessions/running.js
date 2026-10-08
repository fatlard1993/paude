import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';
import { statSync } from 'fs';
import path from 'path';

import { projectOf } from '../projects';
import { heldSessions, isHeld } from './holder';
import PtySession from './PtySession';
import { folderOf } from './transcript';
import { forgetProposals } from './proposals';

const running = new Map();
let claudePath = 'claude';

export const setClaudePath = path => {
	claudePath = path;
};

export const claudeCommand = () => claudePath;

export const runningSession = id => running.get(id);

export const allRunning = () => running.values();

export const stopSession = async id => {
	const session = running.get(id);

	if (!session) return;

	session.end();
	await session.process.exited;
};

const launch = options => {
	const session = new PtySession({
		...options,
		claudePath,
		onExit: ({ id }) => {
			running.delete(id);
			forgetProposals(id);
		},
	});

	running.set(session.id, session);

	return session;
};

export const startSession = (cwd, prompt) => launch({ id: crypto.randomUUID(), cwd, resume: false, prompt });

// Sessions a previous server left running under dtach, taken back so they show as live and report their status
export const adoptHeldSessions = async () => {
	for (const { id, cwd } of await heldSessions()) {
		if (!running.has(id) && projectOf(cwd)) launch({ id, cwd, adopt: true });
	}
};

const isFolder = folder => statSync(folder, { throwIfNoEntry: false })?.isDirectory() ?? false;

// Where a session is taken back up: the folder the SDK names (where Claude last was) while it's there. Once it's
// gone (a worktree removed, a folder deleted), the one it began in, where Claude keeps its transcript; failing that,
// the nearest folder above either that's still there, inside the project. A missing folder fails the spawn.
export const resumeFolder = async (id, reported) => {
	if (isFolder(reported)) return reported;

	const candidates = [await folderOf(id), reported].filter(Boolean);
	const found = candidates.find(isFolder);

	if (found) return found;

	for (const start of candidates)
		for (let folder = path.dirname(start); projectOf(folder) && folder !== path.dirname(folder); folder = path.dirname(folder))
			if (isFolder(folder)) return folder;

	return null;
};

// Why each session that wouldn't start didn't, for whoever tried to open it; cleared once one does
const startFailures = new Map();

export const startFailureOf = id => startFailures.get(id);

const failedToStart = (id, why) => {
	startFailures.set(id, why);
	console.error(`Session ${id} would not start: ${why}`);

	return null;
};

export const openSession = async id => {
	if (running.has(id)) return running.get(id);

	const info = await getSessionInfo(id);

	if (!info?.cwd || !projectOf(info.cwd)) return null;

	const cwd = await resumeFolder(id, info.cwd);

	if (!cwd) return failedToStart(id, `its folder is gone (${info.cwd})`);

	try {
		// A concurrent attach may have started it while this one awaited
		const session = running.get(id) ?? launch({ id, cwd, resume: !isHeld(id), adopt: isHeld(id) });

		startFailures.delete(id);

		return session;
	} catch (error) {
		return failedToStart(id, `Claude Code couldn't be started in ${cwd}: ${error.message}`);
	}
};
