import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

import { credentialOf, identityOf } from '../auth';
import { listFiles, readProjectFile, searchProject } from '../files';
import { may } from '../permissions';
import { projectOf } from '../projects';
import { runningSession } from '../sessions/running';
import requestMatch from '../utils/requestMatch';

const REFUSED = {
	404: 'No such file in this project',
	413: 'Too big to show here',
	415: 'Not a text file',
};

const sessionFolder = async id => {
	const cwd = runningSession(id)?.cwd ?? (await getSessionInfo(id))?.cwd;

	return projectOf(cwd) ? cwd : null;
};

// Reading a session's project needs at least the comment role; watchers see only the terminal
const filesRoutes = async request => {
	const match =
		requestMatch('GET', '/api/sessions/:id/files', request) ||
		requestMatch('GET', '/api/sessions/:id/file', request) ||
		requestMatch('GET', '/api/sessions/:id/search', request);

	if (!match) return null;
	if (!may(identityOf(credentialOf(request)), 'note', match.id))
		return new Response('Not part of your invite', { status: 403 });

	const cwd = await sessionFolder(match.id);

	if (!cwd) return new Response('Session not found', { status: 404 });

	const { pathname } = new URL(request.url);

	if (pathname.endsWith('/files')) return Response.json(await listFiles(cwd));
	if (pathname.endsWith('/search')) return Response.json(await searchProject(cwd, match.q));

	const { status, text } = await readProjectFile(cwd, match.path);

	return status === 200
		? new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
		: new Response(REFUSED[status], { status });
};

export default filesRoutes;
