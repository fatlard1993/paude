import { Component, Notify, styled } from '@vanilla-bean/components';

import { DESKTOP_KEY, NAME_KEY, desktopNotificationsOn, remember, savedName } from '../storage';

import { applyNote } from '../../shared/protocol';
import { REACTION_PALETTE } from '../../shared/reactions';
import { canNote, identity, identityKey } from '../identity';
import relativeTime from '../../shared/relativeTime';
import { element } from '../dom';
import renderPeople from './People';

const Panel = styled(
	Component,
	({ colors }) => `
		display: flex;
		flex-direction: column;
		min-height: 0;
		height: 100%;

		.tabs, .who, .composer {
			display: flex;
			gap: 6px;
			padding: 8px;
		}

		/* The panel itself is mostly glass; what holds text sits on something solid enough to read */
		.tabs, .who {
			margin: 8px 8px 0;
			border-radius: 6px;
			background: rgba(18, 18, 21, 0.5);
		}

		.message, .comment, .draft, .composer {
			background: rgba(18, 18, 21, 0.5);
		}

		.message {
			padding: 6px 8px;
			border-radius: 6px;
		}

		.composer {
			margin: 8px;
			border-radius: 6px;
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

		.who .guest-name {
			flex: 1;
			display: flex;
			align-items: baseline;
			gap: 6px;
			padding: 4px 2px;
			min-width: 0;
		}

		.who .guest-name .as {
			color: ${colors.light(colors.gray)};
			font-size: 0.85em;
		}

		.who .guest-name strong {
			overflow: hidden;
			text-overflow: ellipsis;
			white-space: nowrap;
		}

		.who .bell {
			border: none;
			background: transparent;
			font-size: 1.1em;
			cursor: pointer;
		}

		.list {
			flex: 1;
			min-height: 0;
			overflow-y: auto;
			padding: 8px;
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

		.reactions {
			display: flex;
			flex-wrap: wrap;
			align-items: center;
			gap: 4px;
		}

		.reactions:empty {
			display: none;
		}

		.reactions .chip {
			padding: 1px 7px;
			border: 1px solid ${colors.alpha(colors.white, 0.12)};
			border-radius: 10px;
			background: ${colors.alpha(colors.white, 0.04)};
			color: inherit;
			font: inherit;
			font-size: 0.85em;
			cursor: pointer;
		}

		.reactions .chip.mine {
			border-color: ${colors.alpha(colors.blue, 0.7)};
			background: ${colors.alpha(colors.blue, 0.2)};
		}

		.reactions .chip.add {
			opacity: 0.45;
		}

		.reactions .chip.add:hover, .message:hover .chip.add, .comment:hover > .reactions .chip.add {
			opacity: 0.9;
		}

		.reactions .palette {
			display: none;
			flex-basis: 100%;
			flex-wrap: wrap;
			gap: 2px;
			padding: 4px;
			border-radius: 6px;
			background: rgba(12, 12, 14, 0.9);
		}

		.reactions .palette.open {
			display: flex;
		}

		.reactions .palette button {
			border: none;
			background: transparent;
			font-size: 1.15em;
			padding: 2px 4px;
			border-radius: 4px;
			cursor: pointer;
		}

		.reactions .palette button:hover {
			background: ${colors.alpha(colors.white, 0.1)};
		}

		.reactions .palette input {
			width: 90px;
			font-size: 0.85em;
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

		// While reconnecting nothing can go out; the text stays for another try
		if (onSend(text) === false) {
			new Notify({ type: 'warning', content: 'Not sent: reconnecting. Try again in a moment.' });

			return;
		}
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

		who.append(identity()?.owner ? this.nameInput() : this.guestName(), this.bellButton());

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

	// Desktop notifications for when this tab is in the background; asking permission needs a click, so it's here
	nameInput() {
		const name = element('input');

		name.placeholder = 'Your name';
		name.value = savedName();
		name.addEventListener('change', () => {
			remember(NAME_KEY, name.value.trim());
			this.options.send({ type: 'rename', name: name.value.trim() });
		});

		return name;
	}

	guestName() {
		const label = element('div', 'guest-name');

		label.append(element('span', 'as', 'You are'), element('strong', '', identity()?.name ?? 'a guest'));

		return label;
	}

	bellButton() {
		const bell = element('button', 'bell');
		const show = () => {
			bell.textContent = desktopNotificationsOn() ? '🔔' : '🔕';
			bell.title = desktopNotificationsOn()
				? 'Desktop notifications on (while this tab is in the background)'
				: 'Desktop notifications off';
		};

		bell.addEventListener('click', async () => {
			if (!('Notification' in window)) return;

			if (desktopNotificationsOn()) remember(DESKTOP_KEY, '');
			else if ((await Notification.requestPermission()) === 'granted') remember(DESKTOP_KEY, 'yes');

			show();
		});
		show();

		return bell;
	}

	get visible() {
		return this.elem.classList.contains('open') && !document.hidden;
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
		if (arrived && arrived.author !== this.myName) this.options.announce?.(arrived);

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

			node.append(meta(message), element('div', 'text', message.text), this.reactions(message, { chatId: message.id }));

			return node;
		});
	}

	renderComments() {
		if (!this.notes.comments.length) {
			return [
				element(
					'div',
					'empty',
					'No comments yet. Drag over the terminal to select some text (on a phone: Select on the key bar), then press Comment.',
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

			node.append(
				quote,
				meta(comment),
				element('div', 'text', comment.text),
				this.reactions(comment, { commentId: comment.id }),
			);

			for (const reply of comment.replies) {
				const replyNode = element('div', 'reply');

				replyNode.append(
					meta(reply),
					element('div', 'text', reply.text),
					this.reactions(reply, { commentId: comment.id, replyId: reply.id }),
				);
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

	reactions(item, target) {
		const row = element('div', 'reactions');
		const react = emoji => this.options.send({ type: 'react', ...target, emoji });

		for (const [emoji, authors] of Object.entries(item.reactions ?? {})) {
			const chip = element(
				'button',
				`chip${authors.some(entry => (typeof entry === 'string' ? entry === this.myName : entry.id === identityKey())) ? ' mine' : ''}`,
				`${emoji} ${authors.length}`,
			);

			chip.title = authors.map(entry => entry.name ?? entry).join(', ');
			chip.disabled = !canNote();
			chip.addEventListener('click', () => react(emoji));
			row.append(chip);
		}

		if (!canNote()) return row;

		const add = element('button', 'chip add');
		const palette = element('div', 'palette');
		const other = element('input');

		add.title = 'React';
		add.append(element('i', 'fa-regular fa-face-smile'), '+');
		add.addEventListener('click', () => palette.classList.toggle('open'));
		for (const emoji of REACTION_PALETTE) {
			const pick = element('button', '', emoji);

			pick.addEventListener('click', () => react(emoji));
			palette.append(pick);
		}
		other.placeholder = 'any emoji';
		other.maxLength = 16;
		other.addEventListener('keydown', event => {
			if (event.key === 'Enter' && other.value.trim()) react(other.value.trim());
		});
		palette.append(other);
		row.append(add, palette);

		return row;
	}

	async renderPeople() {
		const rendered = await renderPeople(this.options.sessionId);

		if (this.tab === 'people') this.list.replaceChildren(...rendered);
	}

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
				const sent = this.options.send({ type: 'comment', quote, text });

				if (sent) close();

				return sent;
			},
		});

		cancel.addEventListener('click', close);
		box.append(cancel);
		this.draft.replaceChildren(preview, box);
		this.draft.style.display = '';
		box.querySelector('textarea').focus();
	}
}
