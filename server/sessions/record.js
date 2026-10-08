import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

import { pinnedName } from '../names';
import { projectOf } from '../projects';
import { runningSession } from './running';
import { folderOf } from './transcript';

// One name for a session everywhere: a pinned name, then the one Claude keeps up to date
// A running session nothing has named yet is one nobody has prompted
export const titleOf = (id, running, stored) =>
	pinnedName(id) || running?.title || stored?.customTitle || stored?.summary || (running ? 'New session' : '');

// A session in one of the projects: { id, cwd, running, stored, title }, or null for anything else
export const sessionRecord = async id => {
	const running = runningSession(id);
	const stored = await getSessionInfo(id);
	const cwd = running?.cwd ?? stored?.cwd ?? (stored ? await folderOf(id) : undefined);

	return projectOf(cwd) ? { id, cwd, running, stored, title: titleOf(id, running, stored) } : null;
};
