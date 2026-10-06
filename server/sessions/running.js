import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

import { projectOf } from '../projects';
import PtySession from './PtySession';

const running = new Map();
let claudePath = 'claude';

export const setClaudePath = path => {
	claudePath = path;
};

export const runningSession = id => running.get(id);

export const allRunning = () => running.values();

// Ends a running session's Claude process and waits until it's gone; attached clients are told it ended
export const stopSession = async id => {
	const session = running.get(id);

	if (!session) return;

	session.process.kill();
	await session.process.exited;
};

const launch = options => {
	const session = new PtySession({ ...options, claudePath, onExit: ({ id }) => running.delete(id) });

	running.set(session.id, session);

	return session;
};

export const startSession = (cwd, prompt) => launch({ id: crypto.randomUUID(), cwd, resume: false, prompt });

// Brings a stored session back up in its own folder, or returns the one already running
export const openSession = async id => {
	if (running.has(id)) return running.get(id);

	const info = await getSessionInfo(id);

	if (!info?.cwd || !projectOf(info.cwd)) return null;

	// A concurrent attach may have started it while this one awaited
	return running.get(id) ?? launch({ id, cwd: info.cwd, resume: true });
};
