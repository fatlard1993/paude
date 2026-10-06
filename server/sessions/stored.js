import { listSessions } from '@anthropic-ai/claude-agent-sdk';

import { activitySummary } from '../activity';
import { pinnedName } from '../names';
import { projectOf, projectPath } from '../projects';
import { worktreeName } from '../worktrees';
import { titleOf } from './record';
import { runningSession } from './running';

export const toSummary =
	identity =>
	({ sessionId, summary, customTitle, lastModified, gitBranch, cwd }) => {
		const running = runningSession(sessionId);

		return {
			id: sessionId,
			title: titleOf(sessionId, running, { customTitle, summary }),
			pinned: Boolean(pinnedName(sessionId)),
			lastModified,
			gitBranch,
			project: projectOf(cwd),
			worktree: worktreeName(projectPath(projectOf(cwd)), cwd),
			live: Boolean(running),
			busy: Boolean(running?.busy),
			attached: running?.clients.size ?? 0,
			...activitySummary(identity, sessionId, { running: Boolean(running), busy: running?.busy }),
		};
	};

export const listProjectSessions = async (cwd, identity) =>
	(await listSessions({ dir: cwd, limit: 50 })).map(toSummary(identity));

export const listAllSessions = async identity =>
	(await listSessions({ limit: 1000 })).map(toSummary(identity)).filter(session => session.project);
