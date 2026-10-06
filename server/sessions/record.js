import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

import { pinnedName } from '../names';
import { projectOf } from '../projects';
import { runningSession } from './running';

// One name for a session everywhere: a pinned name, then the one Claude keeps up to date
export const titleOf = (id, running, stored) =>
	pinnedName(id) || running?.title || stored?.customTitle || stored?.summary || '';

// A session in one of the projects: { id, cwd, running, stored, title }, or null for anything else
export const sessionRecord = async id => {
	const running = runningSession(id);
	const stored = await getSessionInfo(id);
	const cwd = running?.cwd ?? stored?.cwd;

	return projectOf(cwd) ? { id, cwd, running, stored, title: titleOf(id, running, stored) } : null;
};
