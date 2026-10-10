import { deleteSession, listSessions } from '@anthropic-ai/claude-agent-sdk';

import { forgetActivity } from './activity';
import { revokeInvitesFor } from './auth';
import { pinName } from './names';
import { deleteNotes } from './notes';
import { projectOf, projectPath } from './projects';
import { sessionRecord } from './sessions/record';
import { allRunning, stopSession } from './sessions/running';
import { releaseWorktree } from './worktrees';

// A session gone for good: Claude ended, its transcript, chat and comments deleted, its invites revoked, and its
// worktree let go once no other session uses it. { released } (the worktree's fate, if it had one); null for no such
// session.
const removeSession = async id => {
	const record = await sessionRecord(id);

	if (!record) return null;

	const { cwd } = record;

	await stopSession(id);
	// A session that never got a prompt has no transcript to delete
	await deleteSession(id, { dir: cwd }).catch(error => {
		if (!/not found/i.test(error.message)) throw error;
	});
	await deleteNotes(id);
	await revokeInvitesFor(id);
	await pinName(id, '');
	await forgetActivity(id);

	const projectDir = projectPath(projectOf(cwd));
	const remaining = projectDir
		? [
				...(await listSessions({ dir: projectDir, limit: 1000 })).map(session => session.cwd),
				...[...allRunning()].map(session => session.cwd),
			]
		: [];

	return { released: projectDir ? await releaseWorktree(projectDir, cwd, remaining).catch(() => null) : null };
};

export default removeSession;
