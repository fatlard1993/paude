import { mkdir, rm } from 'fs/promises';
import path from 'path';

import { anchorPlace } from '../shared/attachText';
import writeJsonFile from '../shared/writeJsonFile';
import readJsonFile from '../shared/readJsonFile';
import { isSecret } from './files';

// The collaborators' side of a session: a chat and comments, each on quoted text: terminal output, or lines of a
// file (its anchor says where). None of it is ever typed into Claude, and it outlives the Claude process, so it's kept
// per session id rather than on the running session.
const MAX_TEXT = 4000;
const MAX_QUOTE = 2000;
const MAX_AUTHOR = 40;
const MAX_PATH = 1024;
const MAX_LINE = 10_000_000;
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

// `toClaude` marks one also sent to Claude as a prompt; `fromClaude`, Claude's answer to one
const entry = (author, text, authorId, { toClaude, fromClaude } = {}) => ({
	id: crypto.randomUUID(),
	author: clean(author, MAX_AUTHOR) || 'someone',
	...(authorId && { authorId }),
	text: clean(text, MAX_TEXT),
	at: Date.now(),
	...(toClaude && { toClaude: true }),
	...(fromClaude && { fromClaude: true }),
});

// Each change resolves to what the clients need to update: { type, ... } or null when the input was empty or unknown
export const addChat = async (sessionId, author, text, { authorId, ...flags } = {}) => {
	const message = entry(author, text, authorId, flags);

	if (!message.text) return null;

	const { chat } = await getNotes(sessionId);

	chat.push(message);
	if (chat.length > MAX_CHAT) chat.splice(0, chat.length - MAX_CHAT);
	await save(sessionId);

	return { type: 'chat', message };
};

const lineNumber = value => Number.isInteger(value) && value >= 1 && value <= MAX_LINE;
const hash = value => typeof value === 'string' && /^[0-9a-f]{40}$/.test(value);
const name = value =>
	typeof value === 'string' && value.length > 0 && value.length <= MAX_PATH && !value.includes('\0');
const DIFF_SOURCES = new Set(['changes', 'turn', 'proposal', 'files', 'commit', 'compare', 'since']);
const DIFF_FIELDS = ['path', 'turn', 'a', 'b', 'ref', 'base'];

// The diff a comment was written in, to open it there again: its source, as the diff view asks for it
const cleanDiff = diff =>
	diff && typeof diff === 'object' && DIFF_SOURCES.has(diff.source)
		? Object.fromEntries([
				['source', diff.source],
				...DIFF_FIELDS.filter(field => name(diff[field])).map(field => [field, diff[field]]),
			])
		: null;

// Removed lines a comment covers along with lines after the change: their place before it, its blob, and whether
// the comment starts on them (picked from a removed line down into the lines that replaced it)
const cleanOld = old =>
	old && typeof old === 'object' && lineNumber(old.from) && lineNumber(old.to) && old.to >= old.from
		? {
				from: old.from,
				to: old.to,
				...(hash(old.blob) && { blob: old.blob }),
				...(old.leads === true && { leads: true }),
			}
		: null;

// Where in the project a comment's quote comes from: { path, from, to, side, commit, blob, old, diff }. The path is the
// session folder's; side is 'old' for lines a change removed; commit, what HEAD was when it was written; blob, the
// text its lines are numbered by (the file exactly as it was read, or that side of the diff); old, the removed lines
// it also covers when it's on both sides of a change; diff, the diff it was written in. Null when it isn't one, so the
// comment is on terminal output. A path from the root or a secret is never one; whether it's inside the repository
// takes the session's folder to tell (inRepository).
export const cleanAnchor = anchor => {
	if (!anchor || typeof anchor !== 'object') return null;

	const { path: where, from, to = from, side, commit, blob } = anchor;

	if (!name(where) || path.isAbsolute(where) || /^[a-zA-Z]:|^\\/.test(where) || isSecret(where)) return null;
	if (!lineNumber(from) || !lineNumber(to) || to < from) return null;

	const old = side !== 'old' && cleanOld(anchor.old);
	const diff = cleanDiff(anchor.diff);

	return {
		path: where,
		from,
		to,
		side: side === 'old' ? 'old' : 'new',
		...(hash(commit) && { commit }),
		...(hash(blob) && { blob }),
		...(old && { old }),
		...(diff && { diff }),
	};
};

// A comment on blank lines quotes nothing, so it quotes where it is instead
export const addComment = async (sessionId, author, { quote, text, anchor }, authorId, flags) => {
	const place = cleanAnchor(anchor);
	const comment = {
		...entry(author, text, authorId, flags),
		quote: clean(quote, MAX_QUOTE) || (place ? anchorPlace(place) : ''),
		...(place && { anchor: place }),
		replies: [],
		resolved: false,
	};

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

export const addReply = (sessionId, author, { commentId, text }, authorId, flags) =>
	updateComment(sessionId, commentId, comment => {
		const reply = entry(author, text, authorId, flags);

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

// A comment posted to a pull request: where it went, so it isn't posted twice and GitHub's replies find it again
export const markPosted = (sessionId, commentId, { url, githubId }) =>
	updateComment(sessionId, commentId, comment => {
		comment.posted = { url: clean(url, MAX_PATH), at: Date.now(), ...(Number.isInteger(githubId) && { githubId }) };

		return true;
	});

// The text a comment is posted to GitHub as: it, and the replies to it not from Claude, each by its author unless the
// owner (who posts it as their own login). prReviews posts it, so the two can't drift.
export const postedBody = comment =>
	[comment, ...comment.replies.filter(reply => !reply.fromClaude)]
		.map(said => (said.authorId === 'owner' ? said.text : `**${said.author}:** ${said.text}`))
		.join('\n\n');

// A comment posted from here whose GitHub id never came back: on the same file, its text as posted then
const postedWithoutId = (found, anchor, first) =>
	found.posted &&
	!found.posted.githubId &&
	!found.github &&
	found.anchor?.path === anchor?.path &&
	(found.posted.url === first.url ||
		postedBody({ ...found, replies: found.replies.filter(reply => reply.at <= found.posted.at) }).trim() ===
			String(first.text ?? '').trim());

const fromGithub = said => ({
	id: crypto.randomUUID(),
	author: clean(said.author, MAX_AUTHOR) || 'someone',
	authorId: `github:${clean(said.author, MAX_AUTHOR)}`,
	text: clean(said.text, MAX_TEXT),
	at: Number.isFinite(said.at) ? said.at : Date.now(),
	githubId: said.id,
});

// A pull request's review thread brought in: a new comment on its lines, or one already here (brought in before, or
// posted from here) caught up with the replies since. Its resolution follows GitHub's only when GitHub's changed, so
// resolving it here stays. `anchor` is where it is in the session's folder.
export const mergeGithubThread = async (sessionId, thread, anchor) => {
	const notes = await getNotes(sessionId);
	const [first, ...rest] = thread.comments;
	let comment =
		notes.comments.find(found => found.github?.threadId === thread.id) ??
		notes.comments.find(found => found.posted?.githubId && found.posted.githubId === first.id) ??
		notes.comments.find(found => postedWithoutId(found, anchor, first));
	let changed = false;

	if (!comment) {
		if (notes.comments.length >= MAX_COMMENTS || !cleanAnchor(anchor)) return null;

		const opening = fromGithub(first);

		comment = {
			...opening,
			quote: clean(thread.quote, MAX_QUOTE) || `${anchor.path}`,
			anchor: cleanAnchor(anchor),
			replies: [],
			resolved: thread.resolved,
			github: { threadId: thread.id, url: first.url, resolved: thread.resolved },
		};
		notes.comments.push(comment);
		changed = true;
	} else if (!comment.github) {
		comment.github = { threadId: thread.id, url: first.url, resolved: thread.resolved };
		changed = true;
	} else if (!comment.posted && !comment.anchor?.blob && cleanAnchor(anchor)?.blob) {
		// Brought in before threads knew the text their lines are numbered by
		comment.anchor = cleanAnchor(anchor);
		changed = true;
	}

	if (comment.github.resolved !== thread.resolved) {
		comment.github.resolved = thread.resolved;
		comment.resolved = thread.resolved;
		changed = true;
	}

	if (Boolean(comment.github.outdated) !== Boolean(thread.outdated)) {
		comment.github.outdated = Boolean(thread.outdated);
		changed = true;
	}

	const known = new Set([comment.githubId, ...comment.replies.map(reply => reply.githubId)].filter(Boolean));

	for (const said of rest) {
		if (known.has(said.id) || comment.replies.length >= MAX_COMMENTS) continue;
		comment.replies.push(fromGithub(said));
		changed = true;
	}

	if (!changed) return null;
	await save(sessionId);

	return { type: 'comment', comment };
};

export const deleteNotes = async sessionId => {
	loaded.delete(sessionId);
	await rm(fileFor(sessionId), { force: true });
};
