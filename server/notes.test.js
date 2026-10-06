import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeEach, describe, expect, test } from 'bun:test';

import { addChat, addComment, addReply, getNotes, initNotes, setResolved } from './notes';

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
	test('need both a quote and a comment', async () => {
		expect(await addComment(sessionId, 'ana', { quote: 'some output', text: '' })).toBeNull();
		expect(await addComment(sessionId, 'ana', { quote: '', text: 'why?' })).toBeNull();
	});

	test('thread replies and resolve', async () => {
		const { comment } = await addComment(sessionId, 'ana', { quote: 'npm ERR! code 1', text: 'is this the lockfile?' });

		const replied = await addReply(sessionId, 'ben', { commentId: comment.id, text: 'yes, regenerate it' });

		expect(replied.comment.replies).toMatchObject([{ author: 'ben', text: 'yes, regenerate it' }]);
		expect((await setResolved(sessionId, { commentId: comment.id, resolved: true })).comment.resolved).toBe(true);
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
