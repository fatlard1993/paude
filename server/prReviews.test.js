import { mkdtemp, rm } from 'fs/promises';
import os from 'os';
import path from 'path';
import { expect, test } from 'bun:test';

import {
	allThreads,
	findPosted,
	linesAtHead,
	linesInReview,
	matchPosted,
	planReview,
	postable,
	reviewBody,
	reviewComment,
	threadAnchor,
	threadOf,
} from './prReviews';

const PATCH = [
	'diff --git a/src/a.js b/src/a.js',
	'--- a/src/a.js',
	'+++ b/src/a.js',
	'@@ -10,3 +10,4 @@',
	' keep',
	'-gone',
	'+new one',
	'+new two',
	' keep',
	'@@ -40,2 +41,2 @@',
	' far',
	'+farther',
].join('\n');

const comment = (id, anchor, extra = {}) => ({
	id,
	author: 'ana',
	authorId: 'owner',
	text: `about ${id}`,
	replies: [],
	resolved: false,
	anchor: { side: 'new', ...anchor },
	...extra,
});

test('a review goes on lines in one hunk of the pull request, the rest in its text with why', async () => {
	const lines = linesInReview(PATCH);
	const { inline, inBody } = await planReview({
		comments: [
			comment('in', { path: 'a.js', from: 11, to: 12 }),
			comment('removed', { path: 'a.js', from: 11, to: 11, side: 'old' }),
			comment('across', { path: 'a.js', from: 12, to: 41 }),
			comment('untouched', { path: 'b.js', from: 1, to: 1 }),
			comment('moved', { path: 'a.js', from: 9, to: 10, commit: 'a'.repeat(40) }),
			comment('touched', { path: 'a.js', from: 11, to: 11, commit: 'a'.repeat(40) }),
		],
		lines,
		head: 'b'.repeat(40),
		root: '/repo',
		cwd: '/repo/src',
		// Two lines went in above 'moved' since it was written; 'touched' was changed
		linesAt: async anchor => (anchor.from === 9 ? { from: 11, to: 12 } : null),
	});

	expect(inline.map(({ commentId, path, from, to }) => [commentId, path, from, to])).toEqual([
		['in', 'src/a.js', 11, 12],
		['removed', 'src/a.js', 11, 11],
		['moved', 'src/a.js', 11, 12],
	]);
	expect(inBody.map(({ commentId, why }) => [commentId, why])).toEqual([
		['across', "lines 12-41 aren't among the lines it changes"],
		['untouched', "the pull request doesn't change src/b.js"],
		['touched', 'its lines in src/a.js changed since it was written'],
	]);
});

test("a comment's text names everyone but the owner, and leaves Claude's answers here", () => {
	expect(
		reviewBody(
			comment(
				'x',
				{ path: 'a.js', from: 1 },
				{
					replies: [
						{ author: 'ben', authorId: 'invite:ben', text: 'agreed' },
						{ author: 'Claude', authorId: 'claude', text: 'I can fix it', fromClaude: true },
					],
				},
			),
		),
	).toBe('about x\n\n**ben:** agreed');
});

test('only open comments on lines, written here and not yet posted, can be posted', () => {
	const open = comment('open', { path: 'a.js', from: 1 });

	expect(
		postable([
			open,
			comment('done', { path: 'a.js', from: 1 }, { resolved: true }),
			comment('posted', { path: 'a.js', from: 1 }, { posted: { url: 'u' } }),
			comment('theirs', { path: 'a.js', from: 1 }, { github: { threadId: 't' } }),
			{ ...open, id: 'terminal', anchor: undefined },
		]),
	).toEqual([open]);
});

test("a GitHub thread keeps its lines, or the lines it was written on once it's outdated", () => {
	const node = {
		id: 'T1',
		isResolved: false,
		isOutdated: true,
		path: 'src/a.js',
		line: null,
		startLine: null,
		originalLine: 12,
		originalStartLine: 11,
		diffSide: 'RIGHT',
		comments: {
			nodes: [
				{
					databaseId: 7,
					body: 'hm',
					url: 'https://github.com/o/r/pull/1#discussion_r7',
					createdAt: '2026-10-01T00:00:00Z',
					author: { login: 'cam' },
					diffHunk: '@@ -10,3 +10,4 @@\n keep\n-gone\n+new one\n+new two',
				},
			],
		},
	};

	node.comments.nodes[0].originalCommit = { oid: 'c'.repeat(40) };

	expect(threadOf(node, 'h'.repeat(40))).toMatchObject({
		commit: 'c'.repeat(40),
		id: 'T1',
		from: 11,
		to: 12,
		side: 'new',
		outdated: true,
		quote: '+new one\n+new two',
		comments: [{ id: 7, author: 'cam', text: 'hm' }],
	});
});

test("a thread's file is named from the session's folder, not the repository's top", () => {
	expect(threadAnchor({ path: 'src/a.js', from: 1, to: 2 }, '/repo', '/repo/src')).toEqual({
		path: 'a.js',
		from: 1,
		to: 2,
	});
	expect(threadAnchor({ path: 'src/a.js', from: 1 }, '/repo', '/repo').path).toBe('src/a.js');
});

test('a current GitHub thread is numbered by the head of the pull request', () => {
	const node = {
		id: 'T2',
		isResolved: false,
		isOutdated: false,
		path: 'a.js',
		line: 5,
		startLine: null,
		diffSide: 'RIGHT',
		comments: {
			nodes: [
				{ databaseId: 1, body: 'x', author: { login: 'cam' }, diffHunk: '+x', originalCommit: { oid: 'c'.repeat(40) } },
			],
		},
	};

	expect(threadOf(node, 'h'.repeat(40))).toMatchObject({ from: 5, to: 5, commit: 'h'.repeat(40) });
});

test("the same review already on GitHub is found: the owner's, at this head, in the same state, saying the same", () => {
	const request = { commit_id: 'h', body: 'looks good', event: 'APPROVE', comments: [] };
	const review = (extra = {}) => ({
		id: 1,
		user: { login: 'ana' },
		commit_id: 'h',
		state: 'APPROVED',
		body: 'looks good',
		...extra,
	});

	expect(findPosted({ reviews: [review()], login: 'ana', request })?.id).toBe(1);
	for (const other of [
		review({ user: { login: 'ben' } }),
		review({ commit_id: 'older' }),
		review({ state: 'COMMENTED' }),
		review({ body: 'nope' }),
	])
		expect(findPosted({ reviews: [other], login: 'ana', request })).toBeUndefined();

	const pending = { commit_id: 'h', comments: [] };

	expect(findPosted({ reviews: [review({ state: 'PENDING', body: '' })], login: 'ana', request: pending })?.id).toBe(1);
});

test('a comment on a change and what replaced it goes on both sides, or on the new lines when the removed ones moved off', async () => {
	const { inline, inBody } = await planReview({
		comments: [
			comment('both', { path: 'a.js', from: 11, to: 12, old: { from: 10, to: 11, leads: true } }),
			comment('old gone', { path: 'a.js', from: 11, to: 11, old: { from: 30, to: 30, leads: true } }),
			comment('across', { path: 'a.js', from: 12, to: 41, old: { from: 11, to: 11 } }),
		],
		lines: linesInReview(PATCH),
		head: 'b'.repeat(40),
		root: '/repo',
		cwd: '/repo/src',
		linesAt: async anchor => anchor,
	});

	expect(inline.map(({ commentId, from, to, old }) => [commentId, from, to, old])).toEqual([
		['both', 11, 12, { from: 10, to: 11, leads: true }],
		['old gone', 11, 11, undefined],
	]);
	expect(inBody.map(({ commentId }) => commentId)).toEqual(['across']);
	expect(reviewComment({ ...inline[0], path: 'src/a.js', body: 'b' })).toEqual({
		path: 'src/a.js',
		body: 'b',
		start_line: 10,
		start_side: 'LEFT',
		line: 12,
		side: 'RIGHT',
	});
	expect(reviewComment({ path: 'x', body: 'b', from: 3, to: 3, side: 'old' })).toEqual({
		path: 'x',
		body: 'b',
		line: 3,
		side: 'LEFT',
	});
	// Starting on the new lines, only they go on GitHub's lines
	expect(reviewComment({ path: 'x', body: 'b', from: 4, to: 5, side: 'new', old: { from: 6, to: 6 } })).toEqual({
		path: 'x',
		body: 'b',
		line: 5,
		side: 'RIGHT',
		start_line: 4,
		start_side: 'RIGHT',
	});
});

test('every thread and every comment comes in, across pages of both', async () => {
	const comment = id => ({ databaseId: id, body: `c${id}` });
	const asked = [];
	const ask = async (query, variables) => {
		asked.push(variables);
		if (variables.id)
			return {
				node: {
					comments: {
						pageInfo: { hasNextPage: variables.after === 'c1', endCursor: 'c2' },
						nodes: [comment(variables.after === 'c1' ? 2 : 3)],
					},
				},
			};

		const second = variables.after === 't1';

		return {
			repository: {
				pullRequest: {
					reviewThreads: {
						pageInfo: { hasNextPage: !second, endCursor: 't1' },
						nodes: [
							{
								id: second ? 'B' : 'A',
								comments: {
									pageInfo: { hasNextPage: !second, endCursor: 'c1' },
									nodes: [comment(second ? 9 : 1)],
								},
							},
						],
					},
				},
			},
		};
	};

	const threads = await allThreads(ask, { owner: 'o', name: 'r', number: 1 });

	expect(threads.map(thread => [thread.id, thread.comments.nodes.map(each => each.databaseId)])).toEqual([
		['A', [1, 2, 3]],
		['B', [9]],
	]);
	expect(asked.filter(variables => !variables.id).map(variables => variables.after)).toEqual([null, 't1']);
});

test("a thread from removed lines into the new ones keeps both sides; one the diff doesn't show keeps its last line", () => {
	const node = {
		id: 'T3',
		isResolved: false,
		isOutdated: false,
		path: 'src/a.js',
		line: 13,
		startLine: 11,
		originalLine: 12,
		originalStartLine: 11,
		diffSide: 'RIGHT',
		startDiffSide: 'LEFT',
		comments: {
			nodes: [
				{
					databaseId: 1,
					body: 'x',
					author: { login: 'cam' },
					diffHunk: '@@ -10,3 +10,4 @@\n keep\n-gone\n+new one\n+new two',
				},
			],
		},
	};

	// One line went in above it since it was written
	expect(threadOf(node, 'h'.repeat(40))).toMatchObject({
		side: 'new',
		from: 12,
		to: 13,
		old: { from: 11, to: 11, leads: true },
		quote: '-gone\n+new one\n+new two',
	});

	const unshown = threadOf({ ...node, comments: { nodes: [{ ...node.comments.nodes[0], diffHunk: '+x' }] } }, 'h');

	expect(unshown).toMatchObject({ side: 'new', from: 13, to: 13 });
	expect(unshown.old).toBeUndefined();
});

test('posted comments find their GitHub ones by file, lines, side and text, each taken once', () => {
	const item = (commentId, extra = {}) => ({
		commentId,
		path: 'a.js',
		from: 3,
		to: 3,
		side: 'new',
		body: 'same',
		...extra,
	});
	const onGithub = [
		{ id: 1, path: 'a.js', line: 3, side: 'RIGHT', body: 'same', html_url: 'u1' },
		{ id: 2, path: 'a.js', line: 3, side: 'RIGHT', body: 'same', html_url: 'u2' },
		{ id: 3, path: 'a.js', line: 3, side: 'LEFT', body: 'same', html_url: 'u3' },
	];

	expect(matchPosted([item('x'), item('y'), item('z', { side: 'old' }), item('w', { to: 4 })], onGithub, 'r')).toEqual([
		{ commentId: 'x', githubId: 1, url: 'u1' },
		{ commentId: 'y', githubId: 2, url: 'u2' },
		{ commentId: 'z', githubId: 3, url: 'u3' },
		{ commentId: 'w', githubId: undefined, url: 'r' },
	]);
});

test("comments aren't carried to a pull request head this checkout hasn't fetched", async () => {
	const root = await mkdtemp(path.join(os.tmpdir(), 'paude-pr-'));

	try {
		Bun.spawnSync(['git', 'init', '-q'], {
			cwd: root,
			env: Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.startsWith('GIT_'))),
		});
		await expect(
			linesAtHead(root, { head: 'f'.repeat(40) })(
				{ path: 'a.js', from: 1, to: 1, side: 'new', blob: 'e'.repeat(40) },
				'a.js',
			),
		).rejects.toThrow('Fetch the pull request first');
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
