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
import { canBrowse, canNote, canType, identity } from '../identity';
import { button, element } from '../dom';
import ArcadeGame from '../Arcade/ArcadeGame';
import ArcadeTalk from '../Arcade/ArcadeTalk';
import { NOTE_TYPES } from '../../shared/protocol';
import attach from '../Terminal/attach';
import ActivityPanel from '../Terminal/ActivityPanel';
import ArtifactsPanel from '../Terminal/ArtifactsPanel';
import DecisionsPanel from '../Terminal/DecisionsPanel';
import FilesPanel from '../Terminal/FilesPanel';
import GitPanel from '../Terminal/GitPanel';
import LinksPanel from '../Terminal/LinksPanel';
import NotesPanel from '../Terminal/NotesPanel';
import { PANELS, panelTitle } from '../Terminal/panels';
import SharesPanel from '../Terminal/SharesPanel';
import SideShell from '../Terminal/SideShell';
import TasksPanel from '../Terminal/TasksPanel';
import TerminalPanel from './console';
import { heading } from './replyCard';

// What can be done to a session from the universe without leaving it, each the session page's own panel under the
// same name: its key, its hotkey, and whether the viewer's role allows it
export const VERBS = [
	// Its own terminal, while it has one running here
	{ key: 'terminal', hotkey: 't', allowed: () => true },
	{ key: 'git', hotkey: 'g', allowed: canBrowse },
	{ key: 'files', hotkey: 'f', allowed: canBrowse },
	{ key: 'notes', hotkey: 'c', allowed: () => true },
	{ key: 'tasks', hotkey: 'k', allowed: canBrowse },
	{ key: 'activity', hotkey: 'a', allowed: canBrowse },
	{ key: 'artifacts', hotkey: 'm', allowed: canBrowse },
	{ key: 'decisions', hotkey: 'd', allowed: canBrowse },
	{ key: 'links', hotkey: 'l', allowed: canBrowse },
	{ key: 'shares', hotkey: 'p', allowed: () => true },
	{ key: 'shell', hotkey: 's', allowed: canType },
	// The session as a kid plays it: the talk, and the game it builds
	{ key: 'arcade', hotkey: 'e', allowed: () => true },
	{ key: 'game', hotkey: 'v', allowed: () => true },
].map(verb => ({ ...verb, label: PANELS[verb.key].label }));

// The arcade's panels, for a session that is one (a game a kid builds)
export const ARCADE_VERBS = ['arcade', 'game'];

// The verbs for `session` as the viewer may have them: the arcade's only for a session that is one, and for a guest
// invited to the arcade those alone, since the rest is the grown-up's; the terminal only while the session's live
export const verbsFor = (session, { live = false } = {}) =>
	VERBS.filter(
		({ key, allowed }) =>
			allowed() &&
			(key !== 'terminal' || live) &&
			(ARCADE_VERBS.includes(key) ? session.arcade : identity()?.view !== 'arcade'),
	);

// A session's panels docked beside the universe, one showing at a time, each built when first wanted and wired to the
// others as on the session page; the chat on a connection of its own
export const dockCard = ({ session, live = false, open = 'git', onOpen, onClose, onForked }) => {
	const card = element('div', 'dock');
	const tabs = element('div', 'tabs');
	const body = element('div', 'body');
	const panels = new Map();
	// Another paude's session's panels reach it through this paude, its side shell's socket among them
	const { remote } = session.engine;
	const verbs = verbsFor(session, { live });
	let connection;
	let showing;

	const head = heading(
		session.title || session.project || 'A new session',
		[session.project, session.engine.name].filter(Boolean).join(' · '),
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
		const tab = button(label, () => card.show(key), {
			icon: PANELS[key].icon,
			className: 'variant-flat',
			title: `${panelTitle(key)} (${hotkey})`,
		});

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
			...(remote && { url: `${window.location.origin}/api/remotes/at/${encodeURIComponent(remote.url)}` }),
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

	const common = key => ({
		appendTo: body,
		sessionId: session.id,
		place: session.id,
		close: onClose,
		addClass: ['docked', key],
	});
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
				// To where a quote is in the terminal, when there's one to open
				jump: quote => verbs.some(({ key }) => key === 'terminal') && card.show('terminal').jumpTo(quote),
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
		terminal: () =>
			new TerminalPanel({
				...common('terminal'),
				session,
				openFile: (path, line, lastLine) => card.show('files').open(path, line, lastLine),
				comment: quote => card.show('notes').startComment(quote),
				...(verbs.some(({ key }) => key === 'shell') && { toShell: text => card.show('shell').paste(text) }),
				onForked,
			}),
		shares: () => new SharesPanel({ ...common('shares') }),
		arcade: () => new ArcadeTalk({ ...common('arcade') }),
		game: () => new ArcadeGame({ ...common('game') }),
		shell: () =>
			new SideShell({
				...common('shell'),
				attach: attachToPrompt,
				ended: why => why && new Notify({ intent: 'warning', content: why }),
			}),
	};

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
