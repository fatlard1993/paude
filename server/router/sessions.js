import { deleteSession, forkSession, getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

import { activitySummary, forgetActivity, setWatching, watchedBy } from '../activity';
import { credentialOf, identityOf, revokeInvitesFor } from '../auth';
import { pinName, pinnedName } from '../names';
import { deleteNotes } from '../notes';
import { sessionTurns } from '../sessions/history';
import {
	FolderError,
	listProjects,
	projectOf,
	projectPath,
	registerFolder,
	registeredFolders,
	unregisterFolder,
} from '../projects';
import { listAllSessions, listProjectSessions, toSummary } from '../sessions/stored';
import { openSession, runningSession, startSession, stopSession } from '../sessions/running';
import requestMatch from '../utils/requestMatch';

const sessionCwd = async id => runningSession(id)?.cwd ?? (await getSessionInfo(id))?.cwd;

const sessionsRoutes = async (request, server) => {
	let match;
	const identity = identityOf(credentialOf(request));

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
			return Response.json({ name: await registerFolder((await request.json()).path) });
		} catch (error) {
			if (error instanceof FolderError) return new Response(error.message, { status: 400 });
			throw error;
		}
	}

	match = requestMatch('DELETE', '/api/projects/:project', request);
	if (match) return new Response(null, { status: (await unregisterFolder(match.project)) ? 204 : 404 });

	match = requestMatch('GET', '/api/sessions', request);
	if (match) return Response.json((await listAllSessions(identity)).slice(0, Number(match.limit) || 8));

	if (requestMatch('GET', '/api/watching', request)) {
		const watched = await Promise.all(
			watchedBy(identity).map(async id => {
				const running = runningSession(id);
				const stored = await getSessionInfo(id);

				if (!projectOf(running?.cwd ?? stored?.cwd)) return null;

				return {
					...toSummary(identity)({ sessionId: id, cwd: running?.cwd, ...stored }),
					title: pinnedName(id) || running?.title || stored?.customTitle || stored?.summary || '',
				};
			}),
		);

		return Response.json(watched.filter(Boolean));
	}

	match = requestMatch('PUT', '/api/sessions/:id/watch', request);
	if (match) {
		if (!identity.owner && identity.sessionId !== match.id)
			return new Response('Not part of your invite', { status: 403 });
		if (!projectOf(await sessionCwd(match.id))) return new Response('Session not found', { status: 404 });

		await setWatching(identity, match.id, Boolean((await request.json()).watching));

		return new Response(null, { status: 204 });
	}

	match = requestMatch('GET', '/api/projects/:project/sessions', request);
	if (match) {
		const cwd = projectPath(match.project);

		if (!cwd) return new Response('Unknown project', { status: 404 });

		return Response.json(await listProjectSessions(cwd, identity));
	}

	match = requestMatch('POST', '/api/projects/:project/sessions', request);
	if (match) {
		const cwd = projectPath(match.project);

		const { text } = await request.json();

		if (!cwd) return new Response('Unknown project', { status: 404 });

		return Response.json({ id: startSession(cwd, text?.trim()).id });
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

	match = requestMatch('GET', '/api/sessions/:id/turns', request);
	if (match) {
		const cwd = runningSession(match.id)?.cwd ?? (await getSessionInfo(match.id))?.cwd;

		if (!projectOf(cwd)) return new Response('Session not found', { status: 404 });

		return Response.json({ turns: await sessionTurns(match.id, cwd), busy: Boolean(runningSession(match.id)?.busy) });
	}

	match = requestMatch('POST', '/api/sessions/:id/fork', request);
	if (match) {
		const { upToMessageId } = await request.json();
		const cwd = runningSession(match.id)?.cwd ?? (await getSessionInfo(match.id))?.cwd;

		if (!projectOf(cwd)) return new Response('Session not found', { status: 404 });
		if (typeof upToMessageId !== 'string') return new Response('Which message to fork after?', { status: 400 });

		const { sessionId } = await forkSession(match.id, { dir: cwd, upToMessageId });

		return Response.json({ id: sessionId });
	}

	match = requestMatch('DELETE', '/api/sessions/:id', request);
	if (match) {
		const cwd = runningSession(match.id)?.cwd ?? (await getSessionInfo(match.id))?.cwd;

		if (!projectOf(cwd)) return new Response('Session not found', { status: 404 });

		await stopSession(match.id);
		await deleteSession(match.id, { dir: cwd });
		await deleteNotes(match.id);
		await revokeInvitesFor(match.id);
		await pinName(match.id, '');
		await forgetActivity(match.id);

		return new Response(null, { status: 204 });
	}

	// An empty name goes back to the automatic one
	match = requestMatch('PUT', '/api/sessions/:id/name', request);
	if (match) {
		const { name } = await request.json();
		const cwd = runningSession(match.id)?.cwd ?? (await getSessionInfo(match.id))?.cwd;

		if (!projectOf(cwd)) return new Response('Session not found', { status: 404 });

		await pinName(match.id, name);
		runningSession(match.id)?.broadcastPresence();

		return new Response(null, { status: 204 });
	}

	match = requestMatch('GET', '/api/sessions/:id', request);
	if (match) {
		const running = runningSession(match.id);
		const stored = await getSessionInfo(match.id);
		const cwd = running?.cwd ?? stored?.cwd;

		if (!projectOf(cwd)) return new Response('Session not found', { status: 404 });

		return Response.json({
			id: match.id,
			project: projectOf(cwd),
			live: Boolean(running),
			title: pinnedName(match.id) || running?.title || stored?.customTitle || stored?.summary || '',
			pinned: Boolean(pinnedName(match.id)),
			...activitySummary(identity, match.id, { running: Boolean(running), busy: running?.busy }),
		});
	}

	return null;
};

export default sessionsRoutes;
