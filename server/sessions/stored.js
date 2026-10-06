import { listSessions } from '@anthropic-ai/claude-agent-sdk';

import { pinnedName } from '../names';
import { projectOf } from '../projects';
import { runningSession } from './running';

const toSummary = ({ sessionId, summary, customTitle, lastModified, gitBranch, cwd }) => {
	const running = runningSession(sessionId);

	return {
		id: sessionId,
		title: pinnedName(sessionId) || customTitle || summary,
		pinned: Boolean(pinnedName(sessionId)),
		lastModified,
		gitBranch,
		project: projectOf(cwd),
		live: Boolean(running),
		busy: Boolean(running?.busy),
		attached: running?.clients.size ?? 0,
	};
};

export const listProjectSessions = async cwd => (await listSessions({ dir: cwd, limit: 50 })).map(toSummary);

// Sessions from every project, newest first; ones whose folder is outside the projects root are left out
export const listAllSessions = async () =>
	(await listSessions({ limit: 1000 })).map(toSummary).filter(session => session.project);
