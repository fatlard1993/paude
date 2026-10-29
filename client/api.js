import { DELETE, GET, PATCH, POST, PUT } from '@vanilla-bean/components';

import { searchParameters } from '../shared/searchQuery';

// Where the files, Git and Tasks panels and the side terminal work: a session, by its id, or a project's page, as
// { project, checkout } (a worktree's path, or none for the project folder). Answers a request's url and options.
const placed = (place, rest, { urlParameters, searchParameters: search, ...options } = {}) => {
	const project = typeof place === 'object';
	const query = { ...search, ...(project && place.checkout && { checkout: place.checkout }) };

	return [
		project ? `/api/projects/:project${rest}` : `/api/sessions/:id${rest}`,
		{
			...options,
			urlParameters: { ...urlParameters, ...(project ? { project: place.project } : { id: place }) },
			...(Object.keys(query).length && { searchParameters: query }),
		},
	];
};

// The session a place is, or undefined for a project's page, which has none of a session's own work
export const sessionOf = place => (typeof place === 'string' ? place : undefined);

// A place as a word, to keep things under: a session's id as it is
export const placeKey = place => sessionOf(place) ?? `${place.project}:${place.checkout ?? ''}`;

// The same, as an address to open or fetch directly
export const placeUrl = (place, rest, search) => {
	const [url, { urlParameters, searchParameters: query }] = placed(place, rest, { searchParameters: search });
	const path = url.replace(/:(\w+)/g, (_, name) => encodeURIComponent(urlParameters[name]));

	return query ? `${path}?${new URLSearchParams(query)}` : path;
};

// { authenticated, passwordSet, identity, name }
export const getAuth = async () => await GET('/api/auth', { invalidateAfter: 0 });

export const login = async password => await POST('/api/login', { body: { password } });

export const logout = async () => await POST('/api/logout');

// An invite link's token; { sessionId } it was made for
export const joinInvite = async token => await POST('/api/join', { body: { token } });

export const redeemHandoff = async code => await POST('/api/handoff/redeem', { body: { code } });

export const getProjects = async options =>
	await GET('/api/projects', { apiId: 'projects', invalidateAfter: 0, ...options });

export const getRecentSessions = async options =>
	await GET('/api/sessions', { apiId: 'recentSessions', invalidateAfter: 0, ...options });

export const getProjectSessions = async (project, options) =>
	await GET('/api/projects/:project/sessions', {
		apiId: ['sessions', project],
		invalidateAfter: 0,
		urlParameters: { project },
		...options,
	});

export const getCheckouts = async project =>
	await GET('/api/projects/:project/checkouts', { urlParameters: { project }, invalidateAfter: 0 });

// mode: 'warm' (kept warm), 'brief' (short-lived), or nothing for an ordinary session
export const createSession = async (project, text, checkout, mode) =>
	await POST('/api/projects/:project/sessions', {
		urlParameters: { project },
		body: { text, checkout, mode },
		invalidates: [['sessions', project]],
	});

export const getSession = async id => await GET('/api/sessions/:id', { urlParameters: { id }, invalidateAfter: 0 });

export const getInvites = async sessionId =>
	await GET('/api/sessions/:id/invites', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

export const createInvite = async (sessionId, invite) =>
	await POST('/api/sessions/:id/invites', { urlParameters: { id: sessionId }, body: invite });

export const revokeInvite = async id => await DELETE('/api/invites/:id', { urlParameters: { id } });

export const listFiles = async place => await GET(...placed(place, '/files', { invalidateAfter: 0 }));

export const getChanges = async place => await GET(...placed(place, '/changes', { invalidateAfter: 0 }));

// `source` is { source: 'changes', path }, { source: 'turn', turn }, { source: 'files', a, b } or { source: 'proposal' }
// The Git panel: `what` is status, log, commit, branches, stashes or blame
export const getGit = async (place, what, search = {}) =>
	await GET(...placed(place, '/git/:what', { urlParameters: { what }, searchParameters: search, invalidateAfter: 0 }));

// Resolves to { ok, output }: git's own words, for the panel to show
export const runGit = async (place, action, body = {}) =>
	await POST(...placed(place, '/git/:action', { urlParameters: { action }, body }));

// { turns: [{ id, prompt, at, endedAt, steps: [{ tool, summary, file, ok, output }] }], context: { tokens, model } }
export const getTimeline = async sessionId =>
	await GET('/api/sessions/:id/timeline', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// Whether what changed was tested since: { state, run, edited, said }, or null
export const getVerification = async sessionId =>
	await GET('/api/sessions/:id/verification', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// Symbols: { q } names matching, { name, from } where one is defined, { file } a file's outline
export const getSymbols = async (place, search) =>
	await GET(...placed(place, '/symbols', { searchParameters: search, invalidateAfter: 0 }));

// What the session settled, newest first, and whether each is recorded: { reading, decisions: [{ id, kind, chose,
// rejected, because, asked, at, place, filed, question, looking }] }
export const getDecisions = async sessionId =>
	await GET('/api/sessions/:id/decisions', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

export const dismissDecision = async (sessionId, id) =>
	await POST('/api/sessions/:id/decisions/dismiss', { urlParameters: { id: sessionId }, body: { id } });

// Typed into Claude once its prompt box is free: write this one down where it belongs
export const writeDownDecision = async (sessionId, id) =>
	await POST('/api/sessions/:id/decisions/write', { urlParameters: { id: sessionId }, body: { id } });

// The person's answer to what filing one into its commit asked them
export const answerDecision = async (sessionId, id, answer) =>
	await POST('/api/sessions/:id/decisions/answer', { urlParameters: { id: sessionId }, body: { id, answer } });

// The links that came up in the session, newest first: [{ url, kind, context, by, count, firstAt, pinned }]
export const getLinks = async sessionId =>
	await GET('/api/sessions/:id/links', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// Across a project's sessions, each link naming the sessions it came up in
export const getProjectLinks = async project =>
	await GET('/api/projects/:project/links', { urlParameters: { project }, invalidateAfter: 0 });

export const markProjectLink = async (project, url, change) =>
	await POST('/api/projects/:project/links/mark', { urlParameters: { project }, body: { url, ...change } });

export const markLink = async (sessionId, url, change) =>
	await POST('/api/sessions/:id/links/mark', { urlParameters: { id: sessionId }, body: { url, ...change } });

// The Tasks panel: { tasks, runs, processes }
export const getTasks = async place => await GET(...placed(place, '/tasks', { invalidateAfter: 0 }));

// A run's summary and what it printed from `from` on
export const getRun = async (place, runId, from = 0) =>
	await GET(
		...placed(place, '/tasks/runs/:run', {
			urlParameters: { run: runId },
			searchParameters: { from },
			invalidateAfter: 0,
		}),
	);

export const runTask = async (place, task) => await POST(...placed(place, '/tasks/run', { body: { task } }));

export const stopRun = async (place, runId) =>
	await POST(...placed(place, '/tasks/runs/:run/stop', { urlParameters: { run: runId } }));

export const setAfterTurn = async (place, task, on) =>
	await POST(...placed(place, '/tasks/after-turn', { body: { task, on } }));

export const stopProcess = async (place, pid) =>
	await POST(...placed(place, '/processes/:pid/stop', { urlParameters: { pid } }));

// { shares: [{ id, name, kind, port, path, auto, url }], origin }
export const getShares = async sessionId =>
	await GET('/api/sessions/:id/shares', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// `share` is { kind: 'port', port } or { kind: 'download' | 'site', path }
export const addShare = async (sessionId, share) =>
	await POST('/api/sessions/:id/shares', { urlParameters: { id: sessionId }, body: share });

export const renameShare = async (sessionId, shareId, name) =>
	await PATCH('/api/sessions/:id/shares/:share', { urlParameters: { id: sessionId, share: shareId }, body: { name } });

export const stopShare = async (sessionId, shareId) =>
	await DELETE('/api/sessions/:id/shares/:share', { urlParameters: { id: sessionId, share: shareId } });

export const getDiffSet = async (place, source) =>
	await GET(...placed(place, '/diffs', { searchParameters: source, invalidateAfter: 0 }));

export const getTurnChanges = async sessionId =>
	await GET('/api/sessions/:id/turn-changes', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// `hash` is the one the file was read with; a 409 answers with the newer text and its hash
export const saveFile = async (place, path, text, hash) =>
	await PUT(...placed(place, '/file', { body: { path, text, hash } }));

// Resolves to { path, listed }: whether git lets the new file show in the listing (a folder never says)
export const createEntry = async (place, path, folder) =>
	await POST(...placed(place, '/files', { body: { path, folder } }));

// `action` is move ({ moves: [{ from, to }] }), copy ({ copies }), delete ({ paths }, answering { trash }) or restore
// ({ trash }); a refusal answers with why, as text
export const manageFiles = async (place, action, body) =>
	await POST(...placed(place, '/files/:action', { urlParameters: { action }, body }));

// A file from this computer into the project at `path`; a 409 means something is there, which `replace` writes over
export const uploadFile = async (place, path, file, { replace = false } = {}) => {
	const response = await fetch(placeUrl(place, '/files/upload', { path, ...(replace && { replace: 1 }) }), {
		method: 'PUT',
		body: file,
	}).catch(() => null);

	return { response, body: response?.ok ? await response.json() : await response?.text() };
};

export const readFile = async (place, path) =>
	await GET(...placed(place, '/file', { searchParameters: { path }, responseType: 'text', invalidateAfter: 0 }));

// Every match of a search across the project replaced: { files, replacements }
export const replaceInFiles = async (place, query, options, replacement) =>
	await POST(...placed(place, '/replace', { body: { ...searchParameters(query, options), replacement } }));

// What the session's processes see, and the project's .env files, secrets masked: { variables, files }
export const getEnvironment = async place => await GET(...placed(place, '/environment', { invalidateAfter: 0 }));

export const searchFiles = async (place, query, options) =>
	await GET(
		...placed(place, '/search', {
			searchParameters: searchParameters(query, options),
			responseType: 'text',
			invalidateAfter: 0,
		}),
	);

export const getTurns = async sessionId =>
	await GET('/api/sessions/:id/turns', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

export const forkSession = async (sessionId, upToMessageId) =>
	await POST('/api/sessions/:id/fork', { urlParameters: { id: sessionId }, body: { upToMessageId } });

export const deleteSession = async sessionId => await DELETE('/api/sessions/:id', { urlParameters: { id: sessionId } });

// Out of the lists, or back in: several at once
export const archiveSessions = async (ids, archived) =>
	await POST('/api/sessions/archive', { body: { ids, archived } });

export const nameSession = async (sessionId, name) =>
	await PUT('/api/sessions/:id/name', { urlParameters: { id: sessionId }, body: { name } });

export const rawFileUrl = (place, path, { download = false } = {}) =>
	placeUrl(place, '/raw', { path, ...(download && { download: 1 }) });

export const getWatching = async () => await GET('/api/watching', { invalidateAfter: 0 });

export const setWatching = async (sessionId, watching) =>
	await PUT('/api/sessions/:id/watch', { urlParameters: { id: sessionId }, body: { watching } });

// What Claude is asking in a session now ({ asking: null } for nothing), and the answer to it, by its number
export const getAsking = async sessionId =>
	await GET('/api/sessions/:id/asking', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

export const answerAsking = async (sessionId, question, key) =>
	await POST('/api/sessions/:id/answer', { urlParameters: { id: sessionId }, body: { question, key } });

// After a usage limit: 'now', 'reset' (carry on when it resets) or 'cancel' (stop waiting for that)
export const continueAfterLimit = async (sessionId, when) =>
	await POST('/api/sessions/:id/continue', { urlParameters: { id: sessionId }, body: { when } });

// The conversation's size, its cache, and what it has cost ({ meter: null } before Claude's first answer)
export const getMeter = async sessionId =>
	await GET('/api/sessions/:id/meter', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// A tour of what happened in a session since a time (ms), or lately without one: { overview, stops }
export const catchUpOn = async (sessionId, since) =>
	await POST('/api/sessions/:id/catch-up', { urlParameters: { id: sessionId }, body: { since } });

// A guided tour of code: { file: { path, from, to, focus } } or { diff: source }; { overview, stops, leftOut }
export const tourOf = async (place, subject) => await POST(...placed(place, '/tour', { body: subject }));

// What to open for a few words asked aside: { said, opened: [{ file, line, title } | { diff, title }], dropped }
export const findToOpen = async (sessionId, { ask, viewing, screen }) =>
	await POST('/api/sessions/:id/open-asked', { urlParameters: { id: sessionId }, body: { ask, viewing, screen } });

// Where a prompt belongs: { matches: [{ session, why, meter }], fresh: { project, why } }; project keeps it to one
export const findPromptHome = async (prompt, project) => await POST('/api/prompt-home', { body: { prompt, project } });

// A prompt typed into a session once its prompt box is free (taken back up first if it isn't running)
export const sendPrompt = async (sessionId, text) =>
	await POST('/api/sessions/:id/prompt', { urlParameters: { id: sessionId }, body: { text } });

export const sendRemotePrompt = async (url, sessionId, text) =>
	await POST('/api/remotes/prompt', { body: { url, sessionId, text } });

// A new session in a project on another server, in its own folder: { id } there
export const startRemoteSession = async (url, project, text, mode) =>
	await POST('/api/remotes/start', { body: { url, project, text, mode } });

export const getArtifacts = async sessionId =>
	await GET('/api/sessions/:id/artifacts', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

export const getProjectArtifacts = async project =>
	await GET('/api/projects/:project/artifacts', { urlParameters: { project }, invalidateAfter: 0 });

// How long a session lasts: 'ordinary', 'warm' or 'brief'; { lifetime, warmUntil }
export const setLifetime = async (sessionId, lifetime) =>
	await PUT('/api/sessions/:id/lifetime', { urlParameters: { id: sessionId }, body: { lifetime } });

export const addFolder = async path => await POST('/api/projects', { body: { path }, responseType: 'text' });

export const removeFolder = async name => await DELETE('/api/projects/:name', { urlParameters: { name } });

export const setProjectWatching = async (name, watching) =>
	await PUT('/api/projects/:name/watch', { urlParameters: { name }, body: { watching } });

export const getRemotes = async () => await GET('/api/remotes', { invalidateAfter: 0 });

export const getRemoteSessions = async (url, { searchParameters: page }) =>
	await GET('/api/remotes/sessions', { invalidateAfter: 0, searchParameters: { url, ...page } });

// Where to go there: { sessionId } or { project }
export const openRemote = async (url, to) => await POST('/api/remotes/open', { body: { url, ...to } });

// A dropped or pasted file, saved where Claude can read it: { path }
export const attachFile = async (sessionId, file) => {
	const response = await fetch(
		`/api/sessions/${encodeURIComponent(sessionId)}/attachments?name=${encodeURIComponent(file.name)}`,
		{ method: 'POST', body: file },
	);

	return { response, body: response.ok ? await response.json() : await response.text() };
};
