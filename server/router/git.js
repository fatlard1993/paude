import path from 'path';

import { requestMatch } from '@vanilla-bean/components/app';

import { credentialOf, identityOf } from '../auth';
import {
	GitError,
	gitAction,
	gitBlame,
	gitBranches,
	gitCommit,
	gitCompare,
	gitLog,
	gitStashes,
	gitStatus,
	hasObject,
	keepFile,
	linesInDiff,
	linesNow,
	pathsFromFolder,
	repoRoot,
} from '../git';
import { draftCommitMessage } from '../commitMessage';
import { diffSet } from '../diffs';
import { draftPullRequest, openPullRequest, pullRequest } from '../pullRequests';
import { diffTour } from '../tours';
import { verification } from '../verification';
import { recordChange } from '../activity';
import { getNotes, markPosted, mergeGithubThread } from '../notes';
import { may } from '../permissions';
import { postReview, pullRequestThreads, reviewPlan, threadAnchor } from '../prReviews';
import { runningSession } from '../sessions/running';
import { markReviewed, reviewState } from '../reviews';
import { sessionRecord } from '../sessions/record';

// The files panel names a path from the session's folder; git, from the top of the repository
const fromRoot = (root, cwd, wanted) => wanted && path.relative(root, path.resolve(cwd, wanted));

// The comments on a file's lines the anchors route places: the open ones, or the one asked for by id, resolved or not.
// Out of a diff, only those on lines after a change.
export const anchoredOn = (comments, { path: file, inDiff, comment: one }) =>
	comments.filter(
		comment =>
			(one ? comment.id === one : !comment.resolved) &&
			comment.anchor?.path === file &&
			(inDiff || comment.anchor.side === 'new'),
	);

const READS = {
	// Each file also named from the session's folder (`here`), which opening it takes; acting on it takes git's name
	status: async (root, query, cwd) => {
		const status = await gitStatus(root);
		const local = await pathsFromFolder(cwd);
		const named = files => files.map(file => ({ ...file, here: local(file.path) }));

		return {
			...status,
			...Object.fromEntries(['staged', 'unstaged', 'untracked', 'conflicted'].map(list => [list, named(status[list])])),
		};
	},
	log: (root, query, cwd) => gitLog(root, { ...query, path: fromRoot(root, cwd, query.path) }),
	commit: (root, { ref }) => gitCommit(root, ref),
	branches: root => gitBranches(root),
	stashes: root => gitStashes(root),
	blame: (root, query, cwd) => gitBlame(root, fromRoot(root, cwd, query.path)),
	compare: (root, { base }) => gitCompare(root, { base }),
	pr: root => pullRequest(root),
	// What to know before proposing the branch: the work not committed (a pull request leaves it out), the comments
	// still open here, and whether what changed was tested since
	ready: async (root, { id }, cwd) => {
		const [status, notes, checked, local] = await Promise.all([
			gitStatus(root),
			getNotes(id),
			verification(id, cwd),
			pathsFromFolder(cwd),
		]);
		const lists = ['staged', 'unstaged', 'untracked', 'conflicted'];

		return {
			uncommitted: [...new Set(lists.flatMap(list => status[list].map(file => local(file.path))))],
			comments: notes.comments.filter(comment => !comment.resolved).length,
			tests: checked && { state: checked.state, said: checked.said },
		};
	},
	reviewed: (root, query, cwd, identity) => reviewState(identity, root),
	// Where the open comments on a file's lines are: in it now ({ [comment id]: { from, to } | null }), or, given the
	// two texts a diff of it is between (old and new, blobs), on each side of that diff ({ [comment id]: { new, old } }).
	// Given a `comment` (its id), only that one, resolved or not.
	anchors: async (root, { id, path: file, old, new: after, comment: one }, cwd) => {
		const inDiff = old !== undefined || after !== undefined;
		const open = anchoredOn((await getNotes(id)).comments, { path: file, inDiff, comment: one });
		// The diff's text after the change may be the file on disk, which git keeps only once a comment needs it
		const newer =
			open.length && after && !(await hasObject(cwd, after)) ? ((await keepFile(cwd, file, after)) ?? after) : after;
		const where = comment =>
			inDiff ? linesInDiff(cwd, comment.anchor, { old, new: newer }) : linesNow(cwd, comment.anchor);

		return Object.fromEntries(await Promise.all(open.map(async comment => [comment.id, await where(comment)])));
	},
	'pr-review': async (root, { id }, cwd, identity) => {
		if (!identity.owner) throw new GitError('Only the owner posts to GitHub, as their own login');

		return reviewPlan(root, cwd, (await getNotes(id)).comments);
	},
};

// A change to the session's comments, out to everyone in it
const shareNote = async (sessionId, update) => {
	if (!update) return;
	runningSession(sessionId)?.broadcast(update);
	await recordChange(sessionId);
};

// The pull request's review threads, brought in as comments on their lines here
const bringInThreads = async (sessionId, root, cwd) => {
	let changed = 0;

	for (const thread of await pullRequestThreads(root)) {
		const update = await mergeGithubThread(sessionId, thread, threadAnchor(thread, root, cwd));

		if (update) changed += 1;
		await shareNote(sessionId, update);
	}

	return { ok: true, changed };
};

// Posted as the owner's GitHub login, so only the owner posts, and only what they chose from what they were shown
const postToPullRequest = async (sessionId, root, cwd, choice) => {
	const { url, posted } = await postReview(root, cwd, (await getNotes(sessionId)).comments, choice);

	for (const { commentId, ...where } of posted)
		await shareNote(sessionId, await markPosted(sessionId, commentId, where));

	return { ok: true, url };
};

// What a pull request's description can draw on besides its commits: a walk-through of what it would hold (told once,
// so one already taken is reused), and whether what changed was tested
const draftNotes = async (sessionId, cwd) => {
	const [tour, checked] = await Promise.all([
		diffSet(sessionId, cwd, { source: 'compare', committed: true })
			.then(set => (set.files.length ? diffTour(set) : null))
			.catch(() => null),
		verification(sessionId, cwd).catch(() => null),
	]);

	return { tour, tested: checked?.said ?? null };
};

// Reading it is all a reviewer needs to do, so marking how far they've read takes no more than reading
const READING_ACTIONS = new Set(['reviewed']);

// The Git panel's routes. Reading the history is reading the project ('files'); anything that changes the checkout or
// its remote is as much a write as typing into Claude ('type').
const gitRoutes = async request => {
	const reading = requestMatch('GET', '/api/sessions/:id/git/:what', request);
	const acting = !reading && requestMatch('POST', '/api/sessions/:id/git/:what', request);
	const match = reading || acting;

	if (!match) return null;

	const identity = identityOf(credentialOf(request));

	if (!may(identity, reading || READING_ACTIONS.has(match.what) ? 'files' : 'type', match.id))
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

			return Response.json(await READS[match.what](root, match, cwd, identity));
		}

		if (match.what === 'reviewed') return Response.json({ ok: await markReviewed(identity, root) });
		if (match.what === 'pr-threads') return Response.json(await bringInThreads(match.id, root, cwd));
		if (match.what === 'pr-review') {
			if (!identity.owner) return new Response('Only the owner posts to GitHub, as their own login', { status: 403 });

			return Response.json(await postToPullRequest(match.id, root, cwd, await request.json()));
		}
		if (match.what === 'message') return Response.json({ ok: true, message: await draftCommitMessage(root) });
		if (match.what === 'pr-draft')
			return Response.json({ ok: true, ...(await draftPullRequest(root, await draftNotes(match.id, cwd))) });
		if (match.what === 'pr') return Response.json({ ok: true, ...(await openPullRequest(root, await request.json())) });

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
