import { DELETE, GET, PATCH, POST, PUT } from '@vanilla-bean/hypertether';

import { searchParameters } from '../shared/searchQuery';

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

export const createSession = async (project, text, checkout) =>
	await POST('/api/projects/:project/sessions', {
		urlParameters: { project },
		body: { text, checkout },
		invalidates: [['sessions', project]],
	});

export const getSession = async id => await GET('/api/sessions/:id', { urlParameters: { id }, invalidateAfter: 0 });

export const getInvites = async sessionId =>
	await GET('/api/sessions/:id/invites', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

export const createInvite = async (sessionId, invite) =>
	await POST('/api/sessions/:id/invites', { urlParameters: { id: sessionId }, body: invite });

export const revokeInvite = async id => await DELETE('/api/invites/:id', { urlParameters: { id } });

export const listFiles = async sessionId =>
	await GET('/api/sessions/:id/files', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

export const getChanges = async sessionId =>
	await GET('/api/sessions/:id/changes', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// `source` is { source: 'changes', path }, { source: 'turn', turn }, { source: 'files', a, b } or { source: 'proposal' }
// The Git panel: `what` is status, log, commit, branches, stashes or blame
export const getGit = async (sessionId, what, searchParameters = {}) =>
	await GET('/api/sessions/:id/git/:what', {
		urlParameters: { id: sessionId, what },
		searchParameters,
		invalidateAfter: 0,
	});

// Resolves to { ok, output }: git's own words, for the panel to show
export const runGit = async (sessionId, action, body = {}) =>
	await POST('/api/sessions/:id/git/:action', { urlParameters: { id: sessionId, action }, body });

// { turns: [{ id, prompt, at, endedAt, steps: [{ tool, summary, file, ok, output }] }], context: { tokens, model } }
export const getTimeline = async sessionId =>
	await GET('/api/sessions/:id/timeline', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// Symbols: { q } names matching, { name, from } where one is defined, { file } a file's outline
export const getSymbols = async (sessionId, searchParameters) =>
	await GET('/api/sessions/:id/symbols', { urlParameters: { id: sessionId }, searchParameters, invalidateAfter: 0 });

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
export const getTasks = async sessionId =>
	await GET('/api/sessions/:id/tasks', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// A run's summary and what it printed from `from` on
export const getRun = async (sessionId, runId, from = 0) =>
	await GET('/api/sessions/:id/tasks/runs/:run', {
		urlParameters: { id: sessionId, run: runId },
		searchParameters: { from },
		invalidateAfter: 0,
	});

export const runTask = async (sessionId, task) =>
	await POST('/api/sessions/:id/tasks/run', { urlParameters: { id: sessionId }, body: { task } });

export const stopRun = async (sessionId, runId) =>
	await POST('/api/sessions/:id/tasks/runs/:run/stop', { urlParameters: { id: sessionId, run: runId } });

export const setAfterTurn = async (sessionId, task, on) =>
	await POST('/api/sessions/:id/tasks/after-turn', { urlParameters: { id: sessionId }, body: { task, on } });

export const stopProcess = async (sessionId, pid) =>
	await POST('/api/sessions/:id/processes/:pid/stop', { urlParameters: { id: sessionId, pid } });

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

export const getDiffSet = async (sessionId, source) =>
	await GET('/api/sessions/:id/diffs', {
		urlParameters: { id: sessionId },
		searchParameters: source,
		invalidateAfter: 0,
	});

export const getTurnChanges = async sessionId =>
	await GET('/api/sessions/:id/turn-changes', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

// `hash` is the one the file was read with; a 409 answers with the newer text and its hash
export const saveFile = async (sessionId, path, text, hash) =>
	await PUT('/api/sessions/:id/file', { urlParameters: { id: sessionId }, body: { path, text, hash } });

export const readFile = async (sessionId, path) =>
	await GET('/api/sessions/:id/file', {
		urlParameters: { id: sessionId },
		searchParameters: { path },
		responseType: 'text',
		invalidateAfter: 0,
	});

// Every match of a search across the project replaced: { files, replacements }
export const replaceInFiles = async (sessionId, query, options, replacement) =>
	await POST('/api/sessions/:id/replace', {
		urlParameters: { id: sessionId },
		body: { ...searchParameters(query, options), replacement },
	});

// What the session's processes see, and the project's .env files, secrets masked: { variables, files }
export const getEnvironment = async sessionId =>
	await GET('/api/sessions/:id/environment', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

export const searchFiles = async (sessionId, query, options) =>
	await GET('/api/sessions/:id/search', {
		urlParameters: { id: sessionId },
		searchParameters: searchParameters(query, options),
		responseType: 'text',
		invalidateAfter: 0,
	});

export const getTurns = async sessionId =>
	await GET('/api/sessions/:id/turns', { urlParameters: { id: sessionId }, invalidateAfter: 0 });

export const forkSession = async (sessionId, upToMessageId) =>
	await POST('/api/sessions/:id/fork', { urlParameters: { id: sessionId }, body: { upToMessageId } });

export const deleteSession = async sessionId => await DELETE('/api/sessions/:id', { urlParameters: { id: sessionId } });

export const nameSession = async (sessionId, name) =>
	await PUT('/api/sessions/:id/name', { urlParameters: { id: sessionId }, body: { name } });

export const rawFileUrl = (sessionId, path) =>
	`/api/sessions/${encodeURIComponent(sessionId)}/raw?path=${encodeURIComponent(path)}`;

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

// Where a prompt belongs: { matches: [{ session, why, meter }], fresh: { project, why } }; project keeps it to one
export const findPromptHome = async (prompt, project) => await POST('/api/prompt-home', { body: { prompt, project } });

// A prompt typed into a session once its prompt box is free (taken back up first if it isn't running)
export const sendPrompt = async (sessionId, text) =>
	await POST('/api/sessions/:id/prompt', { urlParameters: { id: sessionId }, body: { text } });

export const sendRemotePrompt = async (url, sessionId, text) =>
	await POST('/api/remotes/prompt', { body: { url, sessionId, text } });

// hours: 0 stops it; { until } is when it stops on its own (null for not warm)
export const setKeepWarm = async (sessionId, hours) =>
	await PUT('/api/sessions/:id/keep-warm', { urlParameters: { id: sessionId }, body: { hours } });

export const addFolder = async path => await POST('/api/projects', { body: { path }, responseType: 'text' });

export const removeFolder = async name => await DELETE('/api/projects/:name', { urlParameters: { name } });

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
