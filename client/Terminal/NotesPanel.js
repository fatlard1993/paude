import { Notify, Tabs } from '@vanilla-bean/components';

import { relativeTime } from '@vanilla-bean/components/utils/date';
import { DESKTOP_KEY, desktopNotificationsOn, remember } from '../storage';
import confirmDialog from '../confirmDialog';

import { anchorPlace, attachCommentText, attachCommentsText } from '../../shared/attachText';
import { applyNote } from '../../shared/protocol';
import { REACTION_PALETTE } from '../../shared/reactions';
import { canNote, canType, identity, identityKey } from '../identity';
import { closeButton, element, icon } from '../dom';
import renderPeople from './People';
import Panel from './NotesPanel.styles';

const meta = ({ author, at, toClaude }) =>
	element('div', 'meta', `${author}${toClaude ? ' → Claude' : ''} · ${relativeTime(at)}`);

// Claude's answers stand apart from what people say
const noteClass = (base, note) => `${base}${note.fromClaude ? ' from-claude' : ''}`;

// Yours to resolve or delete: written by you (by who you are, not your name, where the note knows), or you're the owner
const yours = note =>
	Boolean(identity()?.owner || (note.authorId ? note.authorId === identityKey() : note.author === identity()?.name));

// Enter sends; Shift+Enter makes a new line. A draft map keeps half-typed text across re-renders. With `onAsk`, an
// Ask Claude button (or Ctrl/Cmd+Enter) sends it to Claude too, for those who may type into Claude.
const composer = ({ placeholder, label, onSend, onAsk, drafts, draftKey }) => {
	const row = element('div', 'composer');
	const input = element('textarea');
	const button = element('button', 'variant-flat', label);
	const ask = onAsk && canType() && element('button', 'ask', 'Ask Claude');

	input.placeholder = placeholder;
	input.rows = 1;
	input.value = drafts?.get(draftKey) ?? '';
	if (draftKey) input.dataset.draftKey = draftKey;
	input.addEventListener('input', () => drafts?.set(draftKey, input.value));

	const send = (handler = onSend) => {
		const text = input.value.trim();

		if (!text) return;

		// While reconnecting nothing can go out; the text stays for another try
		if (handler(text) === false) {
			new Notify({ intent: 'warning', content: 'Not sent: reconnecting. Try again in a moment.' });

			return;
		}
		input.value = '';
		drafts?.delete(draftKey);
	};

	input.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			send(ask && (event.ctrlKey || event.metaKey) ? onAsk : onSend);
		}
	});
	button.addEventListener('click', () => send());
	row.append(input, button);
	if (ask) {
		ask.title = 'Send it to Claude as a prompt too (Ctrl+Enter); its answer comes back here';
		ask.addEventListener('click', () => send(onAsk));
		row.append(ask);
	}

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

		who.append(
			this.whoYouAre(),
			this.bellButton(),
			closeButton(() => this.options.close()),
		);

		this.tabStrip = new Tabs({
			addClass: 'tabs',
			tabs: [
				{ id: 'chat', label: 'Chat' },
				{ id: 'comments', label: 'Comments' },
				...(identity()?.owner ? [{ id: 'people', label: 'People' }] : []),
			],
			onChange: ({ value }) => this.showTab(value),
		});

		const tabs = this.tabStrip.elem;

		this.list = element('div', 'list');
		this.draft = element('div', 'draft');
		this.draft.style.display = 'none';
		this.chatComposer = composer({
			placeholder: canType() ? 'Message the people here, or ask Claude' : 'Message the people here',
			label: 'Send',
			onSend: text => this.options.send({ type: 'chat', text }),
			onAsk: text => this.options.send({ type: 'ask', kind: 'chat', text }),
		});

		this.elem.append(who, tabs, this.list, this.draft, this.chatComposer);
		this.elem.tabIndex = -1;
		this.elem.addEventListener('keydown', event => {
			if (event.key !== 'Escape') return;

			event.stopPropagation();
			this.options.close();
		});
		this.showTab('chat');
	}

	// Desktop notifications for when this tab is in the background; asking permission needs a click, so it's here
	// The owner goes by the server's name for them, a guest by their invite's
	whoYouAre() {
		const label = element('div', 'guest-name');

		label.append(element('span', 'as', 'You are'), element('strong', '', identity()?.name ?? 'a guest'));

		return label;
	}

	bellButton() {
		const bell = element('button', 'bell variant-flat');
		const show = () => {
			bell.replaceChildren(icon(desktopNotificationsOn() ? 'bell' : 'bell-slash'));
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

		this.tabStrip.options.selected = tab;

		this.chatComposer.style.display = tab === 'chat' && canNote() ? '' : 'none';
		this.renderList();
	}

	// Counts what arrived while the reader was looking elsewhere, for the tabs and the header button
	noteUnread(tab) {
		if (this.tab !== tab || !this.visible) this.unread[tab] += 1;

		this.renderBadges();
	}

	renderBadges() {
		for (const [key, count] of Object.entries(this.unread)) this.tabStrip.count(key, count);

		this.options.showUnread?.(this.unread.chat + this.unread.comments);
	}

	receive(message) {
		const arrived = applyNote(this.notes, message);

		if (arrived) this.noteUnread(arrived.tab);
		if (arrived && arrived.author !== this.myName) this.options.announce?.(arrived);
		if (message.type !== 'chat' && message.type !== 'chatUpdate') this.options.commentsChanged?.();

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
			return [element('div', 'empty', 'No messages yet. Claude only sees what goes to it with Ask Claude.')];

		return this.notes.chat.map(message => {
			const node = element('div', noteClass('message', message));

			node.append(meta(message), element('div', 'text', message.text), this.reactions(message, { chatId: message.id }));

			return node;
		});
	}

	renderComments() {
		if (!this.notes.comments.length) {
			return [
				...this.commentsToolbar(),
				element(
					'div',
					'empty',
					'No comments yet. Drag over the terminal to select some text (on a phone: Select on the key bar), or pick lines in a file or a diff, then press Comment.',
				),
			];
		}

		const ordered = [...this.notes.comments].sort((a, b) => a.resolved - b.resolved || b.at - a.at);

		const nodes = ordered.map(comment => {
			const node = element('div', noteClass(`comment${comment.resolved ? ' resolved' : ''}`, comment));
			const quote = element('pre', 'quote', comment.quote);
			const actions = element('div', 'actions');
			const resolve = element('button', '', comment.resolved ? 'Reopen' : 'Resolve');
			const open = () => (comment.anchor ? this.options.openComment(comment) : this.options.jump(comment.quote));

			node.dataset.commentId = comment.id;
			quote.title = comment.anchor ? 'Open these lines' : 'Find in the terminal';
			quote.addEventListener('click', open);
			resolve.addEventListener('click', () =>
				this.options.send({ type: 'resolve', commentId: comment.id, resolved: !comment.resolved }),
			);
			if (canType()) {
				const attach = element('button', '', 'Attach');

				attach.title = "Put this thread in Claude's prompt";
				attach.addEventListener('click', () => this.options.attach(attachCommentText(comment)));
				actions.append(attach);
			}
			if (yours(comment)) actions.append(resolve, this.deleteButton(comment, { commentId: comment.id }));

			node.append(
				...(comment.anchor ? [this.placeLine(comment, open)] : []),
				quote,
				meta(comment),
				element('div', 'text', comment.text),
				this.reactions(comment, { commentId: comment.id }),
			);

			for (const reply of comment.replies) {
				const replyNode = element('div', noteClass('reply', reply));

				replyNode.append(
					meta(reply),
					element('div', 'text', reply.text),
					this.reactions(reply, { commentId: comment.id, replyId: reply.id }),
				);
				if (yours(reply)) {
					const replyActions = element('div', 'actions');

					replyActions.append(this.deleteButton(reply, { commentId: comment.id, replyId: reply.id }));
					replyNode.append(replyActions);
				}
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
						onAsk: text => this.options.send({ type: 'ask', kind: 'reply', commentId: comment.id, text }),
					}),
				);
			}

			node.append(actions);

			return node;
		});

		return [...this.commentsToolbar(), ...nodes];
	}

	// Where an anchored comment is, and where it came from or went: GitHub, for a review brought in or posted
	placeLine(comment, open) {
		const line = element('div', 'place');
		const where = element('button', 'where variant-flat', anchorPlace(comment.anchor));

		where.title = 'Open these lines';
		where.addEventListener('click', open);
		line.append(where);

		const github = comment.github?.url ?? comment.posted?.url;

		if (github) {
			const link = element('a', 'github', comment.github ? 'on GitHub' : 'posted');

			Object.assign(link, { href: github, target: '_blank', rel: 'noopener' });
			if (comment.github?.outdated) link.textContent = 'on GitHub, outdated';
			line.append(link);
		}

		return line;
	}

	// The open comments, all at once into Claude's prompt
	commentsToolbar() {
		const open = this.notes.comments.filter(comment => !comment.resolved);
		const bar = element('div', 'comments-toolbar');

		if (canType() && open.length) {
			const attach = element(
				'button',
				'',
				open.length === 1 ? 'Attach the open one' : `Attach all ${open.length} open`,
			);

			attach.title = "Put every open thread in Claude's prompt, to address them";
			attach.addEventListener('click', () => this.options.attach(attachCommentsText(open)));
			bar.append(attach);
		}

		for (const extra of this.options.commentActions?.() ?? []) bar.append(extra);

		return bar.childElementCount ? [bar] : [];
	}

	// Open comments on lines of this file, as it is now
	// The open comments on a file's lines: those on it as it is (after any change), or `inDiff`, on either side of one
	commentsOn(path, { inDiff = false } = {}) {
		return this.notes.comments.filter(
			comment => !comment.resolved && comment.anchor?.path === path && (inDiff || comment.anchor.side === 'new'),
		);
	}

	showComment(commentId) {
		this.showTab('comments');
		this.options.reveal?.();

		const node = this.list.querySelector(`[data-comment-id="${CSS.escape(commentId)}"]`);

		node?.scrollIntoView({ block: 'center' });
		node?.classList.add('flash');
		setTimeout(() => node?.classList.remove('flash'), 1500);
	}

	// Asked first: a comment goes with its replies, other people's among them
	deleteButton(note, target) {
		const remove = element('button', 'delete', 'Delete');
		const replies = target.replyId ? 0 : note.replies.length;

		remove.addEventListener('click', async () => {
			const confirmed = await confirmDialog({
				header: target.replyId ? 'Delete this reply?' : 'Delete this comment?',
				body: replies
					? `Its ${replies === 1 ? 'reply goes' : `${replies} replies go`} with it.`
					: 'It goes for everyone.',
				confirmLabel: 'Delete',
			});

			if (confirmed) this.options.send({ type: 'delete', ...target });
		});

		return remove;
	}

	reactions(item, target) {
		const row = element('div', 'reactions');
		const react = emoji => this.options.send({ type: 'react', ...target, emoji });

		for (const [emoji, authors] of Object.entries(item.reactions ?? {})) {
			const chip = element(
				'button',
				`chip variant-flat${authors.some(entry => (typeof entry === 'string' ? entry === this.myName : entry.id === identityKey())) ? ' mine' : ''}`,
				`${emoji} ${authors.length}`,
			);

			chip.title = authors.map(entry => entry.name ?? entry).join(', ');
			chip.disabled = !canNote();
			chip.addEventListener('click', () => react(emoji));
			row.append(chip);
		}

		if (!canNote()) return row;

		const add = element('button', 'chip add variant-flat');
		const palette = element('div', 'palette');
		const other = element('input');

		add.title = 'React';
		add.append(element('i', 'fa-regular fa-face-smile'), '+');
		add.addEventListener('click', () => palette.classList.toggle('open'));
		for (const emoji of REACTION_PALETTE) {
			const pick = element('button', 'variant-flat', emoji);

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

	startComment(quote, anchor) {
		if (!canNote()) return;

		this.showTab('comments');
		this.options.reveal?.();

		const preview = element('pre', 'quote', quote);
		const place = anchor && element('div', 'place', anchorPlace(anchor));
		const cancel = element('button', '', 'Cancel');
		const close = () => {
			this.draft.style.display = 'none';
			this.draft.replaceChildren();
		};
		const box = composer({
			placeholder: 'Comment on this selection',
			label: 'Comment',
			onSend: text => {
				const sent = this.options.send({ type: 'comment', quote, anchor, text });

				if (sent) close();

				return sent;
			},
			onAsk: text => {
				const sent = this.options.send({ type: 'ask', kind: 'comment', quote, anchor, text });

				if (sent) close();

				return sent;
			},
		});

		cancel.addEventListener('click', close);
		box.append(cancel);
		this.draft.replaceChildren(...(place ? [place] : []), preview, box);
		this.draft.style.display = '';
		box.querySelector('textarea').focus();
	}
}
