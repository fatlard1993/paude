import { Notify } from '@vanilla-bean/components';

import {
	answerDecision,
	dismissDecision,
	getArtifacts,
	getDecisions,
	getLinks,
	markLink,
	writeDownDecision,
} from '../api';
import { canBrowse, canNote, canType } from '../identity';
import { button, element } from '../dom';
import { NOTE_TYPES } from '../../shared/protocol';
import attach from '../Terminal/attach';
import ActivityPanel from '../Terminal/ActivityPanel';
import ArtifactsPanel from '../Terminal/ArtifactsPanel';
import DecisionsPanel from '../Terminal/DecisionsPanel';
import FilesPanel from '../Terminal/FilesPanel';
import GitPanel from '../Terminal/GitPanel';
import LinksPanel from '../Terminal/LinksPanel';
import NotesPanel from '../Terminal/NotesPanel';
import SharesPanel from '../Terminal/SharesPanel';
import SideShell from '../Terminal/SideShell';
import TasksPanel from '../Terminal/TasksPanel';
import TerminalPanel from './console';
import { heading } from './replyCard';

// What can be done to a session from the universe without leaving it, each the session page's own panel: its key, the
// word on its button, its hotkey, and whether the viewer's role allows it
export const VERBS = [
	// Its own terminal, while it has one running here
	{ key: 'terminal', label: 'Terminal', hotkey: 't', allowed: () => true },
	{ key: 'git', label: 'Changes', hotkey: 'g', allowed: canBrowse },
	{ key: 'files', label: 'Files', hotkey: 'f', allowed: canBrowse },
	{ key: 'notes', label: 'Chat', hotkey: 'c', allowed: () => true },
	{ key: 'tasks', label: 'Tasks', hotkey: 'k', allowed: canBrowse },
	{ key: 'activity', label: 'Activity', hotkey: 'a', allowed: canBrowse },
	{ key: 'artifacts', label: 'Made', hotkey: 'm', allowed: canBrowse },
	{ key: 'decisions', label: 'Decisions', hotkey: 'd', allowed: canBrowse },
	{ key: 'links', label: 'Links', hotkey: 'l', allowed: canBrowse },
	{ key: 'shares', label: 'Ports', hotkey: 'p', allowed: () => true },
	{ key: 'shell', label: 'Shell', hotkey: 's', allowed: canType },
];

// A session's panels docked at the side of the universe, one showing at a time, tabs along the top to switch: built
// as each is first wanted, wired to one another as on the session page (a change or a commit opens in the files
// panel's diff view, a comment in its file), and the chat on a connection of its own to the session.
// `show(key)` switches; `dispose()` lets everything go.
export const dockCard = ({ session, live = false, open = 'git', onOpen, onClose }) => {
	const card = element('div', 'dock');
	const tabs = element('div', 'tabs');
	const body = element('div', 'body');
	const panels = new Map();
	const verbs = VERBS.filter(({ key, allowed }) => allowed() && (key !== 'terminal' || live));
	let connection;
	let showing;

	const head = heading(
		session.title || session.project || 'A new session',
		[session.project, session.server.name].filter(Boolean).join(' · '),
		onClose,
		{
			close: 'Close',
			buttons: [
				button('', onOpen, {
					icon: 'up-right-from-square',
					title: 'Open the session',
					className: 'icon-only variant-flat',
				}),
			],
		},
	);
	for (const { key, label, hotkey } of verbs) {
		const tab = button(label, () => card.show(key), { className: 'variant-flat', title: `${label} (${hotkey})` });

		tab.dataset.verb = key;
		tabs.append(tab);
	}
	card.append(head, tabs, body);

	// Text for Claude's prompt, pasted rather than typed so it lands as one paste and nothing is sent
	const attachToPrompt = text => {
		if (!canType() || !connected().send({ type: 'input', data: `\x1b[200~${text}\x1b[201~` })) {
			new Notify({ intent: 'warning', content: 'Not attached: not connected to the session.' });

			return false;
		}
		new Notify({ intent: 'success', content: 'Added to the prompt', timeout: 1500 });

		return true;
	};

	const connected = () => {
		connection ??= attach(session.id, {
			hello: () => ({ kind: 'web', label: 'universe' }),
			onOutput: () => {},
			onMessage: message => {
				if (NOTE_TYPES.includes(message.type)) panels.get('notes')?.receive(message);
				else if (message.type === 'runs') panels.get('tasks')?.refresh();
				else if (message.type === 'shares') panels.get('shares')?.refresh();
			},
			onState: () => {},
		});

		return connection;
	};

	const common = key => ({ appendTo: body, sessionId: session.id, close: onClose, addClass: ['docked', key] });
	const make = {
		git: () =>
			new GitPanel({
				...common('git'),
				openDiff: source => card.show('files').openDiffSet(source),
				changed: () => panels.get('files')?.changesMayHaveChanged(),
				showComments: () => card.show('notes').showTab('comments'),
			}),
		files: () =>
			new FilesPanel({
				...common('files'),
				setFullscreen: () => {},
				attach: attachToPrompt,
				comment: ({ quote, anchor }) => card.show('notes').startComment(quote, anchor),
				commentsOn: (path, options) => panel('notes').commentsOn(path, options),
				showComment: commentId => card.show('notes').showComment(commentId),
			}),
		notes: () =>
			new NotesPanel({
				...common('notes'),
				send: message => canNote() && Boolean(connected().send(message)),
				jump: () => {},
				openComment: comment => card.show('files').openComment(comment),
				attach: attachToPrompt,
				commentsChanged: () => panels.get('files')?.commentsChanged(),
				commentActions: () => [],
				reveal: () => card.show('notes'),
				announce: () => {},
				showUnread: () => {},
			}),
		tasks: () =>
			new TasksPanel({
				...common('tasks'),
				openFile: (path, line) => card.show('files').open(path, line),
				attach: attachToPrompt,
			}),
		activity: () =>
			new ActivityPanel({
				...common('activity'),
				openDiff: source => card.show('files').openDiffSet(source),
				openFile: (path, line) => card.show('files').open(path, line),
			}),
		artifacts: () =>
			new ArtifactsPanel({
				...common('artifacts'),
				load: () => getArtifacts(session.id),
				openFile: (path, options) => card.show('files').open(path, undefined, undefined, options),
			}),
		decisions: () =>
			new DecisionsPanel({
				...common('decisions'),
				load: () => getDecisions(session.id),
				dismiss: id => dismissDecision(session.id, id),
				writeDown: id => writeDownDecision(session.id, id),
				answer: (id, answer) => answerDecision(session.id, id, answer),
			}),
		links: () =>
			new LinksPanel({
				...common('links'),
				load: () => getLinks(session.id),
				mark: (url, change) => markLink(session.id, url, change),
			}),
		terminal: () => new TerminalPanel({ ...common('terminal'), session }),
		shares: () => new SharesPanel({ ...common('shares') }),
		shell: () =>
			new SideShell({
				...common('shell'),
				attach: attachToPrompt,
				ended: why => why && new Notify({ intent: 'warning', content: why }),
			}),
	};

	// Built the first time it's wanted, and kept while the dock is open
	const panel = key => {
		if (!panels.has(key)) {
			panels.set(key, make[key]());
			panels.get(key).elem.hidden = key !== showing;
			if (key === 'notes') connected();
		}

		return panels.get(key);
	};

	card.show = key => {
		const shown = panel(key);

		if (showing !== key) {
			for (const [other, { elem }] of panels) elem.hidden = other !== key;
			for (const tab of tabs.children) tab.classList.toggle('active', tab.dataset.verb === key);
			if (showing === 'shell') panels.get('shell')?.stop();
			showing = key;
			// Its own width again away from the terminal, which sizes the dock to itself
			if (key !== 'terminal' && card.dataset.sized !== 'true') card.style.width = '';
			if (key === 'notes') shown.showTab(shown.tab);
			else if (key === 'shell' || key === 'terminal') shown.start();
			else shown.refresh?.();
		}

		return shown;
	};

	card.opened = () => card.show(verbs.some(({ key }) => key === open) ? open : verbs[0].key);

	// Everything the dock's panels had going let go: the shell and terminal, a run being followed, a list waiting to
	// refresh, an open editor
	card.dispose = () => {
		for (const shown of panels.values()) {
			shown.stop?.();
			shown.dropEditor?.();
			clearTimeout(shown.following);
			clearTimeout(shown.again);
			shown.viewing = null;
			shown.elem.remove();
		}
		connection?.close();
	};

	return card;
};
