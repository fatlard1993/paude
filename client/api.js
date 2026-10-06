import { DELETE, GET, POST, PUT } from '@vanilla-bean/hypertether';

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

export const createSession = async (project, text) =>
	await POST('/api/projects/:project/sessions', {
		urlParameters: { project },
		body: { text },
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

export const readFile = async (sessionId, path) =>
	await GET('/api/sessions/:id/file', {
		urlParameters: { id: sessionId },
		searchParameters: { path },
		responseType: 'text',
		invalidateAfter: 0,
	});

export const searchFiles = async (sessionId, query, { caseSensitive, wholeWord, regex, include, exclude } = {}) =>
	await GET('/api/sessions/:id/search', {
		urlParameters: { id: sessionId },
		searchParameters: {
			q: query,
			case: caseSensitive ? '1' : '',
			word: wholeWord ? '1' : '',
			regex: regex ? '1' : '',
			include: include ?? '',
			exclude: exclude ?? '',
		},
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

export const addFolder = async path => await POST('/api/projects', { body: { path }, responseType: 'text' });

export const removeFolder = async name => await DELETE('/api/projects/:name', { urlParameters: { name } });

export const getRemotes = async () => await GET('/api/remotes', { invalidateAfter: 0 });

export const openRemote = async (url, sessionId) => await POST('/api/remotes/open', { body: { url, sessionId } });
