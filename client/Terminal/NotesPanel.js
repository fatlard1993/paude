import { Component, styled } from '@vanilla-bean/components';

import { applyNote } from '../../shared/protocol';
import { canNote, identity } from '../identity';
import relativeTime from '../../shared/relativeTime';
import renderPeople from './People';

const NAME_KEY = 'paude.name';

export const savedName = () => {
	try {
		return localStorage.getItem(NAME_KEY) ?? '';
	} catch {
		return '';
	}
};

const saveName = name => {
	try {
		localStorage.setItem(NAME_KEY, name);
	} catch {
		// Private windows can refuse storage; the name still applies until reload
	}
};

const Panel = styled(
	Component,
	({ colors }) => `
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: ${colors.blackish()};
		border-left: 1px solid ${colors.alpha(colors.white, 0.08)};

		.tabs, .who, .composer {
			display: flex;
			gap: 6px;
			padding: 8px;
		}

		.tabs button {
			flex: 1;
			padding: 6px;
			border: none;
			border-radius: 4px;
			background: transparent;
			color: inherit;
			font: inherit;
			opacity: 0.6;
		}

		.tabs button.active {
			background: ${colors.alpha(colors.white, 0.08)};
			opacity: 1;
		}

		.badge {
			margin-left: 6px;
			padding: 0 6px;
			border-radius: 8px;
			background: ${colors.orange};
			color: ${colors.white};
			font-size: 0.8em;
		}

		.who input {
			flex: 1;
		}

		.list {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			padding: 0 8px;
			display: flex;
			flex-direction: column;
			gap: 8px;
		}

		.empty {
			color: ${colors.gray};
			padding: 8px 0;
		}

		.message .meta, .comment .meta, .reply .meta {
			color: ${colors.light(colors.gray)};
			font-size: 0.8em;
		}

		.message .text, .comment .text, .reply .text {
			white-space: pre-wrap;
			word-break: break-word;
		}

		.comment {
			padding: 8px;
			border-radius: 6px;
			background: ${colors.alpha(colors.white, 0.05)};
			display: flex;
			flex-direction: column;
			gap: 6px;
		}

		.comment.resolved {
			opacity: 0.5;
		}

		.quote {
			margin: 0;
			padding: 4px 8px;
			border-left: 3px solid ${colors.light(colors.orange)};
			white-space: pre-wrap;
			word-break: break-word;
			max-height: 8em;
			overflow: hidden;
			font-size: 0.85em;
			cursor: pointer;
		}

		.reply {
			margin-left: 12px;
		}

		.actions {
			display: flex;
			gap: 6px;
		}

		.actions button, .composer button {
			padding: 4px 10px;
			border: none;
			border-radius: 4px;
			background: ${colors.alpha(colors.white, 0.1)};
			color: inherit;
			font: inherit;
		}

		textarea {
			flex: 1;
			min-height: 2.4em;
			max-height: 30vh;
			resize: vertical;
			font: inherit;
		}

		.draft {
			padding: 8px;
			display: flex;
			flex-direction: column;
			gap: 6px;
			border-top: 1px solid ${colors.alpha(colors.white, 0.08)};
		}
	`,
);

const element = (tag, className, text) => {
	const node = document.createElement(tag);

	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;

	return node;
};

const meta = ({ author, at }) => element('div', 'meta', `${author} · ${relativeTime(at)}`);

// Enter sends; Shift+Enter makes a new line. A draft map keeps half-typed text across re-renders.
const composer = ({ placeholder, label, onSend, drafts, draftKey }) => {
	const row = element('div', 'composer');
	const input = element('textarea');
	const button = element('button', '', label);

	input.placeholder = placeholder;
	input.rows = 1;
	input.value = drafts?.get(draftKey) ?? '';
	if (draftKey) input.dataset.draftKey = draftKey;
	input.addEventListener('input', () => drafts?.set(draftKey, input.value));

	const send = () => {
		const text = input.value.trim();

		if (!text) return;

		onSend(text);
		input.value = '';
		drafts?.delete(draftKey);
	};

	input.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send();
		}
	});
	button.addEventListener('click', send);
	row.append(input, button);

	return row;
};

export default class NotesPanel extends Panel {
	// Set here rather than as class fields: VBC runs build() from its own constructor, before subclass fields exist
	build() {
		this.notes = { chat: [], comments: [] };
		this.tab = 'chat';
		this.unread = { chat: 0, comments: 0 };
		this.drafts = new Map();

		const who = element('div', 'who');
		const name = element('input');

		name.placeholder = 'Your name';
		// A guest is the name on their invite
		name.value = identity()?.owner ? savedName() : (identity()?.name ?? '');
		name.disabled = !identity()?.owner;
		name.addEventListener('change', () => {
			saveName(name.value.trim());
			this.options.send({ type: 'rename', name: name.value.trim() });
		});
		who.append(name);

		this.tabButtons = {};

		const tabs = element('div', 'tabs');

		for (const [key, label] of [
			['chat', 'Chat'],
			['comments', 'Comments'],
			...(identity()?.owner ? [['people', 'People']] : []),
		]) {
			const button = element('button', '', label);

			button.addEventListener('click', () => this.showTab(key));
			this.tabButtons[key] = button;
			tabs.append(button);
		}

		this.list = element('div', 'list');
		this.draft = element('div', 'draft');
		this.draft.style.display = 'none';
		this.chatComposer = composer({
			placeholder: 'Message collaborators (not Claude)',
			label: 'Send',
			onSend: text => this.options.send({ type: 'chat', text }),
		});

		this.elem.append(who, tabs, this.list, this.draft, this.chatComposer);
		this.showTab('chat');
	}

	get visible() {
		return this.elem.offsetParent !== null;
	}

	showTab(tab) {
		this.tab = tab;
		this.unread[tab] = 0;

		for (const [key, button] of Object.entries(this.tabButtons)) button.classList.toggle('active', key === tab);

		this.chatComposer.style.display = tab === 'chat' && canNote() ? '' : 'none';
		this.renderList();
	}

	// Counts what arrived while the reader was looking elsewhere, for the tabs and the header button
	noteUnread(tab) {
		if (this.tab !== tab || !this.visible) this.unread[tab] += 1;

		this.renderBadges();
	}

	renderBadges() {
		for (const [key, button] of Object.entries(this.tabButtons)) {
			button.querySelector('.badge')?.remove();

			if (this.unread[key]) button.append(element('span', 'badge', String(this.unread[key])));
		}

		this.options.showUnread?.(this.unread.chat + this.unread.comments);
	}

	receive(message) {
		const arrived = applyNote(this.notes, message);

		if (arrived) this.noteUnread(arrived.tab);

		if (this.tab !== 'people') this.renderList();
	}

	// Rebuilding the list would take focus (and the phone keyboard) from a reply being typed, so it's handed back
	renderList() {
		if (this.tab === 'people') return this.renderPeople();

		const atBottom = this.list.scrollHeight - this.list.scrollTop - this.list.clientHeight < 40;
		const { scrollTop } = this.list;
		const typing = this.list.contains(document.activeElement) ? document.activeElement : null;
		const caret = typing && { key: typing.dataset.draftKey, start: typing.selectionStart, end: typing.selectionEnd };

		this.list.replaceChildren(...(this.tab === 'chat' ? this.renderChat() : this.renderComments()));
		this.renderBadges();
		this.list.scrollTop = atBottom ? this.list.scrollHeight : scrollTop;

		const restored = caret?.key && this.list.querySelector(`textarea[data-draft-key="${CSS.escape(caret.key)}"]`);

		if (restored) {
			restored.focus({ preventScroll: true });
			restored.setSelectionRange(caret.start, caret.end);
		}
	}

	renderChat() {
		if (!this.notes.chat.length)
			return [element('div', 'empty', 'No messages yet. Chat here stays between people; Claude never sees it.')];

		return this.notes.chat.map(message => {
			const node = element('div', 'message');

			node.append(meta(message), element('div', 'text', message.text));

			return node;
		});
	}

	renderComments() {
		if (!this.notes.comments.length) {
			return [
				element(
					'div',
					'empty',
					'No comments yet. Shift+drag over the terminal (or press Select and pick lines), then press Comment.',
				),
			];
		}

		const ordered = [...this.notes.comments].sort((a, b) => a.resolved - b.resolved || b.at - a.at);

		return ordered.map(comment => {
			const node = element('div', `comment${comment.resolved ? ' resolved' : ''}`);
			const quote = element('pre', 'quote', comment.quote);
			const actions = element('div', 'actions');
			const resolve = element('button', '', comment.resolved ? 'Reopen' : 'Resolve');

			quote.title = 'Find in the terminal';
			quote.addEventListener('click', () => this.options.jump(comment.quote));
			resolve.addEventListener('click', () =>
				this.options.send({ type: 'resolve', commentId: comment.id, resolved: !comment.resolved }),
			);
			if (identity()?.owner || comment.author === identity()?.name) actions.append(resolve);

			node.append(quote, meta(comment), element('div', 'text', comment.text));

			for (const reply of comment.replies) {
				const replyNode = element('div', 'reply');

				replyNode.append(meta(reply), element('div', 'text', reply.text));
				node.append(replyNode);
			}

			if (!comment.resolved && canNote()) {
				node.append(
					composer({
						placeholder: 'Reply',
						label: 'Reply',
						drafts: this.drafts,
						draftKey: comment.id,
						onSend: text => this.options.send({ type: 'reply', commentId: comment.id, text }),
					}),
				);
			}

			node.append(actions);

			return node;
		});
	}

	async renderPeople() {
		const rendered = await renderPeople(this.options.sessionId);

		if (this.tab === 'people') this.list.replaceChildren(...rendered);
	}

	// Opens the comment box for a quote taken from the terminal
	startComment(quote) {
		if (!canNote()) return;

		this.showTab('comments');
		this.options.reveal?.();

		const preview = element('pre', 'quote', quote);
		const cancel = element('button', '', 'Cancel');
		const close = () => {
			this.draft.style.display = 'none';
			this.draft.replaceChildren();
		};
		const box = composer({
			placeholder: 'Comment on this selection',
			label: 'Comment',
			onSend: text => {
				this.options.send({ type: 'comment', quote, text });
				close();
			},
		});

		cancel.addEventListener('click', close);
		box.append(cancel);
		this.draft.replaceChildren(preview, box);
		this.draft.style.display = '';
		box.querySelector('textarea').focus();
	}
}
