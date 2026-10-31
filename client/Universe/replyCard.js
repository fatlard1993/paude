import { Notify } from '@vanilla-bean/components';
import DOMPurify from 'dompurify';
import { marked } from 'marked';

import { relativeTime } from '@vanilla-bean/components/utils/date';
import { sendPrompt, sendRemotePrompt } from '../api';
import { AskingCard, showAsking } from '../Asking';
import { button, element } from '../dom';
import { placePrompt } from '../PromptHome';
import refusal from './reason';

// Claude's markdown, sanitized as a file's is: nothing that could pass for a form of paude's own
const rendered = text => {
	const body = element('div', 'reply vbc-elements');

	body.innerHTML = DOMPurify.sanitize(marked.parse(text), {
		FORBID_TAGS: ['style', 'form', 'input', 'button', 'textarea', 'select', 'option'],
		FORBID_ATTR: ['style'],
	});

	return body;
};

// A card's head: its title and what it's about, any `buttons`, and a close button
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

// A box to type to Claude in, Enter sending it, and the buttons under it
const composer = ({ placeholder, send, actions }) => {
	const form = element('form', 'answer');
	const text = element('textarea');
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

	return form;
};

// One session's reply, beside its worker: the prompt it answered, what Claude said, what it's asking if it's waiting,
// a box to answer in, and the ways into its live terminal (`onLive`, when it has one here) and the whole session.
// `session` is as the last look found it.
export const replyCard = ({ session, onOpen, onLive, onClose, note }) => {
	const { reply, server } = session;
	const card = element('div', 'reply-card');

	card.append(
		heading(
			session.title || session.project || 'A new session',
			[session.project, server.name, reply?.at && relativeTime(reply.at)].filter(Boolean).join(' · '),
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

		showAsking(asking, session.id, session.asking, { canAnswer: !server.remote, onAnswered: onClose });
		card.append(asking.elem);
	}

	card.append(
		composer({
			placeholder: session.status === 'waiting' ? 'Or type to Claude' : 'Reply to Claude',
			send: async text => {
				const { body, response } = server.remote
					? await sendRemotePrompt(server.remote.url, session.id, text)
					: await sendPrompt(session.id, text);

				if (!response?.ok)
					return new Notify({
						intent: 'danger',
						content: refusal(`Could not send that to ${server.name}`, body),
					});

				new Notify({ intent: 'success', content: 'Sent', timeout: 2000 });
				onClose();
			},
			actions: [
				...(onLive ? [button('Live terminal', onLive, { icon: 'terminal', className: 'variant-flat' })] : []),
				button('Open session', onOpen, { icon: 'up-right-from-square', className: 'variant-flat' }),
			],
		}),
	);

	return card;
};

// A prompt to place: paude finds where it goes as it does from home, the sessions it carries on and a new session in
// the project that fits, in `project`'s when given, and goes straight there; `onSent` once it's gone
export const promptCard = ({ project, onSent, onClose }) => {
	const card = element('div', 'reply-card');

	card.append(
		heading(
			project ? `New prompt in ${project}` : 'New prompt',
			project ? 'paude finds the session it carries on, or starts one here' : 'paude finds where it goes',
			onClose,
		),
		composer({
			placeholder: 'What should Claude do?',
			send: text =>
				placePrompt({
					prompt: text,
					project,
					onSent: () => {
						onSent?.();
						onClose();
					},
				}),
			actions: [],
		}),
	);

	return card;
};

// A system's log: its latest uses, newest first, each saying when, by which session and on what, and whether it
// failed; one whose session is aboard opens that session (`onPick`)
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

// A checkout's manifest: the commits waiting to be pushed and the files changed since the last commit, as many of
// each as its cargo names, and how many more there are
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
