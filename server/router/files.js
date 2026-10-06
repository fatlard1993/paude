import { getSessionInfo } from '@anthropic-ai/claude-agent-sdk';

import { credentialOf, identityOf } from '../auth';
import { SearchError, listFiles, rawProjectFile, readProjectFile, searchProject } from '../files';
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

const FLAG = value => value === '1' || value === 'true';

const search = async (cwd, { q, case: caseSensitive, word, regex, include, exclude }) => {
	try {
		return Response.json(
			await searchProject(cwd, q, {
				caseSensitive: FLAG(caseSensitive),
				wholeWord: FLAG(word),
				regex: FLAG(regex),
				include,
				exclude,
			}),
		);
	} catch (error) {
		if (error instanceof SearchError) return new Response(error.message, { status: 400 });
		throw error;
	}
};

// A project's files are someone else's content served from paude's origin: an SVG or HTML file opened directly
// would run its scripts as paude. The sandbox gives it an origin of its own; Chrome won't show a sandboxed PDF,
// and its PDF viewer doesn't run a document's scripts against the page anyway.
const raw = async (cwd, path) => {
	const { status, file } = await rawProjectFile(cwd, path);

	if (status !== 200) return new Response(REFUSED[status], { status });

	const type = file.type.split(';')[0];
	const headers = {
		'content-type': file.type,
		'x-content-type-options': 'nosniff',
		'cache-control': 'private, no-cache',
	};

	if (type !== 'application/pdf')
		headers['content-security-policy'] =
			"sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'";

	return new Response(file, { headers });
};

// Reading a session's project needs at least the comment role; watchers see only the terminal
const filesRoutes = async request => {
	const match =
		requestMatch('GET', '/api/sessions/:id/files', request) ||
		requestMatch('GET', '/api/sessions/:id/file', request) ||
		requestMatch('GET', '/api/sessions/:id/search', request) ||
		requestMatch('GET', '/api/sessions/:id/raw', request);

	if (!match) return null;
	if (!may(identityOf(credentialOf(request)), 'note', match.id))
		return new Response('Not part of your invite', { status: 403 });

	const cwd = await sessionFolder(match.id);

	if (!cwd) return new Response('Session not found', { status: 404 });

	const { pathname } = new URL(request.url);

	if (pathname.endsWith('/files')) return Response.json(await listFiles(cwd));
	if (pathname.endsWith('/search')) return search(cwd, match);
	if (pathname.endsWith('/raw')) return raw(cwd, match.path);

	const { status, text } = await readProjectFile(cwd, match.path);

	return status === 200
		? new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8' } })
		: new Response(REFUSED[status], { status });
};

export default filesRoutes;
