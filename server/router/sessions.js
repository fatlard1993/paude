import { deleteSession, forkSession, listSessions } from '@anthropic-ai/claude-agent-sdk';

import { activitySummary, forgetActivity, setWatching, watchedBy } from '../activity';
import { credentialOf, identityOf, revokeInvitesFor } from '../auth';
import { matchesQuery } from '../../shared/sessionSearch';
import { pinName, pinnedName } from '../names';
import { may } from '../permissions';
import { listRemotes, remoteLink, remoteSessions } from '../remotes';
import { mayListRemotes } from '../serverSettings';
import { deleteNotes } from '../notes';
import { sessionTurns } from '../sessions/history';
import {
	FolderError,
	listProjects,
	projectOf,
	projectPath,
	addFolders,
	registeredFolders,
	removeProject,
} from '../projects';
import { sessionRecord } from '../sessions/record';
import { listAllSessions, listProjectSessions, toSummary } from '../sessions/stored';
import { allRunning, openSession, runningSession, startSession, stopSession } from '../sessions/running';
import {
	WorktreeError,
	checkoutsOf,
	createWorktree,
	joinWorktree,
	releaseWorktree,
	validWorktreeName,
} from '../worktrees';
import { markProjectLink, projectLinks } from '../links';
import requestMatch from '../utils/requestMatch';

const isFolder = async path =>
	Boolean(
		path &&
		(
			await Bun.file(path)
				.stat()
				.catch(() => null)
		)?.isDirectory(),
	);

// A page of sessions, newest first, narrowed by ?q= (see matchesQuery); x-total-count says how many match in all
const sessionPage = (sessions, { q, offset, limit }, pageSize) => {
	const matching = sessions.filter(session => matchesQuery(session, q));
	const from = Math.max(Number(offset) || 0, 0);
	const count = Math.min(Math.max(Number(limit) || pageSize, 1), 500);

	return Response.json(matching.slice(from, from + count), { headers: { 'x-total-count': String(matching.length) } });
};

const runningFolders = () => [...allRunning()].map(session => session.cwd);

// A worktree named from the first words of the prompt, or at random when there is none
const worktreeNameFor = text => {
	const words = (text ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, ' ')
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 4)
		.join('-')
		.slice(0, 40)
		.replace(/-+$/, '');

	return words || `session-${crypto.randomUUID().slice(0, 6)}`;
};

// Making a worktree can take minutes (a repo's own setup), so the answer streams: { output } lines as the command
// prints them, then { id } for the new session or { error }. A quiet stretch sends { waiting }, or the connection
// would be dropped as idle. A reader who leaves doesn't stop the worktree being made; only the session waits.
const HEARTBEAT_MS = 5000;

const creatingSession = (create, text) => {
	const encoder = new TextEncoder();
	let open = true;
	let heartbeat;

	return new Response(
		new ReadableStream({
			async start(controller) {
				const send = message => {
					if (!open) return;

					try {
						controller.enqueue(encoder.encode(`${JSON.stringify(message)}\n`));
					} catch {
						open = false;
					}
				};

				heartbeat = setInterval(() => send({ waiting: true }), HEARTBEAT_MS);

				try {
					const folder = await create(output => output && send({ output }));

					if (open) send({ id: startSession(folder, text?.trim()).id });
				} catch (error) {
					if (!(error instanceof WorktreeError)) console.error('A worktree could not be made', error);
					send({ error: error instanceof WorktreeError ? error.message : 'The worktree could not be made.' });
				}

				clearInterval(heartbeat);
				if (open) controller.close();
			},
			cancel() {
				open = false;
				clearInterval(heartbeat);
			},
		}),
		{ headers: { 'content-type': 'application/x-ndjson', 'cache-control': 'no-cache' } },
	);
};

const sessionsRoutes = async (request, server) => {
	let match;
	const identity = identityOf(credentialOf(request));
	const { pathname } = new URL(request.url);

	if (requestMatch('GET', '/api/projects', request)) {
		const [projects, sessions] = await Promise.all([listProjects(), listAllSessions(identity)]);
		const registered = new Map(registeredFolders().map(folder => [folder.name, folder.path]));

		return Response.json(
			projects.map(name => {
				const own = sessions.filter(session => session.project === name);

				return {
					name,
					lastActivity: own[0]?.lastModified ?? null,
					sessionCount: own.length,
					liveCount: own.filter(session => session.live).length,
					...(registered.has(name) && { registered: true, path: registered.get(name) }),
				};
			}),
		);
	}

	if (requestMatch('POST', '/api/projects', request)) {
		try {
			const names = await addFolders((await request.json()).path);

			return Response.json({ name: names[0], names });
		} catch (error) {
			if (error instanceof FolderError) return new Response(error.message, { status: 400 });
			throw error;
		}
	}

	match = requestMatch('DELETE', '/api/projects/:project', request);
	if (match) {
		const removed = await removeProject(match.project);

		return removed ? Response.json({ removed }) : new Response('No such project', { status: 404 });
	}

	// Only from this machine's own token: the owner password of a server reached from elsewhere doesn't open the
	// other servers this machine happens to be logged into, unless this machine says it may (shareRemotes)
	if (pathname.startsWith('/api/remotes') && !(await mayListRemotes(identity)))
		return new Response('Only from this machine: the paude command, or paude web', { status: 403 });

	if (requestMatch('GET', '/api/remotes', request)) return Response.json(await listRemotes());

	if (requestMatch('POST', '/api/remotes/open', request)) {
		const { url, sessionId, project } = await request.json();
		const link = await remoteLink(url, { sessionId, project });

		return link ? Response.json({ link }) : new Response('Not one of your servers', { status: 404 });
	}

	match = requestMatch('GET', '/api/remotes/sessions', request);
	if (match) {
		try {
			const page = await remoteSessions(match.url, match);

			if (!page) return new Response('Not one of your servers', { status: 404 });

			return Response.json(page.items, { headers: { 'x-total-count': String(page.total) } });
		} catch (error) {
			return new Response(error.message, { status: 502 });
		}
	}

	match = requestMatch('GET', '/api/sessions', request);
	if (match) return sessionPage(await listAllSessions(identity), match, 8);

	if (requestMatch('GET', '/api/watching', request)) {
		const watched = await Promise.all(
			watchedBy(identity).map(async id => {
				const record = await sessionRecord(id);

				return record && toSummary(identity)({ sessionId: id, ...record.stored, cwd: record.cwd });
			}),
		);

		return Response.json(watched.filter(Boolean));
	}

	match = requestMatch('PUT', '/api/sessions/:id/watch', request);
	if (match) {
		if (!identity.owner && identity.sessionId !== match.id)
			return new Response('Not part of your invite', { status: 403 });
		if (!(await sessionRecord(match.id))) return new Response('Session not found', { status: 404 });

		await setWatching(identity, match.id, Boolean((await request.json()).watching));

		return new Response(null, { status: 204 });
	}

	// Every link the project's sessions brought up, as one list; pinned and hidden for the project
	match = requestMatch('GET', '/api/projects/:project/links', request);
	if (match) {
		const cwd = projectPath(match.project);

		if (!cwd) return new Response('Unknown project', { status: 404 });

		return Response.json(await projectLinks(match.project, cwd, { withHidden: match.all === '1' }));
	}

	match = requestMatch('POST', '/api/projects/:project/links/mark', request);
	if (match) {
		const { url, pinned, hidden } = await request.json();

		if (typeof url !== 'string') return new Response('Which link?', { status: 400 });
		await markProjectLink(match.project, url, { pinned, hidden });

		return new Response(null, { status: 204 });
	}

	match = requestMatch('GET', '/api/projects/:project/sessions', request);
	if (match) {
		const cwd = projectPath(match.project);

		if (!cwd) return new Response('Unknown project', { status: 404 });

		return sessionPage(await listProjectSessions(cwd, identity), match, 50);
	}

	// Where a new session could go: the main checkout and the worktrees inside the project, with what runs in each
	match = requestMatch('GET', '/api/projects/:project/checkouts', request);
	if (match) {
		const cwd = projectPath(match.project);

		if (!(await isFolder(cwd))) return new Response('Unknown project', { status: 404 });

		return Response.json({ checkouts: await checkoutsOf(cwd, runningFolders()) });
	}

	// `checkout` is { join: name } for a worktree in the project, { create: name } for a new one, or absent for the
	// project folder itself
	match = requestMatch('POST', '/api/projects/:project/sessions', request);
	if (match) {
		const cwd = projectPath(match.project);
		const { text, checkout } = await request.json();

		if (!(await isFolder(cwd))) return new Response('Unknown project', { status: 404 });

		if (checkout && 'create' in checkout) {
			const name = checkout.create?.trim() || worktreeNameFor(text);

			if (!validWorktreeName(name))
				return new Response('Name it with letters, digits, dots, dashes and underscores (up to 64).', { status: 400 });

			return creatingSession(onOutput => createWorktree(cwd, match.project, name, { onOutput }), text);
		}

		let folder = cwd;

		if (checkout?.join) {
			const joined = (await checkoutsOf(cwd))?.find(found => !found.main && found.path === checkout.join);

			if (!joined) return new Response('That worktree is gone.', { status: 404 });
			await joinWorktree(joined.path, match.project);
			folder = joined.path;
		}

		return Response.json({ id: startSession(folder, text?.trim()).id });
	}

	match = requestMatch('GET', '/api/sessions/:id/attach', request);
	if (match) {
		const session = await openSession(match.id);

		if (!session) return new Response('Session not found', { status: 404 });

		// undefined tells the router the request was answered by the upgrade
		const upgraded = server.upgrade(request, {
			data: { route: 'attach', sessionId: session.id, credential: credentialOf(request) },
		});

		return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
	}

	match = requestMatch('GET', '/api/sessions/:id/shell', request);
	if (match) {
		if (!may(identity, 'type', match.id))
			return new Response('Your invite does not include a terminal', { status: 403 });

		const record = await sessionRecord(match.id);

		if (!record) return new Response('Session not found', { status: 404 });

		const upgraded = server.upgrade(request, {
			data: { route: 'shell', sessionId: record.id, cwd: record.cwd, credential: credentialOf(request) },
		});

		return upgraded ? undefined : new Response('WebSocket upgrade failed', { status: 400 });
	}

	match = requestMatch('GET', '/api/sessions/:id/turns', request);
	if (match) {
		const record = await sessionRecord(match.id);

		if (!record) return new Response('Session not found', { status: 404 });

		const { cwd } = record;

		return Response.json({ turns: await sessionTurns(match.id, cwd), busy: Boolean(runningSession(match.id)?.busy) });
	}

	match = requestMatch('POST', '/api/sessions/:id/fork', request);
	if (match) {
		const { upToMessageId } = await request.json();
		const record = await sessionRecord(match.id);

		if (!record) return new Response('Session not found', { status: 404 });

		const { cwd } = record;
		if (typeof upToMessageId !== 'string') return new Response('Which message to fork after?', { status: 400 });

		const { sessionId } = await forkSession(match.id, { dir: cwd, upToMessageId });

		return Response.json({ id: sessionId });
	}

	match = requestMatch('DELETE', '/api/sessions/:id', request);
	if (match) {
		const record = await sessionRecord(match.id);

		if (!record) return new Response('Session not found', { status: 404 });

		const { cwd } = record;

		await stopSession(match.id);
		// A session that never got a prompt has no transcript to delete
		await deleteSession(match.id, { dir: cwd }).catch(error => {
			if (!/not found/i.test(error.message)) throw error;
		});
		await deleteNotes(match.id);
		await revokeInvitesFor(match.id);
		await pinName(match.id, '');
		await forgetActivity(match.id);

		const projectDir = projectPath(projectOf(cwd));
		const remaining = projectDir
			? [...(await listSessions({ dir: projectDir, limit: 1000 })).map(session => session.cwd), ...runningFolders()]
			: [];
		const released = projectDir ? await releaseWorktree(projectDir, cwd, remaining).catch(() => null) : null;

		return released ? Response.json(released) : new Response(null, { status: 204 });
	}

	// An empty name goes back to the automatic one
	match = requestMatch('PUT', '/api/sessions/:id/name', request);
	if (match) {
		const { name } = await request.json();
		const record = await sessionRecord(match.id);

		if (!record) return new Response('Session not found', { status: 404 });

		await pinName(match.id, name);
		runningSession(match.id)?.broadcastPresence();

		return new Response(null, { status: 204 });
	}

	match = requestMatch('GET', '/api/sessions/:id', request);
	if (match) {
		const record = await sessionRecord(match.id);

		if (!record) return new Response('Session not found', { status: 404 });

		const { cwd, running, title } = record;

		return Response.json({
			id: match.id,
			project: projectOf(cwd),
			live: Boolean(running),
			title,
			pinned: Boolean(pinnedName(match.id)),
			...activitySummary(identity, match.id, { running: Boolean(running), busy: running?.busy }),
		});
	}

	return null;
};

export default sessionsRoutes;
