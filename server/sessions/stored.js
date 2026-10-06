import { listSessions } from '@anthropic-ai/claude-agent-sdk';

import { activitySummary } from '../activity';
import { pinnedName } from '../names';
import { projectOf, projectPath } from '../projects';
import { worktreeName } from '../worktrees';
import { titleOf } from './record';
import { allRunning, runningSession } from './running';

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

// Claude saves a session once it's first prompted, so one that's running but hasn't been asked anything yet isn't in
// its list. The running ones are added, so a list never shows less than what's running.
const withUnsaved = (saved, belongs) => {
	const listed = new Set(saved.map(({ sessionId }) => sessionId));
	const unsaved = [...allRunning()]
		.filter(session => !listed.has(session.id) && belongs(session.cwd))
		.map(session => ({ sessionId: session.id, cwd: session.cwd, lastModified: session.startedAt }));

	return [...unsaved, ...saved].sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
};

export const listProjectSessions = async (cwd, identity) =>
	withUnsaved(await listSessions({ dir: cwd, limit: 50 }), folder => projectOf(folder) === projectOf(cwd)).map(
		toSummary(identity),
	);

export const listAllSessions = async identity =>
	withUnsaved(await listSessions({ limit: 1000 }), folder => Boolean(projectOf(folder)))
		.map(toSummary(identity))
		.filter(session => session.project);
