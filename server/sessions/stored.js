import { listSessions } from '@anthropic-ai/claude-agent-sdk';

import { sessionHue } from '../../shared/hues';

import { activitySummary } from '../activity';
import { limitOf } from '../usageLimit';
import { isBrief } from '../briefSessions';
import { pinnedName } from '../names';
import { projectOf, projectPath } from '../projects';
import { worktreeName } from '../worktrees';
import { titleOf } from './record';
import { allRunning, runningSession } from './running';
import { firstPromptOf, folderOf } from './transcript';

const FIRST_PROMPT_PREVIEW = 200;

export const toSummary =
	identity =>
	({ sessionId, summary, customTitle, firstPrompt, lastModified, gitBranch, cwd }) => {
		const running = runningSession(sessionId);

		return {
			id: sessionId,
			title: titleOf(sessionId, running, { customTitle, summary }),
			pinned: Boolean(pinnedName(sessionId)),
			lastModified,
			gitBranch,
			firstPrompt: firstPrompt?.slice(0, FIRST_PROMPT_PREVIEW),
			project: projectOf(cwd),
			worktree: worktreeName(projectPath(projectOf(cwd)), cwd),
			hue: sessionHue(sessionId),
			live: Boolean(running),
			busy: Boolean(running?.busy),
			attached: running?.clients.size ?? 0,
			...activitySummary(identity, sessionId, { running: Boolean(running), busy: running?.busy }),
			asking: running?.asking() ?? undefined,
			limit: limitOf(sessionId) ?? undefined,
			brief: isBrief(sessionId) || undefined,
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

// The SDK doesn't always fill in a session's first prompt; the transcript has it
const withFirstPrompts = async sessions =>
	Promise.all(
		sessions.map(async session =>
			session.firstPrompt ? session : { ...session, firstPrompt: await firstPromptOf(session.sessionId, session.cwd) },
		),
	);

// Every saved session, each with its folder: the SDK leaves out the folder of one whose transcript opens with a long
// run of bookkeeping, and such a session would belong to no project (listed by none, opened and deleted by none)
export const storedSessions = async () =>
	Promise.all(
		(await listSessions()).map(async session =>
			session.cwd ? session : { ...session, cwd: await folderOf(session.sessionId) },
		),
	);

export const listAllSessions = async identity =>
	withUnsaved(await withFirstPrompts(await storedSessions()), folder => Boolean(projectOf(folder)))
		.map(toSummary(identity))
		.filter(session => session.project);

// The project's sessions, as its count on the projects page has them: those in its folders below too, not only the
// ones started at its top
export const listProjectSessions = async (cwd, identity) => {
	const project = projectOf(cwd);

	return (await listAllSessions(identity)).filter(session => session.project === project);
};
