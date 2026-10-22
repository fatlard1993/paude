import { Dialog, Notify, theme } from '@vanilla-bean/components';

import { anchorPlace } from '../../shared/attachText';
import { getGit, runGit } from '../api';
import { element } from '../dom';
import { checkbox } from '../Layout';
import { canType, identity } from '../identity';

const EVENTS = [
	['COMMENT', 'Comment'],
	['APPROVE', 'Approve'],
	['REQUEST_CHANGES', 'Request changes'],
	['PENDING', 'Leave it pending on GitHub, to finish there'],
];

// The dialog sits outside the panels' styles, so it brings its own
const styled = (node, style) => Object.assign(node.style, style) && node;

const note = text => styled(element('div', 'review-why', text), { opacity: '0.7', fontSize: '0.9em' });

const heading = text =>
	styled(element('div', 'review-heading', text), { fontWeight: 'bold', marginTop: theme.space.xs });

const choiceRow = (item, detail) => {
	const row = styled(element('label', 'review-item'), {
		display: 'flex',
		gap: theme.space.sm,
		alignItems: 'flex-start',
	});
	const box = checkbox(item.mine);
	const text = styled(element('div', 'review-text'), { minWidth: 0, flex: '1' });

	box.dataset.commentId = item.commentId;
	text.append(
		styled(element('div', 'review-place', `${anchorPlace(item)}${item.mine ? '' : ` · ${item.author}`}`), {
			fontFamily: 'ui-monospace, monospace',
			wordBreak: 'break-all',
		}),
		...(detail ? [note(detail)] : []),
		styled(element('div', 'review-body', item.body), { whiteSpace: 'pre-wrap', wordBreak: 'break-word' }),
	);
	row.append(box, text);

	return row;
};

// Exactly what goes, before it goes: each comment on its lines or in the review's text (and why), each one chosen,
// a summary, and what the review says. Resolves to { commentIds, body, event }, or null.
const reviewDialog = plan =>
	new Promise(resolve => {
		const body = styled(element('div', 'review-dialog'), {
			display: 'flex',
			flexDirection: 'column',
			gap: theme.space.md,
		});
		const summary = Object.assign(element('textarea'), { rows: 4, placeholder: 'A summary, if any' });
		const event = element('select');
		const items = [...plan.inline, ...plan.inBody];

		for (const [value, label] of EVENTS) event.append(Object.assign(element('option', '', label), { value }));

		if (plan.inline.length) {
			body.append(heading('On their lines'), ...plan.inline.map(item => choiceRow(item)));
		}
		if (plan.inBody.length) {
			body.append(
				heading("In the review's text, since GitHub won't take them on their lines"),
				...plan.inBody.map(item => choiceRow(item, `because ${item.why}`)),
			);
		}
		if (!items.length) body.append(note('No open comments on lines to post; a summary can go alone.'));
		if (items.some(item => !item.mine)) body.append(note("Other people's go with their names on, from your login."));
		body.append(summary, event);

		new Dialog({
			size: 'large',
			header: `Post a review to #${plan.pr.number}`,
			body,
			buttons: ['Cancel', 'Post'],
			onButtonPress: ({ button, closeDialog }) => {
				resolve(
					button === 'Post'
						? {
								commentIds: [...body.querySelectorAll('input:checked')].map(box => box.dataset.commentId),
								body: summary.value,
								event: event.value,
							}
						: null,
				);
				closeDialog();
			},
			// After a button's answer this resolves nothing: a promise settles once
			onClose: () => resolve(null),
		});
	});

const say = (type, content) => new Notify({ type, content, timeout: type === 'error' ? 10_000 : 4000 });

const bringIn = async (sessionId, button) => {
	button.disabled = true;

	const { body } = await runGit(sessionId, 'pr-threads');

	button.disabled = false;
	if (!body?.ok) return say('error', body?.output ?? 'Could not read the pull request.');
	say(
		'success',
		body.changed
			? `${body.changed} thread${body.changed === 1 ? '' : 's'} brought in or caught up`
			: 'Nothing new on the pull request',
	);
};

const post = async (sessionId, button) => {
	button.disabled = true;

	const { body: plan, response } = await getGit(sessionId, 'pr-review');

	button.disabled = false;
	if (!response?.ok) return say('error', typeof plan === 'string' ? plan : 'Could not read the pull request.');

	const choice = await reviewDialog(plan);

	if (!choice) return;

	const { body: posted } = await runGit(sessionId, 'pr-review', choice);

	if (!posted?.ok) return say('error', posted?.output ?? 'GitHub did not take it.');
	say('success', 'Posted to the pull request');
	window.open(posted.url, '_blank', 'noopener');
};

// The comments panel's way to the branch's pull request: its threads brought in (for whoever may run things here),
// and a review posted (the owner's, as it goes out as their GitHub login)
export const pullRequestActions = sessionId => {
	const actions = [];

	if (canType()) {
		const button = element('button', '', 'From the PR');

		button.title = "Bring in the pull request's review threads, on their lines";
		button.addEventListener('click', () => bringIn(sessionId, button));
		actions.push(button);
	}

	if (identity()?.owner) {
		const button = element('button', '', 'Post to the PR');

		button.title = 'Post the open comments on lines as a review, after seeing exactly what goes';
		button.addEventListener('click', () => post(sessionId, button));
		actions.push(button);
	}

	return actions;
};
