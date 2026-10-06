import { listSessions } from '@anthropic-ai/claude-agent-sdk';

import { activitySummary } from '../activity';
import { pinnedName } from '../names';
import { projectOf } from '../projects';
import { runningSession } from './running';

// How a session looks to one person: its watch state and unseen changes are theirs
export const toSummary =
	identity =>
	({ sessionId, summary, customTitle, lastModified, gitBranch, cwd }) => {
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
			...activitySummary(identity, sessionId, { running: Boolean(running), busy: running?.busy }),
		};
	};

export const listProjectSessions = async (cwd, identity) =>
	(await listSessions({ dir: cwd, limit: 50 })).map(toSummary(identity));

// Sessions from every project, newest first; ones whose folder is outside the projects root are left out
export const listAllSessions = async identity =>
	(await listSessions({ limit: 1000 })).map(toSummary(identity)).filter(session => session.project);
