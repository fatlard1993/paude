import os from 'os';
import { resolve } from 'path';

import { sessionHue } from '../../shared/hues';

import { activitySummary } from '../activity';
import { backgroundKnown } from '../backgroundWork';
import { limitOf } from '../usageLimit';
import { lastSwitch, lifetimeOf } from '../lifetime';
import { projectOf, projectPath } from '../projects';
import { worktreeName } from '../worktrees';
import { isArchived } from '../archive';
import { titleOf } from './record';
import { allRunning, runningSession } from './running';
import { carriesOn, firstPromptOf, folderOf, resumeId } from './transcript';

const FIRST_PROMPT_PREVIEW = 200;

// The machine's own sessions are those started in its home folder, outside any project: a tidy-up of the whole machine
export const isHomeFolder = folder => Boolean(folder) && resolve(folder) === resolve(os.homedir());

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
			...(!project && isHomeFolder(cwd) && { home: true }),
			worktree: worktreeName(projectPath(project), cwd),
			hue: sessionHue(sessionId),
			live: Boolean(running),
			busy: Boolean(running?.busy),
			attached: running?.clients.size ?? 0,
			...activitySummary(identity, sessionId, { running: Boolean(running), busy: running?.busy, project }),
			asking: running?.asking() ?? undefined,
			// How many things it has running in the background that Claude will be woken by
			background: (running && backgroundKnown(sessionId).length) || undefined,
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

const belongs = folder => Boolean(projectOf(folder)) || isHomeFolder(folder);

// Each listed session followed to where Claude carried it on, so carriesOn knows every continuation (a transcript's end
// is read once, then only what it has grown by). Claude's own list leaves out a session it carried on elsewhere: one
// shows beside its continuation only while paude runs it, listed as running.
const followed = async sessions => {
	await Promise.all(
		sessions
			.filter(session => belongs(session.cwd))
			.map(session => resumeId(session.sessionId, session.cwd).catch(() => null)),
	);

	return sessions;
};

const listStored = async () =>
	Promise.all(
		(await listSessions()).map(async session =>
			session.cwd ? session : { ...session, cwd: await folderOf(session.sessionId) },
		),
	);

// A session Claude carried on under a new id (moved to the background) is the same session: listed once, as the id
// paude started it as, last modified when the conversation last was wherever it went. One whose first id is no longer
// listed stands for itself, and so does each of a loop of moves, none of them the first.
export const foldContinuations = (sessions, firstOf = carriesOn) => {
	const listed = new Map(sessions.map(session => [session.sessionId, session]));
	const firstListed = session => {
		const first = firstOf(session.sessionId);

		return first && listed.has(first) && !firstOf(first) ? first : null;
	};
	const latest = new Map();

	for (const session of sessions) {
		const first = firstListed(session);

		if (first) latest.set(first, Math.max(latest.get(first) ?? 0, session.lastModified ?? 0));
	}

	return sessions
		.filter(session => !firstListed(session))
		.map(session =>
			latest.get(session.sessionId) > (session.lastModified ?? 0)
				? { ...session, lastModified: latest.get(session.sessionId) }
				: session,
		)
		.sort((a, b) => (b.lastModified ?? 0) - (a.lastModified ?? 0));
};

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
	foldContinuations(await followed(withUnsaved(await withFirstPrompts(await storedSessions()), belongs)))
		.map(toSummary(identity))
		.filter(session => session.project || session.home);

// The project's sessions, as its count on the projects page has them: those in its folders below too, not only the
// ones started at its top
export const listProjectSessions = async (cwd, identity) => {
	const project = projectOf(cwd);

	return (await listAllSessions(identity)).filter(session => session.project === project);
};
