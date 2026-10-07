import path from 'path';

import { credentialOf, identityOf } from '../auth';
import { GitError, gitAction, gitBlame, gitBranches, gitCommit, gitLog, gitStashes, gitStatus, repoRoot } from '../git';
import { draftCommitMessage } from '../commitMessage';
import { may } from '../permissions';
import { sessionRecord } from '../sessions/record';
import requestMatch from '../utils/requestMatch';

// The files panel names a path from the session's folder; git, from the top of the repository
const fromRoot = (root, cwd, wanted) => wanted && path.relative(root, path.resolve(cwd, wanted));

const READS = {
	status: root => gitStatus(root),
	log: (root, query, cwd) => gitLog(root, { ...query, path: fromRoot(root, cwd, query.path) }),
	commit: (root, { ref }) => gitCommit(root, ref),
	branches: root => gitBranches(root),
	stashes: root => gitStashes(root),
	blame: (root, query, cwd) => gitBlame(root, fromRoot(root, cwd, query.path)),
};

// The Git panel's routes. Reading the history is reading the project ('files'); anything that changes the checkout or
// its remote is as much a write as typing into Claude ('type').
const gitRoutes = async request => {
	const reading = requestMatch('GET', '/api/sessions/:id/git/:what', request);
	const acting = !reading && requestMatch('POST', '/api/sessions/:id/git/:what', request);
	const match = reading || acting;

	if (!match) return null;

	const identity = identityOf(credentialOf(request));

	if (!may(identity, reading ? 'files' : 'type', match.id))
		return new Response(reading ? 'Not part of your invite' : 'Your invite does not include changing the project', {
			status: 403,
		});

	const cwd = (await sessionRecord(match.id))?.cwd;

	if (!cwd) return new Response('Session not found', { status: 404 });

	const root = await repoRoot(cwd);

	if (!root) return new Response('Not a git repository', { status: 404 });

	try {
		if (reading) {
			if (!Object.hasOwn(READS, match.what)) return new Response('Not Found', { status: 404 });

			return Response.json(await READS[match.what](root, match, cwd));
		}

		if (match.what === 'message') return Response.json({ ok: true, message: await draftCommitMessage(root) });

		return Response.json(await gitAction(root, match.what, await request.json().catch(() => ({}))));
	} catch (error) {
		if (error instanceof GitError)
			return reading
				? new Response(error.message, { status: 400 })
				: Response.json({ ok: false, output: error.message });
		throw error;
	}
};

export default gitRoutes;
