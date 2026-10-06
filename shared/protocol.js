// The attach socket's vocabulary, shared by the server and both clients. Binary frames carry terminal output;
// text frames carry JSON whose `type` is one of these.

// Collaborators' notes: never sent to Claude
export const NOTE_TYPES = ['notes', 'chat', 'chatUpdate', 'comment'];

// Close codes a client acts on instead of reconnecting
export const CLOSED = {
	unauthorized: 4401,
	ended: 4404,
};

// Folds one notes message into a { chat, comments } store. Returns what arrived new (a chat message or a
// first-seen comment) so a client can announce it, or null for a snapshot or an update.
export const applyNote = (notes, message) => {
	if (message.type === 'notes') {
		notes.chat = message.chat;
		notes.comments = message.comments;

		return null;
	}

	if (message.type === 'chat') {
		notes.chat.push(message.message);

		return { author: message.message.author, text: message.message.text, tab: 'chat' };
	}

	// A reaction changed an existing message
	if (message.type === 'chatUpdate') {
		const index = notes.chat.findIndex(({ id }) => id === message.message.id);

		if (index !== -1) notes.chat[index] = message.message;

		return null;
	}

	if (message.type !== 'comment') return null;

	const index = notes.comments.findIndex(({ id }) => id === message.comment.id);

	if (index !== -1) {
		notes.comments[index] = message.comment;

		return null;
	}

	notes.comments.push(message.comment);

	return { author: message.comment.author, text: message.comment.text, tab: 'comments' };
};
