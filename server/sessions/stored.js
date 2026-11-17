import { sessionHue } from '../../shared/hues';

import { activitySummary } from '../activity';
import { limitOf } from '../usageLimit';
import { lastSwitch, lifetimeOf } from '../lifetime';
import { projectOf, projectPath } from '../projects';
import { worktreeName } from '../worktrees';
import { isArchived } from '../archive';
import { titleOf } from './record';
import { allRunning, runningSession } from './running';
import { firstPromptOf, folderOf } from './transcript';

const FIRST_PROMPT_PREVIEW = 200;

export const toSummary =
	identity =>
	({ sessionId, summary, customTitle, firstPrompt, lastModified, gitBranch, cwd }) => {
		const running = runningSession(sessionId);
		const project = projectOf(cwd);

		return {
			id: sessionId,
			title: titleOf(sessionId, running, { customTitle, summary }),
			lastModified,
			gitBranch,
			firstPrompt: firstPrompt?.slice(0, FIRST_PROMPT_PREVIEW),
			project,
			worktree: worktreeName(projectPath(project), cwd),
			hue: sessionHue(sessionId),
			live: Boolean(running),
			busy: Boolean(running?.busy),
			attached: running?.clients.size ?? 0,
			...activitySummary(identity, sessionId, { running: Boolean(running), busy: running?.busy, project }),
			asking: running?.asking() ?? undefined,
			limit: limitOf(sessionId) ?? undefined,
			lifetime: lifetimeOf(sessionId),
			// One running is in use, whatever was decided about it before
			archived: !running && isArchived(sessionId),
			switched: lastSwitch(sessionId) ?? undefined,
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

// The SDK reads the head and tail of every transcript on disk to list them, a fifth of a second or more for a few hundred
// sessions, done in a worker so the server answers meanwhile; and every open page asks for lists every few seconds:
// one listing serves every ask for a while. Running sessions are added to it as they are (withUnsaved), so a new one shows at once.
export const STORED_MS = 10_000;
let listing = null;

export const forgetStoredSessions = () => {
	listing = null;
};

let worker = null;
let asked = 0;
const waiting = new Map();

const listSessions = () =>
	new Promise((resolve, reject) => {
		if (!worker) {
			worker = new Worker(new URL('./listingWorker.js', import.meta.url));
			worker.unref();
			worker.onmessage = ({ data: { id, sessions, error } }) => {
				const asker = waiting.get(id);

				waiting.delete(id);
				if (error) asker?.reject(new Error(error));
				else asker?.resolve(sessions);
			};
			worker.onerror = event => {
				for (const asker of waiting.values()) asker.reject(new Error(event.message || 'Listing sessions failed'));
				waiting.clear();
				worker.terminate();
				worker = null;
			};
		}

		asked += 1;
		waiting.set(asked, { resolve, reject });
		worker.postMessage({ id: asked, configDir: process.env.CLAUDE_CONFIG_DIR });
	});

const listStored = async () =>
	Promise.all(
		(await listSessions()).map(async session =>
			session.cwd ? session : { ...session, cwd: await folderOf(session.sessionId) },
		),
	);

// Every saved session, each with its folder: the SDK leaves out the folder of one whose transcript opens with a long
// run of bookkeeping, and such a session would belong to no project (listed by none, opened and deleted by none)
export const storedSessions = async ({ now = Date.now(), list = listStored } = {}) => {
	if (!listing || now - listing.at >= STORED_MS) {
		const sessions = list();

		listing = { at: now, sessions };
		sessions.catch(() => {
			if (listing?.sessions === sessions) listing = null;
		});
	}

	return listing.sessions;
};

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
