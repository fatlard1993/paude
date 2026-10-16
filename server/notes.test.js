import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, test } from 'bun:test';

import {
	addChat,
	addComment,
	addReply,
	cleanAnchor,
	deleteComment,
	getNotes,
	initNotes,
	markPosted,
	mergeGithubThread,
	setResolved,
} from './notes';

let sessionId;

beforeEach(async () => {
	await initNotes(await mkdtemp(path.join(os.tmpdir(), 'paude-notes-')));
	sessionId = crypto.randomUUID();
});

describe('chat', () => {
	test('keeps messages in order with their author', async () => {
		await addChat(sessionId, 'ana', 'first');
		const { message } = await addChat(sessionId, 'ben', ' second ');

		expect(message).toMatchObject({ author: 'ben', text: 'second' });
		expect((await getNotes(sessionId)).chat.map(({ text }) => text)).toEqual(['first', 'second']);
	});

	test('ignores empty messages and caps long ones', async () => {
		expect(await addChat(sessionId, 'ana', '   ')).toBeNull();
		expect(await addChat(sessionId, 'ana', 42)).toBeNull();
		expect((await addChat(sessionId, 'ana', 'x'.repeat(5000))).message.text).toHaveLength(4000);
	});

	test('falls back to a placeholder author', async () => {
		expect((await addChat(sessionId, '', 'hi')).message.author).toBe('someone');
	});
});

describe('comments', () => {
	test('keep where in a file they are, when that makes sense', async () => {
		const { comment } = await addComment(sessionId, 'ana', {
			quote: 'const x = 1;',
			text: 'why one?',
			anchor: { path: 'src/a.js', from: 3, to: 4, side: 'old', commit: 'a'.repeat(40), blob: 'b'.repeat(40) },
		});

		expect(comment.anchor).toEqual({
			path: 'src/a.js',
			from: 3,
			to: 4,
			side: 'old',
			commit: 'a'.repeat(40),
			blob: 'b'.repeat(40),
		});
		expect(cleanAnchor({ path: 'a.js', from: 2 })).toEqual({ path: 'a.js', from: 2, to: 2, side: 'new' });
		expect(cleanAnchor({ path: 'a.js', from: 5, to: 4 })).toBeNull();
		expect(cleanAnchor({ path: '', from: 1 })).toBeNull();
		expect(cleanAnchor({ path: 'a.js', from: 0 })).toBeNull();
		expect(
			cleanAnchor({
				path: 'a.js',
				from: 2,
				old: { from: 1, to: 2, blob: 'c'.repeat(40), leads: true, extra: 1 },
				diff: { source: 'commit', ref: 'abc', evil: 'x' },
			}),
		).toEqual({
			path: 'a.js',
			from: 2,
			to: 2,
			side: 'new',
			old: { from: 1, to: 2, blob: 'c'.repeat(40), leads: true },
			diff: { source: 'commit', ref: 'abc' },
		});
		// Removed lines alone have no other side; a diff of no known kind isn't kept
		expect(
			cleanAnchor({ path: 'a.js', from: 2, side: 'old', old: { from: 1, to: 1 }, diff: { source: 'rm -rf' } }),
		).toEqual({ path: 'a.js', from: 2, to: 2, side: 'old' });
		expect(cleanAnchor({ path: 'a.js', from: 1, commit: 'nope' })).toEqual({
			path: 'a.js',
			from: 1,
			to: 1,
			side: 'new',
		});
	});

	test('on terminal output have no anchor', async () => {
		const { comment } = await addComment(sessionId, 'ana', { quote: 'out', text: 'hm', anchor: 'junk' });

		expect(comment.anchor).toBeUndefined();
	});

	test('need both a quote and a comment', async () => {
		expect(await addComment(sessionId, 'ana', { quote: 'some output', text: '' })).toBeNull();
		expect(await addComment(sessionId, 'ana', { quote: '', text: 'why?' })).toBeNull();
	});

	test('on blank lines of a file quote where they are, rather than being dropped', async () => {
		const { comment } = await addComment(sessionId, 'ana', {
			quote: '\n  \n',
			text: 'add a test here',
			anchor: { path: 'src/a.js', from: 4, to: 5 },
		});

		expect(comment.quote).toBe('src/a.js lines 4-5');
		expect(comment.anchor).toMatchObject({ path: 'src/a.js', from: 4, to: 5 });
	});

	test('never name a file from the root, or a secret', () => {
		for (const where of ['/home/u/.aws/credentials', 'C:\\Users\\u\\x', '\\\\host\\share', '.env', 'config/server.pem'])
			expect(cleanAnchor({ path: where, from: 1 })).toBeNull();
		expect(cleanAnchor({ path: '../lib/b.js', from: 1 })).toMatchObject({ path: '../lib/b.js' });
	});

	test('thread replies and resolve', async () => {
		const { comment } = await addComment(sessionId, 'ana', { quote: 'npm ERR! code 1', text: 'is this the lockfile?' });

		const replied = await addReply(sessionId, 'ben', { commentId: comment.id, text: 'yes, regenerate it' });

		expect(replied.comment.replies).toMatchObject([{ author: 'ben', text: 'yes, regenerate it' }]);
		expect((await setResolved(sessionId, { commentId: comment.id, resolved: true })).comment.resolved).toBe(true);
	});

	test('delete a reply, or a comment with its replies, when allowed', async () => {
		const { comment } = await addComment(sessionId, 'ana', { quote: 'some output', text: 'odd' }, 'invite:ana');
		const { comment: replied } = await addReply(
			sessionId,
			'ben',
			{ commentId: comment.id, text: 'agreed' },
			'invite:ben',
		);
		const [reply] = replied.replies;
		const byAna = note => note.authorId === 'invite:ana';

		expect(await deleteComment(sessionId, { commentId: comment.id, replyId: reply.id, allowed: byAna })).toBeNull();
		expect((await deleteComment(sessionId, { commentId: comment.id, replyId: reply.id })).comment.replies).toEqual([]);
		expect(await deleteComment(sessionId, { commentId: comment.id, allowed: byAna })).toEqual({
			type: 'commentDeleted',
			commentId: comment.id,
		});
		expect((await getNotes(sessionId)).comments.some(({ id }) => id === comment.id)).toBe(false);
	});

	test('a reply to a missing comment changes nothing', async () => {
		expect(await addReply(sessionId, 'ben', { commentId: 'nope', text: 'hello?' })).toBeNull();
	});
});

test('notes are saved to disk', async () => {
	const dataDir = await mkdtemp(path.join(os.tmpdir(), 'paude-notes-'));

	await initNotes(dataDir);
	await addChat(sessionId, 'ana', 'remember me');

	const stored = await Bun.file(path.join(dataDir, 'sessions', `${sessionId}.json`)).json();

	expect(stored.chat[0].text).toBe('remember me');
});

test('simultaneous saves all land, without colliding on the temp file', async () => {
	const dataDir = await mkdtemp(path.join(os.tmpdir(), 'paude-notes-'));

	await initNotes(dataDir);
	await Promise.all(Array.from({ length: 20 }, (_, index) => addChat(sessionId, 'ana', `message ${index}`)));
	await Bun.sleep(50);

	const stored = await Bun.file(path.join(dataDir, 'sessions', `${sessionId}.json`)).json();
	const leftovers = [...new Bun.Glob('sessions/*.tmp').scanSync(dataDir)];

	expect(stored.chat).toHaveLength(20);
	expect(leftovers).toEqual([]);
});

test('chat keeps only the most recent messages past its cap', async () => {
	for (let index = 0; index < 2005; index++) (await getNotes(sessionId)).chat.push({ text: String(index) });

	await addChat(sessionId, 'ana', 'newest');

	const { chat } = await getNotes(sessionId);

	expect(chat).toHaveLength(2000);
	expect(chat.at(-1).text).toBe('newest');
});

test('reactions toggle per person, on comments, replies and chat, and only take emoji', async () => {
	const { react, validEmoji } = await import('./notes');
	const { message } = await addChat('reacting', 'ann', 'hello');
	const { comment } = await addComment('reacting', 'ann', { quote: 'q', text: 'look' });
	const { comment: replied } = await addReply('reacting', 'bob', { commentId: comment.id, text: 'ok' });
	const replyId = replied.replies[0].id;
	const bob = { id: 'invite:b', name: 'bob' };
	const ann = { id: 'owner', name: 'ann' };
	const as = (who, target) => react('reacting', who.name, target, who.id);

	expect((await as(bob, { chatId: message.id, emoji: '👍' })).message.reactions).toEqual({ '👍': [bob] });
	expect((await as(ann, { chatId: message.id, emoji: '👍' })).message.reactions).toEqual({ '👍': [bob, ann] });
	expect((await as(bob, { chatId: message.id, emoji: '👍' })).message.reactions).toEqual({ '👍': [ann] });

	// Someone else under the same name is someone else
	const otherBob = { id: 'invite:c', name: 'bob' };

	expect((await as(otherBob, { chatId: message.id, emoji: '👍' })).message.reactions['👍']).toEqual([ann, otherBob]);

	expect((await as(bob, { commentId: comment.id, emoji: '🎉' })).comment.reactions).toEqual({ '🎉': [bob] });
	expect((await as(ann, { commentId: comment.id, replyId, emoji: '❤️' })).comment.replies[0].reactions).toEqual({
		'❤️': [ann],
	});

	for (const emoji of ['👍🏽', '🧑‍💻', '❤️']) expect(validEmoji(emoji)).toBe(true);
	for (const emoji of ['a', '<b>', '👍x', '', '👍'.repeat(9)]) expect(validEmoji(emoji)).toBe(false);
	expect(await as(bob, { chatId: message.id, emoji: 'nope' })).toBeNull();
});

describe("a pull request's threads", () => {
	const thread = (comments, extra = {}) => ({
		id: 'T1',
		resolved: false,
		outdated: false,
		quote: '+x',
		comments,
		...extra,
	});
	const said = (id, author, text) => ({ id, author, text, at: 1, url: `https://github.com/o/r/pull/1#r${id}` });
	const anchor = { path: 'a.js', from: 2, to: 2, side: 'new' };

	test('come in as comments on their lines, and catch up with replies without doubling', async () => {
		const { comment } = await mergeGithubThread(sessionId, thread([said(1, 'cam', 'why?')]), anchor);

		expect(comment).toMatchObject({
			author: 'cam',
			authorId: 'github:cam',
			text: 'why?',
			anchor,
			github: { threadId: 'T1' },
		});
		expect(await mergeGithubThread(sessionId, thread([said(1, 'cam', 'why?')]), anchor)).toBeNull();

		const caught = await mergeGithubThread(
			sessionId,
			thread([said(1, 'cam', 'why?'), said(2, 'dee', 'because')]),
			anchor,
		);

		expect(caught.comment.replies).toMatchObject([{ author: 'dee', text: 'because' }]);
		expect((await getNotes(sessionId)).comments).toHaveLength(1);
	});

	test("follow GitHub's resolution only when it changes there", async () => {
		const { comment } = await mergeGithubThread(sessionId, thread([said(1, 'cam', 'why?')]), anchor);

		await setResolved(sessionId, { commentId: comment.id, resolved: true });
		expect(await mergeGithubThread(sessionId, thread([said(1, 'cam', 'why?')]), anchor)).toBeNull();

		const reopened = await mergeGithubThread(sessionId, thread([said(1, 'cam', 'why?')], { resolved: true }), anchor);

		expect(reopened.comment.resolved).toBe(true);
	});

	test('find a comment posted from here, and bring its replies back to it', async () => {
		const { comment } = await addComment(sessionId, 'ana', { quote: 'x', text: 'rename this', anchor }, 'owner');

		await markPosted(sessionId, comment.id, { url: 'https://github.com/o/r/pull/1#r9', githubId: 9 });

		const { comment: back } = await mergeGithubThread(
			sessionId,
			thread([said(9, 'ana-gh', 'rename this'), said(10, 'cam', 'done')]),
			anchor,
		);

		expect(back.id).toBe(comment.id);
		expect(back.replies).toMatchObject([{ author: 'cam', text: 'done' }]);
		expect((await getNotes(sessionId)).comments).toHaveLength(1);
	});

	test('find a comment posted from here whose GitHub id never came back, by its file and what it said', async () => {
		const { comment } = await addComment(sessionId, 'ana', { quote: 'x', text: 'rename this', anchor }, 'invite:ana');

		await addReply(sessionId, 'ben', { commentId: comment.id, text: 'agreed' }, 'invite:ben');
		await markPosted(sessionId, comment.id, { url: 'https://github.com/o/r/pull/1#pullrequestreview-5' });

		const elsewhere = await mergeGithubThread(
			sessionId,
			thread([said(20, 'ana-gh', '**ana:** rename this\n\n**ben:** agreed')], { id: 'T2' }),
			{ ...anchor, path: 'b.js' },
		);

		expect(elsewhere.comment.id).not.toBe(comment.id);

		const { comment: back } = await mergeGithubThread(
			sessionId,
			thread([said(21, 'ana-gh', '**ana:** rename this\n\n**ben:** agreed'), said(22, 'cam', 'done')]),
			anchor,
		);

		expect(back.id).toBe(comment.id);
		expect(back.replies.map(({ text }) => text)).toEqual(['agreed', 'done']);
		expect((await getNotes(sessionId)).comments).toHaveLength(2);
	});
});
