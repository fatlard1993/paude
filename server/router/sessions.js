import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

import { credentialOf } from '../auth';
import { listProjects, projectOf, projectPath } from '../projects';
import { listAllSessions, listProjectSessions } from '../sessions/stored';
import { openSession, runningSession, startSession } from '../sessions/running';
import requestMatch from '../utils/requestMatch';

const sessionsRoutes = async (request, server) => {
	let match;

	if (requestMatch('GET', '/api/projects', request)) {
		const [projects, sessions] = await Promise.all([listProjects(), listAllSessions()]);

		return Response.json(
			projects.map(name => {
				const own = sessions.filter(session => session.project === name);

				return {
					name,
					lastActivity: own[0]?.lastModified ?? null,
					sessionCount: own.length,
					liveCount: own.filter(session => session.live).length,
				};
			}),
		);
	}

	match = requestMatch('GET', '/api/sessions', request);
	if (match) return Response.json((await listAllSessions()).slice(0, Number(match.limit) || 8));

	match = requestMatch('GET', '/api/projects/:project/sessions', request);
	if (match) {
		const cwd = projectPath(match.project);

		if (!cwd) return new Response('Unknown project', { status: 404 });

		return Response.json(await listProjectSessions(cwd));
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
			title: running?.title || stored?.customTitle || stored?.summary || '',
		});
	}

	return null;
};

export default sessionsRoutes;
