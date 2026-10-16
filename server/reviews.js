import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import updateJsonFile from '../shared/updateJsonFile';
import { identityKey } from './activity';
import { branchName, headCommit, movedSince } from './git';
import gitEnvironment from './utils/gitEnvironment';
import { normalizeRemote } from './worktrees';

// How far each person has reviewed each branch: the commit they last marked, so coming back shows only what came
// after it. Kept by person, repository and branch rather than by session, so it outlives the session (and the
// worktree) a review was done in, and a review in a new one carries on from it.
let file;

export const initReviews = dataDir => {
	file = path.join(dataDir, 'reviewed.json');
};

const gitOut = (args, cwd) => {
	const result = Bun.spawnSync(['git', ...args], { cwd, env: gitEnvironment(), stdout: 'pipe', stderr: 'pipe' });

	return result.success ? result.stdout.toString().trim() : '';
};

// The repository by its origin, so a clone elsewhere counts as the same; else by where its history is kept
const repositoryOf = root =>
	normalizeRemote(gitOut(['remote', 'get-url', 'origin'], root)) ||
	gitOut(['rev-parse', '--path-format=absolute', '--git-common-dir'], root);

const keyOf = async root => {
	const branch = await branchName(root);

	return branch && `${repositoryOf(root)} ${branch}`;
};

// { head, branch, commit, at, count | rewritten | missing } for the one asking, about the branch checked out at root;
// commit is null when they haven't marked it; { head } alone on a detached HEAD or for someone with no lasting identity
export const reviewState = async (identity, root) => {
	const head = await headCommit(root);
	const who = identityKey(identity);
	const key = who && (await keyOf(root));

	if (!key) return { head };

	const mark = (await readJsonFile(file, {}))[who]?.[key];

	if (!mark) return { head, branch: await branchName(root), commit: null };

	return { head, branch: await branchName(root), ...mark, ...(await movedSince(root, mark.commit)) };
};

// Reviewed up to what's checked out now
export const markReviewed = async (identity, root) => {
	const who = identityKey(identity);
	const key = who && (await keyOf(root));
	const commit = await headCommit(root);

	if (!key || !commit) return false;

	await updateJsonFile(file, {}, all => {
		all[who] = { ...all[who], [key]: { commit, at: Date.now() } };

		return all;
	});

	return true;
};
