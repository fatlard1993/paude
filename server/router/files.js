import { requestMatch } from '@vanilla-bean/components/app';

import { credentialOf, identityOf } from '../auth';
import { MAX_ATTACHMENT, saveAttachment } from '../attachments';
import { sessionArtifacts } from '../artifacts';
import { listChanges } from '../changes';
import { DiffError, diffSet, turnsWithChanges } from '../diffs';
import { markLink, sessionLinks } from '../links';
import { answerDecision, dismissDecision, sessionDecisions, writeDownPrompt } from '../decisions';
import { lookedBack } from '../lookBack';
import { askClaude } from '../claudeInbox';
import { definitions, outline, searchSymbols } from '../symbols';
import { sessionTimeline } from '../timeline';
import { sessionFeed } from '../feed';
import { codeTour, diffTour } from '../tours';
import { whatToOpen } from '../toOpen';
import { verification } from '../verification';
import { sessionEnvironmentView } from '../environment';
import {
	SearchError,
	listFiles,
	rawProjectFile,
	readProjectFile,
	replaceInProject,
	searchProject,
	writeProjectFile,
} from '../files';
import {
	FileError,
	copyEntries,
	createEntry,
	moveEntries,
	restoreEntries,
	trashEntries,
	uploadFile,
} from '../fileOperations';
import { searchOptionsFrom } from '../../shared/searchQuery';
import { may } from '../permissions';
import { projectOf, projectPath } from '../projects';
import { readingFeed } from '../sessions/attachSocket';
import { openSession } from '../sessions/running';
import { sessionRecord } from '../sessions/record';
import { placeFolder, placeMatch, placeMissing } from './place';

const REFUSED = {
	404: 'No such file in this project',
	413: 'Too big to show here',
	415: 'Not a text file',
};

const sessionFolder = async id => (await sessionRecord(id))?.cwd ?? null;

const search = async (cwd, parameters) => {
	try {
		return Response.json(await searchProject(cwd, parameters.q, searchOptionsFrom(parameters)));
	} catch (error) {
		if (error instanceof SearchError) return new Response(error.message, { status: 400 });
		throw error;
	}
};

// A project's files are someone else's content served from paude's origin: an SVG or HTML file opened directly
// would run its scripts as paude. The sandbox gives it an origin of its own; Chrome won't show a sandboxed PDF,
// and its PDF viewer doesn't run a document's scripts against the page anyway.
// Chromium's PDF viewer won't show a sandboxed PDF; Firefox's runs a PDF's scripts, so it gets the sandbox
const chromium = userAgent => /Chrome\/|Chromium\//.test(userAgent ?? '');

// `download` hands it over as a file to save rather than one to show
const raw = async (cwd, path, userAgent, download) => {
	const { status, file } = await rawProjectFile(cwd, path);

	if (status !== 200) return new Response(REFUSED[status], { status });

	const type = file.type.split(';')[0];
	const headers = {
		'content-type': file.type,
		'x-content-type-options': 'nosniff',
		'cache-control': 'private, no-cache',
		...(download && {
			'content-disposition': `attachment; filename*=UTF-8''${encodeURIComponent(path.split('/').at(-1))}`,
		}),
	};

	if (type !== 'application/pdf' || !chromium(userAgent))
		headers['content-security-policy'] =
			"sandbox; default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; media-src 'self'";

	return new Response(file, { headers });
};

// A hand edit is a write to the project, so it takes the same trust as typing into Claude
const save = async (request, match) => {
	if (!may(identityOf(credentialOf(request)), 'type', match.id))
		return new Response('Your invite does not include editing', { status: 403 });

	const cwd = await placeFolder(match);

	if (!cwd) return placeMissing(match);

	const { path, text, hash } = await request.json();
	const saved = await writeProjectFile(cwd, path, text, hash);

	if (saved.status === 409) return Response.json({ text: saved.text, hash: saved.hash }, { status: 409 });
	if (saved.status !== 200) return new Response(REFUSED[saved.status], { status: saved.status });

	return Response.json({ hash: saved.hash });
};

const bodyOf = request => request.json().catch(() => ({}));

// Making, moving, copying, deleting and uploading files are writes to the project, so they take the same trust as
// typing into Claude. Each answers JSON, or a FileError's message with its status.
const MANAGING = [
	[
		'POST',
		'/files',
		async (cwd, request) => {
			const { path, folder } = await bodyOf(request);

			return createEntry(cwd, path, { folder: folder === true });
		},
	],
	['POST', '/files/move', async (cwd, request) => moveEntries(cwd, (await bodyOf(request)).moves)],
	['POST', '/files/copy', async (cwd, request) => copyEntries(cwd, (await bodyOf(request)).copies)],
	['POST', '/files/delete', async (cwd, request) => trashEntries(cwd, (await bodyOf(request)).paths)],
	['POST', '/files/restore', async (cwd, request) => restoreEntries(cwd, (await bodyOf(request)).trash)],
	[
		'PUT',
		'/files/upload',
		async (cwd, request, match) =>
			uploadFile(cwd, match.path, await request.arrayBuffer(), { replace: match.replace === '1' }),
	],
];

const manage = async request => {
	for (const [method, route, operate] of MANAGING) {
		const match = placeMatch(method, route, request);

		if (!match) continue;
		if (!may(identityOf(credentialOf(request)), 'type', match.id))
			return new Response('Your invite does not include editing', { status: 403 });

		const cwd = await placeFolder(match);

		if (!cwd) return placeMissing(match);

		try {
			return Response.json(await operate(cwd, request, match));
		} catch (error) {
			if (error instanceof FileError) return new Response(error.message, { status: error.status });
			throw error;
		}
	}

	return null;
};

// Replacing across the project is writing it, so it takes the role that may type into Claude
const replace = async (request, match) => {
	if (!may(identityOf(credentialOf(request)), 'type', match.id))
		return new Response('Your invite does not include editing', { status: 403 });

	const cwd = await placeFolder(match);

	if (!cwd) return placeMissing(match);

	const { q, replacement, ...options } = await request.json();

	try {
		return Response.json(await replaceInProject(cwd, q, replacement, searchOptionsFrom(options)));
	} catch (error) {
		if (error instanceof SearchError) return new Response(error.message, { status: 400 });
		throw error;
	}
};

// Even masked, a machine's environment says a lot: it takes the same trust as typing into Claude
const showEnvironment = async (request, match) => {
	if (!may(identityOf(credentialOf(request)), 'type', match.id))
		return new Response('Not part of your invite', { status: 403 });

	const cwd = await placeFolder(match);

	return cwd ? Response.json(await sessionEnvironmentView(cwd)) : placeMissing(match);
};

// A dropped or pasted file goes to Claude by its path, so it takes the same trust as typing into Claude
const attach = async (request, id, name) => {
	if (!may(identityOf(credentialOf(request)), 'type', id))
		return new Response('Your invite does not include typing', { status: 403 });
	if (!(await sessionRecord(id))) return new Response('Session not found', { status: 404 });

	const bytes = await request.arrayBuffer();

	if (!bytes.byteLength) return new Response('Nothing to attach', { status: 400 });
	if (bytes.byteLength > MAX_ATTACHMENT) return new Response('Too big to attach (25MB at most)', { status: 413 });

	return Response.json({ path: await saveAttachment(id, name, bytes) });
};

// Pages and SVGs a session made run nowhere near paude: in a sandbox, with no access to its cookies or API
const SANDBOXED = /\.(html?|svg)$/i;

// What a session made (the owner's to see wherever it is; a guest's only inside the project), and one of those files
// served as it is. Only a file the session's own transcript names is served.
const artifacts = async (request, match) => {
	const identity = identityOf(credentialOf(request));

	if (!may(identity, 'files', match.id)) return new Response('Not part of your invite', { status: 403 });

	const record = await sessionRecord(match.id);

	if (!record) return new Response('Session not found', { status: 404 });

	const made = (
		await sessionArtifacts(match.id, record.cwd, { projectFolder: projectPath(projectOf(record.cwd)) })
	).filter(artifact => identity.owner || artifact.inProject);

	if (new URL(request.url).pathname.endsWith('/artifacts')) return Response.json(made);

	const artifact = made.find(found => found.path === match.path);

	if (!artifact) return new Response('Not something this session made', { status: 404 });

	const file = Bun.file(artifact.path);
	const name = encodeURIComponent(artifact.name);

	return new Response(file, {
		headers: {
			'content-type': file.type,
			'content-disposition': `${match.download ? 'attachment' : 'inline'}; filename*=UTF-8''${name}`,
			'x-content-type-options': 'nosniff',
			...(SANDBOXED.test(artifact.path) && { 'content-security-policy': 'sandbox allow-scripts' }),
		},
	});
};

// Reading a session's project needs at least the comment role; watchers see only the terminal
// A guided tour of code, for anyone who may read the project: { file: { path, from, to, focus } } for a file, some of
// its lines, or one function or class in it; { diff: source } for any diff the files panel shows
const tour = async (request, match) => {
	if (!may(identityOf(credentialOf(request)), 'files', match.id))
		return new Response('Not part of your invite', { status: 403 });

	const cwd = await placeFolder(match);

	if (!cwd) return placeMissing(match);

	const { file, diff } = await request.json().catch(() => ({}));
	let told;

	if (file && typeof file.path === 'string') {
		const { status, text } = await readProjectFile(cwd, file.path);

		if (status !== 200) return new Response(REFUSED[status], { status });

		const focus = typeof file.focus?.name === 'string' && Number.isInteger(file.focus.line) ? file.focus : undefined;

		told = await codeTour({
			path: file.path,
			text,
			from: Number(file.from) || 1,
			to: Number(file.to) || undefined,
			focus,
		});
	} else if (diff && typeof diff === 'object') {
		if (!match.id && SESSION_DIFFS.has(diff.source)) return new Response('Only in a session', { status: 404 });
		try {
			told = await diffTour(await diffSet(match.id, cwd, diff));
		} catch (error) {
			if (error instanceof DiffError) return new Response(error.message, { status: 404 });
			throw error;
		}
	} else return new Response('A tour of what?', { status: 400 });

	return told ? Response.json(told) : new Response("Haiku couldn't tell it just now", { status: 502 });
};

// What to open for a few words asked aside, for anyone who may read the project: Haiku picks from the session's work
// (what's open, `viewing`; what changed; its turns and commits; the end of the `screen`)
const findToOpen = async (request, sessionId) => {
	if (!may(identityOf(credentialOf(request)), 'files', sessionId))
		return new Response('Not part of your invite', { status: 403 });

	const cwd = await sessionFolder(sessionId);

	if (!cwd) return new Response('Session not found', { status: 404 });

	const { ask, viewing, screen } = await request.json().catch(() => ({}));

	if (!String(ask ?? '').trim()) return new Response('Open what?', { status: 400 });

	const found = await whatToOpen(sessionId, cwd, { ask: String(ask).trim(), viewing, screen });

	return found ? Response.json(found) : new Response("Haiku couldn't look just now", { status: 502 });
};

// What reading a session's work takes: its turns, what it said and brought up. The rest reads a folder, so a project's
// page reads its own.
const SESSION_READS = ['/turn-changes', '/timeline', '/verification', '/feed', '/links', '/decisions'];
const PLACE_READS = ['/changes', '/diffs', '/symbols', '/files', '/file', '/search', '/raw'];
// A turn's changes and the change Claude proposes are a session's
const SESSION_DIFFS = new Set(['turn', 'proposal']);

const filesRoutes = async request => {
	const saving = placeMatch('PUT', '/file', request);

	if (saving) return save(request, saving);

	const managed = await manage(request);

	if (managed) return managed;

	const attaching = requestMatch('POST', '/api/sessions/:id/attachments', request);

	if (attaching) return attach(request, attaching.id, attaching.name);

	const replacing = placeMatch('POST', '/replace', request);

	if (replacing) return replace(request, replacing);

	const marking = requestMatch('POST', '/api/sessions/:id/links/mark', request);

	if (marking) {
		if (!may(identityOf(credentialOf(request)), 'note', marking.id))
			return new Response('Not part of your invite', { status: 403 });

		const { url, pinned, hidden } = await request.json();

		if (typeof url !== 'string') return new Response('Which link?', { status: 400 });
		await markLink(marking.id, url, { pinned, hidden });

		return new Response(null, { status: 204 });
	}

	const dismissing = requestMatch('POST', '/api/sessions/:id/decisions/dismiss', request);

	if (dismissing) {
		if (!may(identityOf(credentialOf(request)), 'note', dismissing.id))
			return new Response('Not part of your invite', { status: 403 });

		const { id, dismissed = true } = await request.json();

		if (typeof id !== 'string') return new Response('Which one?', { status: 400 });
		await dismissDecision(dismissing.id, id, Boolean(dismissed));

		return new Response(null, { status: 204 });
	}

	// Typed into the session's Claude, which records it where it belongs: a prompt, so the owner's alone
	const writing = requestMatch('POST', '/api/sessions/:id/decisions/write', request);

	if (writing) {
		if (!identityOf(credentialOf(request))?.owner)
			return new Response('Only the owner asks Claude to record it', { status: 403 });

		const cwd = await sessionFolder(writing.id);
		const { id } = await request.json();
		const decision = cwd && (await sessionDecisions(writing.id, cwd)).decisions.find(found => found.id === id);

		if (!decision) return new Response('That one is gone', { status: 404 });
		if (!(await openSession(writing.id))) return new Response('Session not found', { status: 404 });
		askClaude(writing.id, { prompt: writeDownPrompt(decision), answer: async () => {} });

		return new Response(null, { status: 204 });
	}

	// What filing one into its commit asked the person: the answer goes into the commit's message, so the owner's alone
	const answering = requestMatch('POST', '/api/sessions/:id/decisions/answer', request);

	if (answering) {
		if (!identityOf(credentialOf(request))?.owner)
			return new Response('Only the owner answers for the commit', { status: 403 });

		const { id, answer } = await request.json();

		if (typeof id !== 'string' || typeof answer !== 'string' || !answer.trim())
			return new Response('Which one, and what answer?', { status: 400 });
		if (!(await answerDecision(id, answer.trim())))
			return new Response('Nothing asked about that one', { status: 404 });

		return new Response(null, { status: 204 });
	}

	const made =
		requestMatch('GET', '/api/sessions/:id/artifacts', request) ||
		requestMatch('GET', '/api/sessions/:id/artifact', request);

	if (made) return artifacts(request, made);

	const touring = placeMatch('POST', '/tour', request);

	if (touring) return tour(request, touring);

	const finding = requestMatch('POST', '/api/sessions/:id/open-asked', request);

	if (finding) return findToOpen(request, finding.id);

	const environment = placeMatch('GET', '/environment', request);

	if (environment) return showEnvironment(request, environment);

	const match =
		SESSION_READS.map(rest => requestMatch('GET', `/api/sessions/:id${rest}`, request)).find(Boolean) ||
		PLACE_READS.map(rest => placeMatch('GET', rest, request)).find(Boolean);

	if (!match) return null;
	if (!may(identityOf(credentialOf(request)), 'files', match.id))
		return new Response('Not part of your invite', { status: 403 });

	const cwd = await placeFolder(match);

	if (!cwd) return placeMissing(match);

	const { pathname } = new URL(request.url);

	if (pathname.endsWith('/files')) return Response.json(await listFiles(cwd));
	if (pathname.endsWith('/changes')) return Response.json(await listChanges(cwd));
	if (pathname.endsWith('/turn-changes')) return Response.json(await turnsWithChanges(match.id, cwd));
	if (pathname.endsWith('/timeline')) return Response.json(await sessionTimeline(match.id, cwd));
	if (pathname.endsWith('/verification')) return Response.json(await verification(match.id, cwd));
	if (pathname.endsWith('/feed')) {
		await readingFeed(identityOf(credentialOf(request)), match.id, match);

		return Response.json(await sessionFeed(match.id, cwd, match.after));
	}
	// With what looking back over the project's other sessions has got to, and still needs
	if (pathname.endsWith('/decisions')) {
		const [settled, { lookingBack, earlier }] = await Promise.all([
			sessionDecisions(match.id, cwd, { withDismissed: match.all === '1' }),
			lookedBack(match.id, cwd),
		]);

		return Response.json({ ...settled, lookingBack, decisions: [...settled.decisions, ...earlier] });
	}
	if (pathname.endsWith('/links'))
		return Response.json(await sessionLinks(match.id, cwd, { withHidden: match.all === '1' }));
	// A file's outline, where a name is defined, or the names matching what's typed
	if (pathname.endsWith('/symbols')) {
		if (match.file) return Response.json(await outline(cwd, match.file));
		if (match.name) return Response.json(await definitions(cwd, match.name, { from: match.from }));

		return Response.json(await searchSymbols(cwd, match.q ?? ''));
	}
	if (pathname.endsWith('/diffs')) {
		if (!match.id && SESSION_DIFFS.has(match.source)) return new Response('Only in a session', { status: 404 });
		try {
			return Response.json(await diffSet(match.id, cwd, match));
		} catch (error) {
			if (error instanceof DiffError) return new Response(error.message, { status: 404 });
			throw error;
		}
	}
	if (pathname.endsWith('/search')) return search(cwd, match);
	if (pathname.endsWith('/raw')) return raw(cwd, match.path, request.headers.get('user-agent'), match.download === '1');

	const { status, text, hash } = await readProjectFile(cwd, match.path);

	return status === 200
		? new Response(text, { headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-hash': hash } })
		: new Response(REFUSED[status], { status });
};

export default filesRoutes;
