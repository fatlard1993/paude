import path from 'path';

import { diffAnchor, parseDiff } from '../shared/diff';
import { gh } from './gh';
import { GitError, blobOf, hasObject, hasRef, linesBetween, linesNow, mergeBase, splitPatch } from './git';
import { postedBody } from './notes';
import gitEnvironment from './utils/gitEnvironment';

// A pull request's review, both ways, through gh: comments made here on lines of the branch posted as one review
// (only once the owner has seen exactly what goes), and the review threads people left on GitHub brought in as
// comments on the same lines here.
const PR_URL = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/;
const EVENTS = new Set(['COMMENT', 'APPROVE', 'REQUEST_CHANGES']);
const QUOTE_LINES = 20;

// The pull request for the branch checked out at root: { number, url, head, base, baseName, host, owner, name }
export const currentPullRequest = async root => {
	const { code, out, err } = await gh(['pr', 'view', '--json', 'number,url,headRefOid,baseRefOid,baseRefName'], root);

	if (code !== 0)
		throw new GitError(
			/no pull requests found/i.test(err) ? 'This branch has no pull request' : err || 'gh could not look',
		);

	const { number, url, headRefOid, baseRefOid, baseRefName } = JSON.parse(out);
	const [, host, owner, name] = PR_URL.exec(url) ?? [];

	return { number, url, head: headRefOid, base: baseRefOid, baseName: baseRefName, host, owner, name };
};

const api = (pr, args, root, options) =>
	gh(['api', ...(pr.host && pr.host !== 'github.com' ? ['--hostname', pr.host] : []), ...args], root, options);

// What GitHub said when it refused: its message and the reasons under it, else gh's own words
const refusal = ({ out, err }) => {
	try {
		const { message, errors = [] } = JSON.parse(out);
		const reasons = errors.map(reason => (typeof reason === 'string' ? reason : (reason.message ?? reason.code)));

		return [message, ...reasons].filter(Boolean).join(': ') || err;
	} catch {
		return err || 'GitHub refused it';
	}
};

// The lines a review can comment on, per file and side: each hunk's lines, as GitHub numbers them
export const linesInReview = patch =>
	new Map(
		splitPatch(patch).map(({ path: file, diff }) => [
			file,
			parseDiff(diff).hunks.map(({ lines }) => ({
				new: new Set(lines.filter(line => line.new !== undefined).map(line => line.new)),
				old: new Set(lines.filter(line => line.old !== undefined).map(line => line.old)),
			})),
		]),
	);

const covers = (lines, from, to) => {
	for (let line = from; line <= to; line++) if (!lines.has(line)) return false;

	return true;
};

// GitHub takes a comment's lines only when they're all in one hunk of the pull request's diff, both sides of it for
// a comment on both
const fitsOneHunk = (hunks, { from, to, side, old }) =>
	(hunks ?? []).some(hunk => covers(hunk[side], from, to) && (!old || covers(hunk.old, old.from, old.to)));

// What a comment says on GitHub: its text and the replies people gave it, each named but the owner's; Claude's
// answers stay here, since on GitHub they'd read as the owner's own
export const reviewBody = postedBody;

const lineRange = ({ from, to }) => (from === to ? `line ${from}` : `lines ${from}-${to}`);

// A comment's lines, named as the review's text names them
const placeOf = item =>
	`${item.path} ${lineRange(item)}${item.side === 'old' ? ' (before the change)' : ''}${item.old ? `, and ${lineRange(item.old)} before the change` : ''}`;

// Which comments go on their lines and which go in the review's own text, and why: { inline, inBody }. A comment's
// path is the session folder's, GitHub's the repository's. `linesAt(anchor, file)` carries a comment written at an
// earlier commit to the pull request's head: its lines there, or null when the change since touched them, which
// sends it to the text, named by the lines it was on.
export const planReview = async ({ comments, lines, head, root, cwd, linesAt }) => {
	const inline = [];
	const inBody = [];

	for (const comment of comments) {
		const file = path.relative(root, path.resolve(cwd, comment.anchor.path)).split(path.sep).join('/');
		const item = {
			commentId: comment.id,
			author: comment.author,
			mine: comment.authorId === 'owner',
			...comment.anchor,
			path: file,
			body: reviewBody(comment),
		};
		const settled = !comment.anchor.blob && (!comment.anchor.commit || comment.anchor.commit === head);
		const atHead = settled ? comment.anchor : await linesAt(comment.anchor, file);
		const { old, ...alone } = atHead ? { ...item, from: atHead.from, to: atHead.to, old: atHead.old } : {};
		const placed = atHead && (old ? { ...alone, old } : alone);

		if (!placed) inBody.push({ ...item, why: `its lines in ${file} changed since it was written` });
		else if (!lines.has(file)) inBody.push({ ...placed, why: `the pull request doesn't change ${file}` });
		else if (fitsOneHunk(lines.get(file), placed)) inline.push(placed);
		// Its removed lines aren't in the pull request's diff, but the lines that replaced them are
		else if (placed.old && fitsOneHunk(lines.get(file), alone)) inline.push(alone);
		else inBody.push({ ...placed, why: `${lineRange(placed)} aren't among the lines it changes` });
	}

	return { inline, inBody };
};

// The comments that could go: open, on lines of a file, written here, and not posted already
export const postable = comments =>
	comments.filter(comment => !comment.resolved && comment.anchor && !comment.github && !comment.posted);

const sameFile = (root, commit, head, file) =>
	Bun.spawnSync(['git', 'diff', '--quiet', commit, head, '--', file], { cwd: root, env: gitEnvironment() }).exitCode ===
	0;

// Lines after the change move with the commits since, to the head. Lines before it are numbered by the base the pull
// request's diff is against (where the branch parted from its base): read in a diff, they're carried from the text
// they were picked in to the file there; otherwise they stand only while the file is as it was. Carried to a head
// this checkout doesn't have, they'd land on the lines they were on here, so that's refused until it's fetched; lines
// that can't be carried (null) go in the review's text.
export const linesAtHead = (root, pr) => {
	const parted = pr.base ? mergeBase(root, pr.base, pr.head) : Promise.resolve(null);
	const before = async (part, file, commit) => {
		const base = part.blob && (await parted);
		const there = base && (await blobOf(root, file, base));

		if (there) return linesBetween(root, part, part.blob, there);

		return sameFile(root, commit, pr.head, file) ? { from: part.from, to: part.to } : null;
	};

	const fetched = hasObject(root, pr.head);

	return async (anchor, file) => {
		if (!(await fetched))
			throw new GitError(
				"The pull request's latest commit isn't in this checkout, so its comments can't be put on the right lines. Fetch the pull request first (git fetch, or gh pr checkout).",
			);
		if (anchor.side === 'old') return before(anchor, file, anchor.commit);

		const lines = await linesNow(root, { ...anchor, path: file }, pr.head);
		const old = lines && anchor.old && (await before(anchor.old, file, anchor.commit));

		return lines && { ...lines, ...(old && { old: { ...anchor.old, ...old } }) };
	};
};

// What posting would do, for the owner to see first: { pr, inline, inBody }
export const reviewPlan = async (root, cwd, comments) => {
	const pr = await currentPullRequest(root);
	const diff = await gh(['pr', 'diff', String(pr.number)], root);

	if (diff.code !== 0) throw new GitError(diff.err || 'gh could not read its changes');

	const plan = await planReview({
		comments: postable(comments),
		lines: linesInReview(diff.out),
		head: pr.head,
		root,
		cwd,
		linesAt: linesAtHead(root, pr),
	});

	return { pr, ...plan };
};

const summaryOf = (text, inBody) =>
	[text?.trim(), ...inBody.map(item => `**${placeOf(item)}**\n\n${item.body}`)].filter(Boolean).join('\n\n---\n\n');

// Every item of a listing, across its pages, one JSON object per line (gh's --paginate alone would print one array per
// page, back to back)
const listAll = async (pr, route, root) => {
	const listed = await api(pr, [route, '--paginate', '--jq', '.[]'], root);

	if (listed.code !== 0) return null;

	return listed.out
		.split('\n')
		.filter(Boolean)
		.map(line => JSON.parse(line));
};

const LISTING_TRIES = 2;

// A review's comments on GitHub, listed again once if the first listing fails
const reviewComments = async (pr, route, root, reviewId) => {
	for (let tries = 1; ; tries++) {
		const listed = await listAll(pr, `${route}/reviews/${reviewId}/comments`, root);

		if (listed || tries >= LISTING_TRIES) return listed ?? [];
	}
};

// Which GitHub comment each posted one became, by its file, lines, side and text, each GitHub comment taken once (two
// comments saying the same on the same lines are two): [{ commentId, githubId, url }]
export const matchPosted = (inline, onGithub, reviewUrl) => {
	const left = [...onGithub];

	return inline.map(item => {
		const wanted = reviewComment(item);
		const at = left.findIndex(
			each =>
				each.path === wanted.path &&
				each.line === wanted.line &&
				(each.side ?? 'RIGHT') === wanted.side &&
				each.body === wanted.body,
		);
		const [found] = at === -1 ? [] : left.splice(at, 1);

		return { commentId: item.commentId, githubId: found?.id, url: found?.html_url ?? reviewUrl };
	});
};

const sameComments = (made, wanted) => {
	const key = ({ path: file, body }) => JSON.stringify([file, body]);

	return JSON.stringify(made.map(key).sort()) === JSON.stringify(wanted.map(key).sort());
};

const STATE_OF = { COMMENT: 'COMMENTED', APPROVE: 'APPROVED', REQUEST_CHANGES: 'CHANGES_REQUESTED' };

// The same review already on GitHub: the owner's, at this head, saying the same as it would. Found after gh gave up
// (a timeout, a dropped connection) when GitHub may have taken it anyway, or before a retry, it's the one to keep.
export const findPosted = ({ reviews, login, request }) =>
	reviews.find(
		review =>
			review.user?.login === login &&
			review.commit_id === request.commit_id &&
			review.state === (STATE_OF[request.event] ?? 'PENDING') &&
			(review.body ?? '') === (request.body ?? ''),
	);

const alreadyPosted = async (pr, route, root, request) => {
	const login = await api(pr, ['user', '--jq', '.login'], root);
	const reviews = login.code === 0 && (await listAll(pr, `${route}/reviews`, root));
	const found = reviews && findPosted({ reviews, login: login.out.trim(), request });

	if (!found) return null;

	const made = await listAll(pr, `${route}/reviews/${found.id}/comments`, root);

	return made && sameComments(made, request.comments) ? found : null;
};

// A comment on its lines as GitHub takes it: one side, or from removed lines down into the lines that replaced them
export const reviewComment = item => {
	const where = { path: item.path, body: item.body };

	if (item.old?.leads) return { ...where, start_line: item.old.from, start_side: 'LEFT', line: item.to, side: 'RIGHT' };

	const side = item.side === 'old' ? 'LEFT' : 'RIGHT';

	return { ...where, line: item.to, side, ...(item.from !== item.to && { start_line: item.from, start_side: side }) };
};

const posting = new Set();

// One review: the chosen comments on their lines, the rest in its text after the summary, as a comment, an approval,
// a request for changes, or left pending on GitHub for its author to finish there. Resolves to { url, posted }, where
// posted says which GitHub comment each became (its id, or the review itself for one in the text). One post at a time
// per pull request, and the same review already there (one gh lost track of, say) is kept rather than posted again.
export const postReview = async (root, cwd, comments, { commentIds = [], body, event }) => {
	const chosen = postable(comments).filter(comment => commentIds.includes(comment.id));
	const { pr, inline, inBody } = await reviewPlan(root, cwd, chosen);
	const summary = summaryOf(body, inBody);

	if (!inline.length && !summary && event !== 'APPROVE') throw new GitError('There is nothing to post');

	const route = `repos/${pr.owner}/${pr.name}/pulls/${pr.number}`;

	if (posting.has(route)) throw new GitError('A review is already being posted to this pull request');

	const request = {
		commit_id: pr.head,
		...(summary && { body: summary }),
		...(EVENTS.has(event) && { event }),
		comments: inline.map(reviewComment),
	};
	let review;

	posting.add(route);
	try {
		review = await alreadyPosted(pr, route, root, request);

		if (!review) {
			const made = await api(pr, [`${route}/reviews`, '--method', 'POST', '--input', '-'], root, {
				input: JSON.stringify(request),
			});

			review = made.code === 0 ? JSON.parse(made.out) : await alreadyPosted(pr, route, root, request);
			if (!review) throw new GitError(refusal(made));
		}
	} finally {
		posting.delete(route);
	}

	const onGithub = await reviewComments(pr, route, root, review.id);

	return {
		url: review.html_url,
		posted: [
			...matchPosted(inline, onGithub, review.html_url),
			...inBody.map(item => ({ commentId: item.commentId, url: review.html_url })),
		],
	};
};

const COMMENT_FIELDS = 'databaseId body url createdAt author { login } diffHunk originalCommit { oid }';

const THREADS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $after: String) {
	repository(owner: $owner, name: $name) {
		pullRequest(number: $number) {
			reviewThreads(first: 100, after: $after) {
				pageInfo { hasNextPage endCursor }
				nodes {
					id isResolved isOutdated path line startLine originalLine originalStartLine diffSide startDiffSide
					comments(first: 100) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } }
				}
			}
		}
	}
}`;

const COMMENTS_QUERY = `query($id: ID!, $after: String) {
	node(id: $id) {
		... on PullRequestReviewThread {
			comments(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { ${COMMENT_FIELDS} } }
		}
	}
}`;

// Every review thread with every comment, page by page at both levels. `ask(query, variables)` resolves to GraphQL's
// data.
export const allThreads = async (ask, { owner, name, number }) => {
	const threads = [];

	for (let after = null; ;) {
		const page = (await ask(THREADS_QUERY, { owner, name, number, after }))?.repository?.pullRequest?.reviewThreads;

		for (const node of page?.nodes ?? []) {
			const comments = [...node.comments.nodes];

			for (let more = node.comments.pageInfo; more?.hasNextPage;) {
				const next = (await ask(COMMENTS_QUERY, { id: node.id, after: more.endCursor }))?.node?.comments;

				comments.push(...(next?.nodes ?? []));
				more = next?.pageInfo;
			}
			threads.push({ ...node, comments: { nodes: comments } });
		}

		if (!page?.pageInfo?.hasNextPage) return threads;
		after = page.pageInfo.endCursor;
	}
};

// A thread from removed lines down into the lines that replaced them, numbered as `line` and `startLine` are (the
// head's, or its own commit's when outdated): the new lines and the removed ones, found in the diff it was written on
// (whose numbers are its original ones). Null when the diff doesn't show them.
const acrossTheChange = node => {
	const lines = parseDiff(node.comments.nodes[0]?.diffHunk ?? '').hunks.flatMap(hunk => hunk.lines);
	const first = lines.findIndex(line => line.old === node.originalStartLine);
	const last = lines.findLastIndex(line => line.new === node.originalLine);
	const anchor = first !== -1 && last >= first && diffAnchor(node.path, lines.slice(first, last + 1));

	if (!anchor || anchor.side !== 'new' || !anchor.old) return null;

	const moved = node.line ? node.line - node.originalLine : 0;
	const movedOld = node.line && node.startLine ? node.startLine - node.originalStartLine : 0;

	return {
		from: anchor.from + moved,
		to: anchor.to + moved,
		old: { ...anchor.old, from: anchor.old.from + movedOld, to: anchor.old.to + movedOld },
		shown: last - first + 1,
	};
};

// One GitHub review thread as a comment here would hold it, at the commit its lines are numbered by: the pull
// request's head, or for an outdated thread the commit it was written at, whose lines it keeps
export const threadOf = (node, head) => {
	const comments = node.comments.nodes.map(comment => ({
		id: comment.databaseId,
		author: comment.author?.login ?? 'ghost',
		text: comment.body,
		at: Date.parse(comment.createdAt),
		url: comment.url,
	}));
	const end = node.line ?? node.originalLine;
	// Started on the other side of the change, its first line is numbered by that side: carried across, or just its
	// last line where the diff doesn't show how
	const across = node.startDiffSide && node.startDiffSide !== node.diffSide;
	const both = across && node.diffSide === 'RIGHT' && acrossTheChange(node);
	const {
		from,
		to,
		old,
		shown = to - from + 1,
	} = both || {
		from: across ? end : ((node.line ? node.startLine : node.originalStartLine) ?? end),
		to: end,
	};
	const hunk = node.comments.nodes[0]?.diffHunk ?? '';

	return {
		id: node.id,
		path: node.path,
		from,
		to,
		side: node.diffSide === 'LEFT' ? 'old' : 'new',
		...(old && { old }),
		commit: node.line ? head : node.comments.nodes[0]?.originalCommit?.oid,
		resolved: node.isResolved,
		outdated: node.isOutdated,
		quote: hunk.split('\n').slice(-Math.min(shown, QUOTE_LINES)).join('\n'),
		comments,
	};
};

// Where a thread is in the session's folder: GitHub names its file from the top of the repository
export const threadAnchor = (thread, root, cwd) => ({
	...thread,
	path: path.relative(cwd, path.join(root, thread.path)).split(path.sep).join('/'),
});

// The text lines before the change are numbered by: the file where the branch parted from the base
const baseBlob = async (root, pr, thread) => {
	const parted = thread.commit && pr.base && (await mergeBase(root, pr.base, thread.commit));

	return parted ? blobOf(root, thread.path, parted) : undefined;
};

// The text a thread's lines are numbered by: the file at its commit for lines after the change, and for lines before
// it, the file where the branch parted from the base
const threadBlob = async (root, pr, thread) => {
	if (!thread.commit) return undefined;
	if (thread.side === 'new') return blobOf(root, thread.path, thread.commit);

	return baseBlob(root, pr, thread);
};

// The base branch as this checkout knows it, to compare with, if it does
const localBase = async (root, pr) => {
	const name = pr.baseName && `origin/${pr.baseName}`;

	return name && (await hasRef(root, name)) ? name : null;
};

// The pull request's review threads that are on lines (a review's own text has none), with where they are
export const pullRequestThreads = async root => {
	const pr = await currentPullRequest(root);
	const ask = async (query, variables) => {
		const fields = Object.entries(variables)
			.filter(([, value]) => value !== null && value !== undefined)
			.flatMap(([key, value]) => [typeof value === 'number' ? '-F' : '-f', `${key}=${value}`]);
		const result = await api(pr, ['graphql', '-f', `query=${query}`, ...fields], root);

		if (result.code !== 0) throw new GitError(refusal(result));

		return JSON.parse(result.out).data;
	};
	const nodes = await allThreads(ask, pr);
	const threads = nodes
		.filter(node => node.comments.nodes.length && (node.line ?? node.originalLine))
		.map(node => threadOf(node, pr.head));
	const base = await localBase(root, pr);
	const diff = { source: 'compare', ...(base && { base }) };

	return Promise.all(
		threads.map(async thread => {
			const oldBlob = thread.old && (await baseBlob(root, pr, thread));

			return {
				...thread,
				...(oldBlob && { old: { ...thread.old, blob: oldBlob } }),
				blob: await threadBlob(root, pr, thread),
				diff,
			};
		}),
	);
};
