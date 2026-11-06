import { Notify } from '@vanilla-bean/components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

import { relativeTime } from '@vanilla-bean/components/utils/date';
import { sendPrompt, sendRemotePrompt } from '../api';
import { AskingCard, showAsking } from '../Asking';
import { button, element } from '../dom';
import { HOME_PROMPT_KEY, placePrompt } from '../PromptHome';
import { forget, recall, remember } from '../storage';
import refusal from './reason';
import { sessionKey } from './scene';
import { afterReply } from './sidePanel';

// Claude's markdown, sanitized as a file's is: nothing that could pass for a form of paude's own
const rendered = text => {
	const body = element('div', 'reply vbc-elements');

	body.innerHTML = DOMPurify.sanitize(marked.parse(text), {
		FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option'],
		FORBID_ATTR: ['style'],
	});

	return body;
};

export const heading = (title, about, onClose, { close = 'Close (Esc)', buttons = [] } = {}) => {
	const head = element('div', 'head');
	const titles = element('div', 'titles');

	titles.append(element('strong', '', title), element('div', 'about', about));
	head.append(
		titles,
		...buttons,
		button('', onClose, { icon: 'xmark', title: close, className: 'icon-only variant-flat' }),
	);

	return head;
};

// A box to write to Claude in, Enter sending it. What's typed is kept in this browser under `keep` until sent() says it
// went, so the card closing (a press elsewhere, Escape, a reload) doesn't lose it. { form, sent }
const composer = ({ placeholder, send, actions, keep }) => {
	const form = element('form', 'answer');
	const text = Object.assign(element('textarea'), { value: recall(keep) });
	let sending = false;
	// One send at a time: a second Enter while the first is on its way would send it again
	const submit = async () => {
		const typed = text.value.trim();

		if (!typed || sending) return;
		sending = true;
		try {
			await send(typed);
		} finally {
			sending = false;
		}
	};

	text.placeholder = placeholder;
	text.rows = 2;
	text.addEventListener('input', () => (text.value ? remember(keep, text.value) : forget(keep)));
	text.addEventListener('keydown', event => {
		if (event.key === 'Enter' && !event.shiftKey) {
			event.preventDefault();
			submit();
		}
		// Typing is the box's, but Escape still closes the card it's in
		if (event.key !== 'Escape') event.stopPropagation();
	});
	form.addEventListener('submit', event => {
		event.preventDefault();
		submit();
	});

	const row = element('div', 'actions');
	const buttons = [...actions, button('Send', submit, { icon: 'paper-plane' })];

	// Pressed, not submitting: Enter in the box sends
	for (const node of buttons) node.type = 'button';
	row.append(...buttons);
	form.append(text, row);

	return { form, sent: () => forget(keep) };
};

// One session's reply, beside its worker. `session` is as the last answer had it.
export const replyCard = ({ session, onOpen, onSent, onClose, note }) => {
	const { reply, engine } = session;
	const card = element('div', 'reply-card');

	card.append(
		heading(
			session.title || session.project || 'A new session',
			[session.project, engine.name, reply?.at && relativeTime(reply.at)].filter(Boolean).join(' · '),
			onClose,
		),
	);
	if (reply?.prompt) card.append(element('div', 'asked', reply.prompt));
	if (reply?.text) {
		card.append(rendered(reply.text));
		if (reply.cut) card.append(element('div', 'about', 'Longer than this: the session has the rest.'));
	} else
		card.append(
			element(
				'div',
				'about',
				note ?? (reply ? 'That turn ended without a reply.' : 'Not seen here yet: the session has it.'),
			),
		);

	if (session.status === 'waiting' && session.asking) {
		const asking = new AskingCard({ addClass: 'asking' });

		showAsking(asking, session.id, session.asking, { canAnswer: !engine.remote, onAnswered: onClose });
		card.append(asking.elem);
	}

	const box = composer({
		keep: `paude.reply.${sessionKey(engine.key, session.id)}`,
		placeholder: session.status === 'waiting' ? 'Or type to Claude' : 'Reply to Claude',
		send: async text => {
			const { body, response } = engine.remote
				? await sendRemotePrompt(engine.remote.url, session.id, text)
				: await sendPrompt(session.id, text);

			const { close, wake } = afterReply(session, Boolean(response?.ok));

			if (!close)
				return new Notify({
					intent: 'danger',
					content: refusal(`Could not send that to ${engine.name}`, body),
				});

			new Notify({ intent: 'success', content: 'Sent', timeout: 2000 });
			box.sent();
			onClose();
			if (wake) onSent?.();
		},
		actions: [button('Open session', onOpen, { icon: 'up-right-from-square', className: 'variant-flat' })],
	});

	card.append(box.form);

	return card;
};

// A prompt placed as from home: paude finds the session it carries on or the project to start one in, or, a project
// chosen (`project`, or one of `projects` picked in the card), the session there it carries on or a new one there; and
// goes there: to `onArrive({ id, remote })` when given, else straight to its page
export const promptCard = ({ project, projects = [], onSent, onArrive, onClose }) => {
	const card = element('div', 'reply-card');
	const where = element('select', 'where');
	const about = () =>
		where.value ? 'paude finds the session it carries on there, or starts one' : 'paude finds where it goes';
	const head = heading(project ? `New prompt in ${project}` : 'New prompt', about(), onClose);

	where.append(
		Object.assign(element('option', '', 'Let paude find the project'), { value: '' }),
		...[...new Set([...(project ? [project] : []), ...projects])]
			.sort((a, b) => a.localeCompare(b))
			.map(name => Object.assign(element('option', '', name), { value: name })),
	);
	where.value = project ?? '';
	where.title = 'Where it goes';
	where.addEventListener('change', () => (head.querySelector('.about').textContent = about()));

	const box = composer({
		keep: HOME_PROMPT_KEY,
		placeholder: 'What should Claude do?',
		send: text =>
			placePrompt({
				prompt: text,
				project: where.value || undefined,
				onArrive,
				onSent: () => {
					box.sent();
					onSent?.();
					onClose();
				},
			}),
		actions: [],
	});

	card.append(head, where, box.form);

	return card;
};

// A system's latest uses, newest first; one whose session is aboard opens it (`onPick`)
export const logCard = ({ title, about, log, onPick, onClose }) => {
	const card = element('div', 'reply-card log-card');
	const list = element('div', 'log');

	for (const use of log) {
		const row = element('button', `use${use.failed ? ' failed' : ''}`);

		row.type = 'button';
		row.disabled = !use.session;
		row.append(
			element('span', 'when', relativeTime(Date.now() - use.ago)),
			element('span', 'who', use.session?.title || use.session?.project || use.tool),
			element('code', 'what', use.detail ?? use.tool),
		);
		row.addEventListener('click', () => onPick(use));
		list.append(row);
	}
	if (!log.length) list.append(element('div', 'about', 'Nothing in the last ten minutes'));
	card.append(heading(title, about, onClose), list);

	return card;
};

const FILE_MARKS = {
	added: 'new',
	untracked: 'new',
	deleted: 'deleted',
	renamed: 'renamed',
	conflicted: 'in conflict',
};

// A checkout's commits waiting to be pushed and files changed, as many as its cargo names, and how many more there are
export const manifestCard = ({ title, about, checkout, onClose }) => {
	const card = element('div', 'reply-card log-card');
	const list = element('div', 'log');
	const { commits = [], files = [], unpushed = 0, changed = 0 } = checkout;
	const more = (count, shown, word) => {
		if (count > shown) list.append(element('div', 'about', `and ${count - shown} more ${word}`));
	};

	if (unpushed) list.append(element('div', 'about', `To push: ${unpushed}`));
	for (const { short, subject } of commits) {
		const row = element('div', 'use');

		row.append(element('span', 'when', short), element('span', 'who', subject));
		list.append(row);
	}
	more(unpushed, commits.length, 'commits');
	if (changed) list.append(element('div', 'about', `Changed: ${changed}`));
	for (const { path, status } of files) {
		const row = element('div', `use${status === 'deleted' || status === 'conflicted' ? ' failed' : ''}`);

		row.append(element('code', 'what', FILE_MARKS[status] ? `${path} (${FILE_MARKS[status]})` : path));
		list.append(row);
	}
	more(changed, files.length, 'files');
	if (!unpushed && !changed) list.append(element('div', 'about', 'Nothing changed, nothing to push'));
	card.append(heading(title, about, onClose), list);

	return card;
};
