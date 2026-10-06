import { DELETE, GET, POST } from '@vanilla-bean/hypertether';

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
