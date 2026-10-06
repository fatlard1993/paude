import inputKind from '../../shared/inputKind';
import { identityKey, markSeen, onActivity, recordChange, watchIfNew } from '../activity';
import { credentialValid, identityOf } from '../auth';
import { addChat, addComment, addReply, getNotes, react, setResolved } from '../notes';
import { may, mayResolve } from '../permissions';
import { CLOSED } from '../../shared/protocol';
import { allRunning, runningSession } from './running';

const REFRESH_EVERY_MS = 1000;

const refuse = socket => {
	if (socket.data.refused) return;

	socket.data.refused = true;
	socket.send(
		JSON.stringify({
			type: 'notice',
			text:
				socket.data.identity?.role === 'comment'
					? 'Your invite lets you chat and comment, not type into Claude.'
					: 'Your invite is watch-only.',
		}),
	);
};

const allowed = (socket, action) => {
	if (may(socket.data.identity, action, socket.data.sessionId)) return true;

	refuse(socket);

	return false;
};

const shareChange = async (socket, change) => {
	const { session, client } = socket.data;

	if (!session || !allowed(socket, 'note')) return;

	const update = await change(session.id, client.name);

	if (!update) return;

	session.broadcast(update);
	await watchIfNew(socket.data.identity, session.id);
	await recordChange(session.id);
};

// Whoever is attached sees each change as it happens, so it never counts as unseen for them; a status change
// (Claude asking something, or done) goes out to them as presence
onActivity(sessionId => {
	const session = runningSession(sessionId);

	if (!session) return;

	for (const { socket } of session.clients) markSeen(socket.data.identity, sessionId);
	session.broadcastPresence();
});

// The first message on a socket must be hello; anything sent before it is dropped
const handlers = {
	async hello(socket, { kind, label, name, cols, rows }) {
		if (socket.data.client) return;

		const session = runningSession(socket.data.sessionId);

		if (!session) return socket.close(CLOSED.ended, 'Session ended');

		const { identity } = socket.data;

		socket.data.session = session;
		// A guest is the name on their invite, not whatever their client says
		socket.data.client = session.attach(socket, {
			kind,
			label,
			name: identity.owner ? name : identity.name,
			role: identity.owner ? 'owner' : identity.role,
			cols,
			rows,
		});
		socket.send(JSON.stringify({ type: 'notes', ...(await getNotes(session.id)) }));
		await markSeen(identity, session.id);
	},
	rename(socket, { name }) {
		if (socket.data.identity.owner) socket.data.session?.rename(socket.data.client, name);
	},
	chat: (socket, { text }) => shareChange(socket, (id, author) => addChat(id, author, text)),
	comment: (socket, { quote, text }) =>
		shareChange(socket, (id, author) => addComment(id, author, { quote, text }, identityKey(socket.data.identity))),
	reply: (socket, { commentId, text }) =>
		shareChange(socket, (id, author) => addReply(id, author, { commentId, text }, identityKey(socket.data.identity))),
	// A reaction isn't news: it doesn't count as a change, and it doesn't start watching
	async react(socket, { chatId, commentId, replyId, emoji }) {
		const { session, client } = socket.data;

		if (!session || !allowed(socket, 'note')) return;

		const update = await react(
			session.id,
			client.name,
			{ chatId, commentId, replyId, emoji },
			identityKey(socket.data.identity),
		);

		if (update) session.broadcast(update);
	},
	resolve: (socket, { commentId, resolved }) =>
		shareChange(socket, id =>
			setResolved(id, { commentId, resolved, allowed: comment => mayResolve(socket.data.identity, comment) }),
		),
	input(socket, { data }) {
		if (typeof data !== 'string' || !allowed(socket, 'type') || !socket.data.session) return;

		socket.data.session.input(socket.data.client, data);
		if (inputKind(data) === 'typing' && data.includes('\r')) watchIfNew(socket.data.identity, socket.data.session.id);
	},
	// A client that drew over the terminal (the CLI's overlay) asks for the screen back
	refresh(socket) {
		const now = Date.now();

		if (now - (socket.data.refreshedAt ?? 0) < REFRESH_EVERY_MS) return;

		socket.data.refreshedAt = now;
		socket.data.session?.sendSnapshot(socket.data.client);
	},
	// Everyone reports their size, but only someone who may type can be the one it's set to
	resize(socket, { cols, rows }) {
		socket.data.session?.resize(socket.data.client, cols, rows);
	},
};

const failed = error => console.error('An attach message failed', error);

export default {
	message(socket, raw) {
		// A logout, a revoked token or invite, or a new password ends sockets opened with the old credential
		socket.data.identity = identityOf(socket.data.credential);
		if (!socket.data.identity) return socket.close(CLOSED.unauthorized, 'Login ended');

		let message;

		try {
			message = JSON.parse(raw);
		} catch {
			return;
		}

		if (!Object.hasOwn(handlers, message?.type)) return;

		try {
			Promise.resolve(handlers[message.type](socket, message)).catch(failed);
		} catch (error) {
			failed(error);
		}
	},
	close(socket) {
		const { session, identity } = socket.data;

		session?.detach(socket.data.client);
		if (session) markSeen(identity, session.id);
	},
};

// Catches revoked credentials on sockets that only watch and so never send anything
export const sweepCredentials = () => {
	for (const session of allRunning()) {
		for (const { socket } of session.clients) {
			if (!credentialValid(socket.data.credential)) socket.close(CLOSED.unauthorized, 'Login ended');
		}
	}
};
