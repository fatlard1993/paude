import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

import { projectOf } from '../projects';
import { heldSessions, isHeld } from './holder';
import PtySession from './PtySession';
import { forgetProposals } from './proposals';

const running = new Map();
let claudePath = 'claude';

export const setClaudePath = path => {
	claudePath = path;
};

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

export const openSession = async id => {
	if (running.has(id)) return running.get(id);

	const info = await getSessionInfo(id);

	if (!info?.cwd || !projectOf(info.cwd)) return null;

	// A concurrent attach may have started it while this one awaited
	return running.get(id) ?? launch({ id, cwd: info.cwd, resume: !isHeld(id), adopt: isHeld(id) });
};
