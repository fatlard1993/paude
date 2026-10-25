import { relativeTime } from '@vanilla-bean/components/utils/date';
import { LIFETIMES, clockTime } from '../shared/lifetimes';
import { bold, colored, dim, fit, green, heading, is, onBackground, orange, printable, wrap } from './screen';

// The web's side panels, in the terminal box: links, artifacts, decisions, activity, the catch-up tour, git, shared
// services and a session's lifetime. Each is a list moved through with the arrows (or j/k), Tab stepping between its tabs;
// keys return actions for attach.js to carry out, which loads what they need and puts it in `panel.data`.

const CURSOR_BACKGROUND = 238;
const RED = 167;
const BLUE = 110;

const LINK_KINDS = [
	['all', 'All'],
	['docs', 'Docs'],
	['ticket', 'Tickets'],
	['repo', 'Repos'],
	['server', 'Servers'],
	['reference', 'Other'],
];
const ARTIFACT_KINDS = [
	['all', 'All'],
	['image', 'Images'],
	['page', 'Pages'],
	['script', 'Scripts'],
	['data', 'Data'],
	['doc', 'Docs'],
	['media', 'Media'],
	['archive', 'Archives'],
];
const DECISION_TABS = [
	['open', 'Unrecorded'],
	['placed', 'Recorded'],
];
const DECISION_KINDS = { decision: 'decided', direction: 'direction', deferred: 'put off' };
const GIT_TABS = [
	['status', 'Status'],
	['log', 'History'],
	['branches', 'Branches'],
	['pr', 'Pull request'],
	['stack', 'Not pushed'],
];
const MADE_BY = { written: 'Claude wrote it', command: 'a command made it', viewed: 'Claude looked at it' };
// What the reader can't show as text: saved to this machine instead
const UNREADABLE = /\.(zip|tgz|gz|tar|jar|db|sqlite|docx|pptx|xlsx|mp4|webm|mov|mp3|wav|ogg|m4a|pdf)$/i;
const GIT_STATUS = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', untracked: 'U' };

const shortened = url => url.replace(/^https?:\/\//, '').replace(/\/$/, '');
const firstLine = text =>
	printable(
		String(text ?? '')
			.split('\n')
			.find(line => line.trim())
			?.trim() ?? '',
	);
const sizeOf = bytes => {
	if (!bytes) return null;
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;

	return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

export const createPanel = (kind, extra = {}) => ({ kind, tab: 0, cursor: 0, data: null, error: null, ...extra });

// The tabs a panel has now: those a kind has anything under, All always
const kindTabs = (kinds, items) => kinds.filter(([kind]) => kind === 'all' || items.some(item => item.kind === kind));

const tabsOf = panel => {
	if (panel.kind === 'links') return kindTabs(LINK_KINDS, mentionedLinks(panel));
	if (panel.kind === 'artifacts') return kindTabs(ARTIFACT_KINDS, panel.data ?? []);
	if (panel.kind === 'git') return GIT_TABS;
	if (panel.kind === 'decisions') return DECISION_TABS;

	return [];
};

const tabKey = panel => tabsOf(panel)[panel.tab]?.[0] ?? 'all';

// Mentioned by someone or fetched, rather than only printed by a command, unless asked for those too
const mentionedLinks = panel =>
	(panel.data ?? []).filter(link => panel.withOutput || link.pinned || link.by.some(by => by !== 'output'));

const gitData = panel => panel.data?.[tabKey(panel)];

// Those in a decisions tab: recorded somewhere, or not
const decisionsIn = (panel, tab) =>
	(panel.data?.decisions ?? []).filter(item => (tab === 'placed') === Boolean(item.place));

const statusRows = status => [
	...status.conflicted.map(file => ({ ...file, status: 'conflict', where: 'conflicted' })),
	...status.staged.map(file => ({ ...file, where: 'staged' })),
	...status.unstaged.map(file => ({ ...file, where: 'unstaged' })),
	...status.untracked.map(file => ({ ...file, where: 'untracked' })),
];

const lifetimeChoices = panel => {
	const { lifetime, switched } = panel.data ?? {};
	const putBack = switched?.until > Date.now() && LIFETIMES[switched.was];

	return [
		...(putBack
			? [{ lifetime: switched.was, label: `↶ Put back: ${putBack.label}`, detail: 'what it was before' }]
			: []),
		...Object.entries(LIFETIMES).map(([key, { label, detail }]) => ({
			lifetime: key,
			label: `${key === lifetime ? '✓' : ' '} ${label}`,
			detail,
		})),
	];
};

// What the cursor moves over
export const itemsOf = panel => {
	if (!panel.data) return [];

	switch (panel.kind) {
		case 'links': {
			const kind = tabKey(panel);

			return mentionedLinks(panel).filter(link => kind === 'all' || link.kind === kind);
		}
		case 'artifacts': {
			const kind = tabKey(panel);

			return panel.data.filter(made => kind === 'all' || made.kind === kind);
		}
		case 'decisions':
			return decisionsIn(panel, tabKey(panel));
		case 'activity':
			return panel.turn ? panel.turn.steps : [...panel.data.turns].reverse();
		case 'git': {
			const data = gitData(panel);

			if (!data || data.error) return [];
			if (tabKey(panel) === 'status') return statusRows(data);
			if (tabKey(panel) === 'log') return data;
			if (tabKey(panel) === 'stack') return data.concerns;
			if (tabKey(panel) === 'branches') return data.local;

			return data.checks ?? [];
		}
		case 'services':
			return panel.data.shares;
		case 'lifetime':
			return lifetimeChoices(panel);
		default:
			return [];
	}
};

const TITLES = {
	links: 'Links',
	artifacts: 'Artifacts',
	decisions: 'Decisions',
	activity: 'Activity',
	tour: 'Catch me up',
	git: 'Git',
	services: 'Shared',
	lifetime: 'How long this session lasts',
};

const EMPTY = {
	links: 'No links came up yet.',
	artifacts: 'Nothing made here yet: screenshots, pages and scripts show up as they are.',
	activity: 'No turns yet.',
	'decisions.open': 'Nothing settled here waits to be recorded.',
	'decisions.placed': 'Nothing settled here is recorded yet.',
	services: 'Nothing shared: a server the session starts shows here once it listens.',
	'git.log': 'No commits yet.',
	'git.stack': 'Nothing beyond what is pushed.',
	'git.branches': 'No branches yet: the first commit makes one.',
};

const row = (panel, item, index, width) => {
	const selected = index === panel.cursor;
	const line = rowText(panel, item, width);

	return selected ? onBackground(fit(line, width), width, CURSOR_BACKGROUND) : line;
};

const rowText = (panel, item) => {
	switch (panel.kind) {
		case 'links':
			return `${item.pinned ? orange('▪') : ' '} ${printable(shortened(item.url))}${item.count > 1 ? dim(` ×${item.count}`) : ''}`;
		case 'artifacts':
			return `  ${printable(item.name)}  ${dim(printable(item.shown ?? item.path))}`;
		case 'decisions':
			return `  ${printable(item.chose)} ${dim(DECISION_KINDS[item.kind] ?? '')}`;
		case 'activity':
			if (panel.turn)
				return `  ${item.ok === false ? colored('✗', RED) : dim('·')} ${bold(printable(item.tool))} ${printable(item.summary ?? item.file ?? '')}`;

			return `  ${dim(clockTime(item.at))} ${firstLine(item.prompt) || dim('(no prompt)')} ${dim(plural(item.steps.length, 'step'))}`;
		case 'git': {
			const tab = tabKey(panel);

			if (tab === 'status')
				return `  ${colored(item.status === 'conflict' ? '!' : (GIT_STATUS[item.status] ?? 'M'), item.where === 'staged' ? 108 : 179)} ${printable(item.path)} ${dim(item.where)}`;
			if (tab === 'log')
				return `  ${colored(item.short, BLUE)} ${printable(item.subject)} ${dim(`${printable(item.author)} · ${relativeTime(item.date)}`)}`;
			if (tab === 'stack')
				return `  ${colored(item.short, BLUE)} ${printable(item.subject)} ${item.folds.length ? orange(`+${item.folds.length} to fold in`) : ''}`;
			if (tab === 'branches') {
				const current = item.name === gitData(panel).current;
				const track = [item.ahead && `↑${item.ahead}`, item.behind && `↓${item.behind}`, item.gone && 'gone']
					.filter(Boolean)
					.join(' ');

				return `${current ? green(' ●') : '  '} ${current ? bold(printable(item.name)) : printable(item.name)} ${dim(track)} ${dim(printable(item.subject))}`;
			}

			const mark =
				{ success: green('✓'), failure: colored('✗', RED), error: colored('✗', RED) }[item.state] ?? dim('•');

			return `  ${mark} ${printable(item.name)} ${dim(item.state)}`;
		}
		case 'services':
			return `  ${bold(printable(item.name))} ${dim(item.kind === 'port' ? `port ${item.port}` : printable(item.path))}`;
		case 'lifetime':
			return `  ${item.label}`;
		default:
			return '';
	}
};

// Under the row the cursor is on: what it is, in words
const detailOf = (panel, item, width) => {
	if (!item) return [];

	const lines = (...texts) =>
		texts.filter(Boolean).flatMap(text => wrap(printable(text), width - 4).map(line => `    ${dim(line)}`));

	switch (panel.kind) {
		case 'links': {
			const who = [...new Set(item.by.map(by => (by === 'output' ? 'a command' : by)))].join(', ');

			return lines(item.context, `${item.url}`, `brought up by ${who}`);
		}
		case 'artifacts':
			return lines(
				item.description || item.why || (item.turn && `While: ${item.turn}`),
				[MADE_BY[item.by], sizeOf(item.size), item.modifiedAt && relativeTime(item.modifiedAt)]
					.filter(Boolean)
					.join(' · '),
			);
		case 'decisions':
			return lines(
				item.rejected && `Rejected: ${item.rejected}`,
				item.because && `Because: ${item.because}`,
				item.overrules && `Overrules ${item.overrules.file}: "${item.overrules.claim}"`,
				item.question && `To file it, paude asks: ${item.question}`,
				`❯ ${item.asked}`,
				[
					item.earlier && 'an earlier session',
					item.at && relativeTime(item.at),
					item.place
						? `${item.filed ? 'filed into' : 'recorded in'} ${item.place}`
						: item.looking && 'looking for where it is recorded',
				]
					.filter(Boolean)
					.join(' · '),
			);
		case 'activity':
			return panel.turn ? lines(item.file, item.ok === false && item.output) : [];
		case 'git':
			if (tabKey(panel) === 'stack') return lines(item.body);

			return tabKey(panel) === 'log' ? lines(item.hash) : [];
		case 'services':
			return lines(item.url);
		case 'lifetime':
			return lines(item.detail);
		default:
			return [];
	}
};

const tabsLine = panel => {
	const tabs = tabsOf(panel);

	if (tabs.length < 2) return [];

	const counted = ([kind, label], index) => {
		const inTab = () =>
			panel.kind === 'decisions'
				? decisionsIn(panel, kind)
				: (panel.kind === 'links' ? mentionedLinks(panel) : panel.data).filter(
						item => kind === 'all' || item.kind === kind,
					);
		const count = panel.kind === 'git' ? '' : ` ${inTab().length}`;
		const text = `${label}${count}`;

		return index === panel.tab ? orange(bold(`[${text}]`)) : dim(` ${text} `);
	};

	return [tabs.map(counted).join(' ')];
};

// The lines above the list that say where it stands
const headerOf = panel => {
	if (panel.kind === 'links') {
		const outputOnly = (panel.data ?? []).length - mentionedLinks({ ...panel, withOutput: false }).length;

		return outputOnly && !panel.withOutput ? [dim(`${outputOnly} more only a command printed (i shows them)`)] : [];
	}
	if (panel.kind === 'decisions')
		return [
			panel.data?.reading && dim('Reading the conversation for what it settled...'),
			panel.data?.lookingBack &&
				dim(
					`Looking back over the project's earlier sessions: ${panel.data.lookingBack.done + 1} of ${panel.data.lookingBack.total}...`,
				),
		].filter(Boolean);
	if (panel.kind === 'activity' && !panel.turn && panel.data?.checked) return [dim(printable(panel.data.checked))];
	if (panel.kind === 'activity' && panel.turn)
		return [
			`${bold(clockTime(panel.turn.at))} ${firstLine(panel.turn.prompt)}`,
			dim(plural(panel.turn.steps.length, 'step')),
		];
	if (panel.kind === 'git') {
		const data = gitData(panel);
		const tab = tabKey(panel);

		if (!data) return [dim('Reading...')];
		if (data.error) return [orange(printable(data.error))];
		if (tab === 'status') {
			const track = [data.ahead && `↑${data.ahead}`, data.behind && `↓${data.behind}`].filter(Boolean).join(' ');

			return [
				`${bold(printable(data.branch ?? 'detached'))} ${dim(track)} ${data.inProgress ? orange(data.inProgress) : ''}`,
				...(statusRows(data).length ? [] : [dim('Nothing changed since the last commit.')]),
			];
		}
		if (tab === 'pr') {
			if (data.none) return [dim('No pull request for this branch.')];
			if (data.unavailable) return [dim(printable(data.unavailable))];

			return [
				`${bold(`#${data.number}`)} ${printable(data.title)} ${dim(`${data.isDraft ? 'draft' : data.state.toLowerCase()} · ${data.headRefName} → ${data.baseRefName}`)}`,
				dim(data.url),
				...(data.checks?.length ? ['', heading('Checks')] : []),
			];
		}
	}
	if (panel.kind === 'lifetime') return [dim('Owner only: kept warm pings spend your usage while you are away.')];

	return [];
};

const tourView = (panel, width) => {
	const words = text => wrap(printable(text), width);

	if (panel.stage === 'confirm')
		return [
			bold('Catch up on this session?'),
			'',
			...words(
				`Haiku writes an overview of what happened ${panel.since ? `since this terminal was last here (${clockTime(panel.since)})` : 'in the last ten turns'}, then a stop per turn. Nothing is typed into the session.`,
			),
		];
	if (!panel.data) return [dim('Reading what happened...')];

	const { overview, stops, leftOut = [], checked } = panel.data;

	if (panel.stop === 0)
		return [
			bold(`Since ${panel.since ? clockTime(panel.since) : 'lately'}: ${plural(stops.length, 'turn')}`),
			'',
			...words(overview),
			...(checked ? ['', ...words(checked).map(dim)] : []),
			...(leftOut.length ? ['', ...words(`Not in it: ${leftOut.join(' ')}`).map(dim)] : []),
		];

	const stop = stops[panel.stop - 1];

	return [
		bold([`${panel.stop} of ${stops.length}`, clockTime(stop.at), ...(stop.steered ?? [])].join(' · ')),
		...words(`❯ ${firstLine(stop.prompt)}`).map(dim),
		'',
		...words(stop.text),
	];
};

// The list, scrolled so the cursor stays on screen, with the detail of the row it's on under that row
export const panelView = (panel, width, room) => {
	const title = `${heading(TITLES[panel.kind])}`;

	if (panel.kind === 'tour') return [title, '', ...tourView(panel, width)];
	if (panel.error) return [title, '', orange(printable(panel.error))];
	if (!panel.data) return [title, '', dim('Reading...')];

	const items = itemsOf(panel);
	const header = [title, ...tabsLine(panel), ...headerOf(panel)];
	const detail = detailOf(panel, items[panel.cursor], width);
	const listRoom = Math.max(room - header.length - 1 - detail.length, 3);
	const first = Math.min(Math.max(panel.cursor - Math.floor(listRoom / 2), 0), Math.max(items.length - listRoom, 0));
	const shown = items.slice(first, first + listRoom);
	const rows = shown.flatMap((item, offset) => {
		const index = first + offset;

		return [row(panel, item, index, width), ...(index === panel.cursor ? detail : [])];
	});
	const said = EMPTY[`${panel.kind}.${tabKey(panel)}`] ?? EMPTY[panel.kind];

	return [...header, '', ...(items.length ? rows : [said && dim(said)].filter(Boolean))];
};

export const panelKeys = (panel, keyCap) => {
	const item = itemsOf(panel)[panel.cursor];
	const keys = [];
	// Shown when `when` holds; left out, it always is
	const add = (key, words, ...when) => (!when.length || when[0]) && keys.push(`${keyCap(key)} ${words}`);

	if (panel.kind === 'tour') {
		if (panel.stage === 'confirm') return [`${keyCap('enter')} take the tour`, `${keyCap('esc')} not now`];

		const stops = panel.data?.stops.length ?? 0;

		add('←', 'back', panel.stop > 0);
		add('→', panel.stop === 0 ? 'start the tour' : 'next', panel.data && panel.stop < stops);
		add('esc', panel.stop === stops && stops ? 'done' : 'close');

		return keys;
	}

	add('↑↓', 'move', itemsOf(panel).length > 1);
	add('tab', 'next tab', tabsOf(panel).length > 1);

	switch (panel.kind) {
		case 'links':
			add('enter', 'open in your browser', item);
			add('y', 'copy', item);
			add('p', item?.pinned ? 'unpin' : 'pin', item);
			add('x', 'hide', item);
			add('i', panel.withOutput ? 'leave out command output' : 'include command output');
			break;
		case 'artifacts':
			add('enter', item && UNREADABLE.test(item.path) ? 'save and open' : 'read it here', item);
			add('o', 'save to this machine and open', item);
			add('y', 'copy its path', item);
			break;
		case 'decisions':
			add('a', 'answer what paude asks', item?.question);
			add(
				'w',
				item?.overrules ? 'ask Claude to change the claim' : 'ask Claude to record it',
				item && !item.place && !item.earlier,
			);
			add('x', 'set it aside', item && !item.earlier);
			break;
		case 'activity':
			if (panel.turn) {
				add('enter', 'open the file', item?.file);
				add('c', 'what this turn changed');
			} else add('enter', 'its steps', item);
			break;
		case 'git': {
			const tab = tabKey(panel);

			add('enter', 'its diff', item && (tab === 'status' || tab === 'log' || tab === 'stack'));
			add(
				's',
				'settle: fold what was filed in',
				tab === 'stack' && gitData(panel)?.concerns?.some(concern => concern.folds.length),
			);
			add('enter', 'open in your browser', tab === 'pr' && gitData(panel)?.url);
			add('r', 'refresh');
			break;
		}
		case 'services':
			add('enter', 'open in your browser', item);
			add('y', 'copy the link', item);
			break;
		case 'lifetime':
			add('enter', 'choose', item);
			break;
		default:
	}
	add('esc', panel.kind === 'activity' && panel.turn ? 'back to the turns' : 'back');

	return keys;
};

const move = (panel, by) => {
	const count = itemsOf(panel).length;

	panel.cursor = count ? Math.min(Math.max(panel.cursor + by, 0), count - 1) : 0;
};

const LEFT = ['\x1b[D', '\x1bOD', 'h'];
const RIGHT = ['\x1b[C', '\x1bOC', 'l'];

const tourKey = (panel, key) => {
	if (panel.stage === 'confirm') {
		if (is(key, 'enter')) return { type: 'takeTour' };
		if (is(key, 'back') || key === '\x7f') return { type: 'leave' };

		return { type: 'ignore' };
	}
	if (is(key, 'back') || key === '\x7f') return { type: 'leave' };
	if (!panel.data) return { type: 'ignore' };

	const stops = panel.data.stops.length;

	if ((RIGHT.includes(key) || key === 'n' || key === ' ' || is(key, 'enter')) && panel.stop < stops) panel.stop += 1;
	else if ((LEFT.includes(key) || key === 'p') && panel.stop > 0) panel.stop -= 1;
	else return { type: 'ignore' };

	return { type: 'redraw' };
};

// A key in a panel: 'leave' closes it, back to the box's main view
export const panelKey = (panel, key) => {
	if (panel.kind === 'tour') return tourKey(panel, key);

	const item = itemsOf(panel)[panel.cursor];

	if (is(key, 'back') || key === '\x7f') {
		if (panel.kind === 'activity' && panel.turn) {
			panel.cursor = panel.turnCursor ?? 0;
			panel.turn = null;

			return { type: 'redraw' };
		}

		return { type: 'leave' };
	}
	if (is(key, 'up')) return (move(panel, -1), { type: 'redraw' });
	if (is(key, 'down')) return (move(panel, 1), { type: 'redraw' });
	if (key === '\t' || key === '\x1b[Z') {
		const count = tabsOf(panel).length;

		if (count < 2) return { type: 'ignore' };
		panel.tab = (panel.tab + (key === '\t' ? 1 : count - 1)) % count;
		panel.cursor = 0;

		return panel.kind === 'git' && !gitData(panel) ? { type: 'loadGit', what: tabKey(panel) } : { type: 'redraw' };
	}

	switch (panel.kind) {
		case 'links':
			if (key === 'i') {
				panel.withOutput = !panel.withOutput;
				panel.tab = 0;
				panel.cursor = 0;

				return { type: 'redraw' };
			}
			if (!item) break;
			if (is(key, 'enter')) return { type: 'openUrl', url: item.url };
			if (key === 'y') return { type: 'copy', text: item.url, what: 'the link' };
			if (key === 'p') return { type: 'markLink', url: item.url, change: { pinned: !item.pinned } };
			if (key === 'x') return { type: 'markLink', url: item.url, change: { hidden: true } };
			break;
		case 'artifacts':
			if (!item) break;
			if (key === 'o' || (is(key, 'enter') && UNREADABLE.test(item.path)))
				return { type: 'saveArtifact', path: item.path, name: item.name };
			if (is(key, 'enter')) return { type: 'readArtifact', path: item.path };
			if (key === 'y') return { type: 'copy', text: item.path, what: 'its path' };
			break;
		case 'decisions':
			if (!item) break;
			if (key === 'a' && item.question) return { type: 'answerDecision', id: item.id, question: item.question };
			if (key === 'w' && !item.place && !item.earlier) return { type: 'writeDecision', id: item.id };
			if (key === 'x' && !item.earlier) return { type: 'dismissDecision', id: item.id };
			break;
		case 'activity':
			if (panel.turn) {
				if (key === 'c') return { type: 'readDiffSet', source: { source: 'turn', turn: panel.turn.id } };
				if (is(key, 'enter') && item?.file) return { type: 'readFile', path: item.file };
				break;
			}
			if (is(key, 'enter') && item) {
				panel.turnCursor = panel.cursor;
				panel.turn = item;
				panel.cursor = 0;

				return { type: 'redraw' };
			}
			break;
		case 'git': {
			const tab = tabKey(panel);

			if (key === 'r') return { type: 'loadGit', what: tab };
			if (key === 's' && tab === 'stack' && gitData(panel)?.concerns?.some(concern => concern.folds.length))
				return { type: 'settle' };
			if (!is(key, 'enter')) break;
			if (tab === 'pr' && gitData(panel)?.url) return { type: 'openUrl', url: gitData(panel).url };
			if (tab === 'status' && item)
				// The reader opens the folder's own files; an untracked one outside it shows as all added
				return item.where === 'untracked' && !(item.here ?? '').startsWith('../')
					? { type: 'readFile', path: item.here ?? item.path }
					: { type: 'readDiffSet', source: { source: 'changes', path: item.here ?? item.path } };
			if ((tab === 'log' || tab === 'stack') && item)
				return { type: 'readDiffSet', source: { source: 'commit', ref: item.hash } };
			break;
		}
		case 'services':
			if (!item) break;
			if (is(key, 'enter')) return { type: 'openUrl', url: item.url };
			if (key === 'y') return { type: 'copy', text: item.url, what: 'the link' };
			break;
		case 'lifetime':
			if (is(key, 'enter') && item) return { type: 'setLifetime', lifetime: item.lifetime };
			break;
		default:
	}

	return { type: 'ignore' };
};

// The box's own line about the session: how long it lasts, whether you watch it, and its cache
export const statusLine = status => {
	if (!status) return null;

	const { lifetime, switched, watching, meter } = status;
	const parts = [];
	const now = LIFETIMES[lifetime] ?? LIFETIMES.ordinary;
	const was = switched?.until > Date.now() && LIFETIMES[switched.was];

	// Its words, not its mark: an emoji takes two columns, and the box counts one
	parts.push(`${now.label}${was ? dim(` (was ${was.label.toLowerCase()})`) : ''}`);
	parts.push(watching ? 'watching' : dim('not watching'));
	if (meter) {
		const left = meter.warmUntil - Date.now();

		parts.push(left > 0 ? `cached ${Math.ceil(left / 60_000)}m` : orange('not cached'));
	}

	return parts.join(dim(' · '));
};
