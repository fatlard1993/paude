import { stat } from 'fs/promises';

import { requestMatch } from '@vanilla-bean/components/app';

import { projectPath } from '../projects';
import { sessionRecord } from '../sessions/record';
import { checkoutsOf } from '../worktrees';

// A route the files, Git, Tasks and shell panels share between a session and its project's page: at
// /api/sessions/:id<rest>, or /api/projects/:project<rest>, where only the owner reaches. The project's are on its
// folder, or on one of its worktrees, named by its path in `checkout`.
export const placeMatch = (method, rest, request) =>
	requestMatch(method, `/api/sessions/:id${rest}`, request) ||
	requestMatch(method, `/api/projects/:project${rest}`, request);

// The folder a match works in, or null when there's no such session, project or worktree of it
export const placeFolder = async ({ id, project, checkout }) => {
	if (id) return (await sessionRecord(id))?.cwd ?? null;

	const folder = projectPath(project);

	if (!folder || !(await stat(folder).catch(() => null))?.isDirectory()) return null;
	if (!checkout) return folder;

	return (await checkoutsOf(folder))?.some(found => !found.main && found.path === checkout) ? checkout : null;
};

export const placeMissing = ({ id }) =>
	new Response(id ? 'Session not found' : 'Unknown project or worktree', {
		status: 404,
	});

// What a place's processes carry as PAUDE_SESSION, so what they start is found as theirs (the mark is a word): a
// session's id, or one made from the project's folder
export const placeMark = (match, cwd) => match.id ?? `project-${Bun.hash(cwd).toString(16)}`;
