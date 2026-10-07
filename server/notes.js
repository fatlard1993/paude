import { mkdir, rm } from 'fs/promises';
import path from 'path';

import writeJsonFile from '../shared/writeJsonFile';
import readJsonFile from '../shared/readJsonFile';

// The collaborators' side of a session: a chat and comments on quoted terminal text. None of it is ever typed into
// Claude, and it outlives the Claude process, so it's kept per session id rather than on the running session.
const MAX_TEXT = 4000;
const MAX_QUOTE = 2000;
const MAX_AUTHOR = 40;
// The oldest chat drops off past this; new comments stop being accepted past their cap
const MAX_CHAT = 2000;
const MAX_COMMENTS = 500;

let dir;
const loaded = new Map();

export const initNotes = async dataDir => {
	dir = path.join(dataDir, 'sessions');
	await mkdir(dir, { recursive: true, mode: 0o700 });
};

const fileFor = sessionId => path.join(dir, `${sessionId.replace(/[^\w-]/g, '')}.json`);

export const getNotes = async sessionId => {
	if (loaded.has(sessionId)) return loaded.get(sessionId);

	const notes = await readJsonFile(fileFor(sessionId), { chat: [], comments: [] });

	// A concurrent load may have finished first
	if (!loaded.has(sessionId)) loaded.set(sessionId, notes);

	return loaded.get(sessionId);
};

const save = sessionId => writeJsonFile(fileFor(sessionId), () => loaded.get(sessionId));

const clean = (value, limit) => (typeof value === 'string' ? value.trim().slice(0, limit) : '');

const entry = (author, text, authorId) => ({
	id: crypto.randomUUID(),
	author: clean(author, MAX_AUTHOR) || 'someone',
	...(authorId && { authorId }),
	text: clean(text, MAX_TEXT),
	at: Date.now(),
});

// Each change resolves to what the clients need to update: { type, ... } or null when the input was empty or unknown
export const addChat = async (sessionId, author, text) => {
	const message = entry(author, text);

	if (!message.text) return null;

	const { chat } = await getNotes(sessionId);

	chat.push(message);
	if (chat.length > MAX_CHAT) chat.splice(0, chat.length - MAX_CHAT);
	await save(sessionId);

	return { type: 'chat', message };
};

export const addComment = async (sessionId, author, { quote, text }, authorId) => {
	const comment = { ...entry(author, text, authorId), quote: clean(quote, MAX_QUOTE), replies: [], resolved: false };

	const { comments } = await getNotes(sessionId);

	if (!comment.text || !comment.quote || comments.length >= MAX_COMMENTS) return null;

	comments.push(comment);
	await save(sessionId);

	return { type: 'comment', comment };
};

const updateComment = async (sessionId, commentId, change) => {
	const comment = (await getNotes(sessionId)).comments.find(({ id }) => id === commentId);

	if (!comment || !change(comment)) return null;

	await save(sessionId);

	return { type: 'comment', comment };
};

export const addReply = (sessionId, author, { commentId, text }, authorId) =>
	updateComment(sessionId, commentId, comment => {
		const reply = entry(author, text, authorId);

		if (!reply.text || comment.replies.length >= MAX_COMMENTS) return false;

		comment.replies.push(reply);

		return true;
	});

export const setResolved = (sessionId, { commentId, resolved, allowed = () => true }) =>
	updateComment(sessionId, commentId, comment => {
		if (!allowed(comment)) return false;

		comment.resolved = Boolean(resolved);

		return true;
	});

// One emoji, with any skin tone, variation selector or zero-width joins
const EMOJI = /^\p{Extended_Pictographic}(?:\uFE0F|\p{Emoji_Modifier}|\u200D\p{Extended_Pictographic})*\uFE0F?$/u;
const MAX_EMOJI_LENGTH = 16;
const MAX_REACTIONS = 20;

// Each reaction is { id, name }: who reacted, and how to show them. Reactions saved as bare names still count.
const sameReactor = (entry, reactor) => (typeof entry === 'string' ? entry === reactor.name : entry.id === reactor.id);

const toggleReaction = (item, reactor, emoji) => {
	const reactions = (item.reactions ??= {});
	const authors = reactions[emoji] ?? [];
	const already = authors.some(entry => sameReactor(entry, reactor));

	if (!already && !reactions[emoji] && Object.keys(reactions).length >= MAX_REACTIONS) return false;

	reactions[emoji] = already ? authors.filter(entry => !sameReactor(entry, reactor)) : [...authors, reactor];
	if (!reactions[emoji].length) delete reactions[emoji];

	return true;
};

export const validEmoji = emoji => typeof emoji === 'string' && emoji.length <= MAX_EMOJI_LENGTH && EMOJI.test(emoji);

export const react = async (sessionId, author, { chatId, commentId, replyId, emoji }, reactorId = null) => {
	const name = clean(author, MAX_AUTHOR) || 'someone';
	const reactor = { id: reactorId ?? `name:${name}`, name };

	if (!validEmoji(emoji)) return null;

	if (chatId) {
		const message = (await getNotes(sessionId)).chat.find(({ id }) => id === chatId);

		if (!message || !toggleReaction(message, reactor, emoji)) return null;
		await save(sessionId);

		return { type: 'chatUpdate', message };
	}

	return updateComment(sessionId, commentId, comment => {
		const target = replyId ? comment.replies.find(({ id }) => id === replyId) : comment;

		return Boolean(target) && toggleReaction(target, reactor, emoji);
	});
};

// A comment (its replies with it) or one reply, gone; `allowed` decides for the one deleted
export const deleteComment = async (sessionId, { commentId, replyId, allowed = () => true }) => {
	const notes = await getNotes(sessionId);
	const comment = notes.comments.find(({ id }) => id === commentId);

	if (!comment) return null;

	if (replyId) {
		const reply = comment.replies.find(({ id }) => id === replyId);

		if (!reply || !allowed(reply)) return null;
		comment.replies = comment.replies.filter(other => other !== reply);
		await save(sessionId);

		return { type: 'comment', comment };
	}

	if (!allowed(comment)) return null;
	notes.comments = notes.comments.filter(other => other !== comment);
	await save(sessionId);

	return { type: 'commentDeleted', commentId };
};

export const deleteNotes = async sessionId => {
	loaded.delete(sessionId);
	await rm(fileFor(sessionId), { force: true });
};
