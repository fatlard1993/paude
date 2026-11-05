import { relativeTime } from '@vanilla-bean/components/utils/date';

import { facilitiesFor, facilityOf } from '../../shared/facilities';
import { LIFETIMES } from '../../shared/lifetimes';
import tokenCount from '../../shared/tokenCount';
import { BRIDGE, LOUNGE } from './scene';

export const STATUS = { working: 'working', waiting: 'needs you', ready: 'ready for a prompt', stopped: 'stopped' };

export const titled = name => name.charAt(0).toUpperCase() + name.slice(1);

// What's going on aboard another ship, in a few words
export const shipWords = ({ needs, news, working }) =>
	[needs && `${needs} need${needs === 1 ? 's' : ''} you`, news && `${news} new`, working && `${working} working`]
		.filter(Boolean)
		.join(' · ') || 'quiet';

export const doing = ({ status, tool }) => {
	if (status !== 'working') return STATUS[status];
	if (!tool) return 'thinking';

	const facility = facilitiesFor([tool]).find(({ key }) => key === facilityOf(tool));

	return `${facility?.about ?? 'working'} (${tool})`;
};

const LANGUAGE_NAMES = {
	js: 'JavaScript',
	python: 'Python',
	rust: 'Rust',
	go: 'Go',
	jvm: 'Java/Kotlin',
	c: 'C/C++',
	ruby: 'Ruby',
	php: 'PHP',
	dotnet: '.NET',
	swift: 'Swift',
	shell: 'shell',
	web: 'HTML/CSS',
	docs: 'prose',
	data: 'data',
};

export const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;

const clock = time => new Date(time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

export const limitWords = resetAt => (resetAt ? `resets at ${clock(resetAt)}` : "Claude didn't say when it resets");

// How much of a limit is used and when it resets: the time today, else the day and time
const usedWords = ({ percent, resetsAt }) => {
	if (!resetsAt) return `${Math.round(percent)}% used`;

	// To the minute: a reset a moment before the hour is told as the hour
	const at = new Date(Math.round(new Date(resetsAt).getTime() / 60_000) * 60_000);
	const today = at.toDateString() === new Date().toDateString();
	const when = today ? clock(at) : at.toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

	return `${Math.round(percent)}% used, resets ${when}`;
};

// How long its context stays cached, counted down as its grey dozes off, or how long since it went cold and what its
// next turn costs for it; null when it isn't known
const freshness = (worker, ship) => {
	const { context } = worker.session;
	const { cache } = context;

	if (!cache?.life) return context.warm === false ? 'gone cold: its next turn costs more' : null;

	const since = (ship.time - (worker.cacheAt ?? ship.time)) * 1000;
	const left = cache.left - since;
	const short = ms => {
		const minutes = Math.round(ms / 60_000);

		if (minutes < 60) return `${minutes}m`;

		return minutes % 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes / 60}h`;
	};

	if (left > 0) return `warm: ${left < 60_000 ? 'under 1m' : short(left)} of ${short(cache.life)} left`;

	return `cold ${short(Math.max(60_000, (cache.ago ?? 0) + since - cache.left))}: next turn re-caches ${tokenCount(context.tokens)}`;
};

const lasted = age => {
	const minutes = Math.round(age / 60_000);

	return minutes < 60 ? plural(minutes, 'minute') : `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

export const whereWorking = checkout =>
	`${checkout.branch ?? 'no branch'}${checkout.trunk ? ' (the trunk)' : ''}${checkout.worktree ? `, a worktree at ${checkout.root}` : ''}`;

// What the ship's other rooms are for, as their flyouts say
export const ROOMS = {
	engineering: ship =>
		`a reactor for each machine: ${ship.engines.map(({ name, detail }) => `${name}, ${detail}`).join('; ')}`,
	materializer: ship =>
		ship.charged ? 'a new session is on its way' : 'where new sessions start; press it to write a prompt',
	hold: ship => `each checkout's changes and commits not pushed: ${plural(ship.cargo.length, 'checkout')}`,
	hangar: () => 'pushes leaving, and pull requests waiting for review',
	transporter: ship =>
		ship.fleet.length
			? `beams you to the ship of another subscription: ${ship.fleet.map(({ name }) => name).join(', ')}`
			: 'beams you to the ship of another subscription',
};

const MODES = {
	plan: 'planning, changing nothing',
	acceptEdits: 'edits go ahead unasked',
	bypassPermissions: 'asks nothing before it acts',
	dontAsk: 'asks nothing before it acts',
};

const todoWords = todos => {
	const done = todos.filter(({ status }) => status === 'completed').length;
	const now = todos.find(({ status }) => status === 'in_progress');

	return `${done} of ${todos.length} done${now ? ` · now ${now.text}` : ''}`;
};

// A session whose terminal can be opened here: running, on this paude
export const live = session => session.status !== 'stopped' && Boolean(session.screen);

export const cargoWords = ({ changed, unpushed }) =>
	[changed && `${plural(changed, 'file')} changed`, unpushed && `${plural(unpushed, 'commit')} to push`]
		.filter(Boolean)
		.join(' · ') || 'all shipped';

const lookHint = (ship, at) => (ship.looking === at ? 'Press to see everything' : 'Press to look closer');

const ROOM_FLYOUT = (target, ship) => ({
	title: titled(target.room.name),
	rows: [['for', ROOMS[target.kind](ship)]],
	hint: lookHint(ship, target.room.name),
});

// By the kind of thing under the pointer: { title, rows: [[label, words] or false], hint }; any other kind is a bay's
const FLYOUTS = {
	// A room's own when it has one, below, over the plain room's
	...Object.fromEntries(Object.keys(ROOMS).map(kind => [kind, ROOM_FLYOUT])),
	// Another ship's terminal on this one's bridge
	fleet: ({ ship }) => ({
		title: `${ship.name}'s ship`,
		rows: [
			['now', shipWords(ship)],
			ship.needs && ['asking', String(ship.needs)],
			ship.news && ['news', String(ship.news)],
		],
		hint: 'Press to beam over to it from the transporter',
	}),
	transporter: (target, ship) => ({
		title: 'Transporter',
		rows: ship.fleet.map(other => [other.name, shipWords(other)]),
		hint: 'Hears from the other ships; pick one, then beam over to it',
	}),

	worker: (target, ship) => {
		const { session } = target.worker;
		const { context } = session;
		const checkout = ship.checkoutOf(session);
		// Who has its terminal open now, apart from whether it's watched
		const watchers = [...ship.walkers.values()]
			.filter(({ person }) => person.sessions.includes(session.key))
			.map(({ name }) => name);

		return {
			hue: ship.projectHues?.get(session.project),
			titleHue: session.hue,
			title: session.title || session.project || 'A new session',
			rows: [
				['doing', doing(session)],
				['where', [session.project, session.engine.name].filter(Boolean).join(' on ')],
				context && [
					'context',
					// Used and left both, so it reads alongside Claude's own status line, which counts what's left
					`${Math.round(context.fill * 100)}% used, ${100 - Math.round(context.fill * 100)}% left of ${tokenCount(context.window)}${context.fill >= 0.75 ? ', getting full' : ''}`,
				],
				session.limit && ['usage limit', limitWords(session.limit.resetAt)],
				session.todos?.length && ['todos', todoWords(session.todos)],
				session.agents && ['subagents', `${session.agents} out`],
				session.faults && ['failed', `${plural(session.faults, 'tool')} this turn`],
				MODES[session.mode] && ['mode', MODES[session.mode]],
				context?.model && ['model', context.model],
				session.status !== 'stopped' && context && ['cache', freshness(target.worker, ship)],
				session.status === 'working' && session.turnAge && ['this turn', lasted(session.turnAge)],
				session.age && ['running', lasted(session.age)],
				checkout && ['branch', whereWorking(checkout)],
				checkout && ['changes', cargoWords(checkout)],
				session.assets && ['made', plural(session.assets, 'file')],
				watchers.length && ['terminal open', watchers.join(', ')],
				session.watching === false && ['watch', 'off: it leaves the ship when it stops'],
				LIFETIMES[session.lifetime] && ['lasts', LIFETIMES[session.lifetime].label.toLowerCase()],
			],
			hint: live(session)
				? 'Press for its terminal · right-click or hold for orders'
				: 'Press to look at it, its card beside it · right-click or hold for orders',
		};
	},
	monitor: (target, ship) => {
		const { session } = target.worker;

		return {
			title: session.title || session.project || 'A new session',
			hue: ship.projectHues?.get(session.project),
			titleHue: session.hue,
			rows: [['screen', live(session) ? 'its terminal, as it is now' : 'not running here']],
			hint: live(session) ? 'Press to open its terminal here' : 'Press to read its last reply',
		};
	},
	use: ({ use, room }) => {
		return {
			title: use.detail ?? use.tool,
			rows: [
				['by', use.session ? use.session.title || use.session.project : 'a session no longer aboard'],
				['tool', `${use.tool}${use.failed ? ', which failed' : ''}`],
				['when', relativeTime(Date.now() - use.ago)],
			],
			hint: use.session ? `Press to read its session · from ${room.name}` : `From ${room.name}`,
		};
	},
	log: ({ system, room }) => {
		return {
			title: `${titled(room.name)} log`,
			rows: [['lately', plural(system.uses ?? 0, 'use')], system.failures && ['failed', `${system.failures} of them`]],
			hint: 'Press to see what it was used on',
		};
	},
	link: ({ engine }) => {
		return {
			title: `Connection to ${engine.name}`,
			rows: [['answers in', engine.link === null ? 'no answer' : `${engine.link} ms`]],
		};
	},
	processes: target => {
		const { processes = [], services = [], title, project } = target.worker.session;
		const megabytes = bytes => `${Math.round((bytes ?? 0) / 1e6)} MB`;

		return {
			title: `What ${title || project} runs`,
			rows: [
				...processes.map(({ command, cpuSeconds, memoryBytes }) => [
					command,
					`${Math.round(cpuSeconds ?? 0)}s of CPU, ${megabytes(memoryBytes)}`,
				]),
				...services.map(({ name, port }) => ['shared', `port ${port} as ${name}`]),
			],
			hint: 'Press for its ports and processes',
		};
	},
	delivery: target => {
		const { pullRequest, branch } = target.checkout;
		const { passing, failing, pending } = pullRequest.checks;

		return {
			title: `#${pullRequest.number} ${pullRequest.title}`,
			rows: [
				['branch', branch],
				['state', pullRequest.draft ? 'a draft' : 'waiting for sign-off'],
				['checks', `${passing} passing, ${failing} failing, ${pending} running`],
			],
			hint: 'Press to review it',
		};
	},
	crew: target => {
		const { busy, lately } = target.crew;
		const done = Object.entries(lately);

		return {
			title: "paude's own jobs",
			rows: [
				['now', busy.length ? busy.join(', ') : 'nothing'],
				['last hour', done.length ? done.map(([job, count]) => `${job} ${count}`).join(', ') : 'nothing'],
			],
			hint: "paude's own helpers, on your Claude login: they draw on the same fuel",
		};
	},
	talk: ({ session }) => {
		return {
			title: `Said in ${session.title || session.project}`,
			rows: (session.talk?.lately ?? []).map(({ author, text, fromClaude, toClaude }) => [
				fromClaude ? 'Claude' : author,
				`${text}${toClaude ? ' (to Claude)' : ''}`,
			]),
			hint: 'Press for the chat',
		};
	},
	journey: ({ journey }) => {
		return {
			title: `Delivered: ${journey.distance}`,
			rows: [
				[
					'delivered',
					`${journey.replies} ${journey.replies === 1 ? 'reply' : 'replies'}, ${plural(journey.commits, 'commit')} pushed, ${plural(journey.artifacts, 'artifact')}`,
				],
				['last hour', `${journey.lately} further`],
			],
			hint: 'A reply counts one, an artifact two, a pushed commit five',
		};
	},
	inspection: ({ bay, sessions }) => {
		return {
			title: `${bay.name}: tested?`,
			rows: sessions.length
				? sessions.map(session => [
						session.title || session.project,
						session.tested?.said ?? 'nothing changed or tested yet',
					])
				: [['now', 'nobody at work here']],
			hint: "From each session's test runs, against when each file it changed last changed",
		};
	},
	fuel: ({ tank }) => {
		if (tank.unknown)
			return {
				title: 'Fuel: not known',
				rows: [
					['feeds', tank.engines.map(({ name }) => name).join(', ')],
					['account', 'not said: older paudes; update them there to see which account each runs on'],
				],
				hint: "One tank for every machine that doesn't say which account it runs on",
			};

		if (tank.usage)
			return {
				title: tank.plan ? `Fuel: ${tank.plan}` : 'Fuel',
				rows: [
					['feeds', tank.engines.map(({ name }) => name).join(', ')],
					[
						'5 hours',
						tank.usage.session.resetsAt
							? usedWords(tank.usage.session)
							: 'none used: the window opens with the next prompt',
					],
					tank.usage.week && ['week', usedWords(tank.usage.week)],
					...tank.usage.models.map(model => [`${model.name} week`, usedWords(model)]),
					tank.empty && ['now', 'a usage limit is in force'],
					['burning', `${tokenCount(tank.rate)} a minute`],
				],
				hint: `The account's limits, as /usage shows them, ${lasted(tank.usage.ago)} ago`,
			};

		return {
			title: tank.plan ? `Fuel: ${tank.plan}` : 'Fuel',
			rows: [
				['feeds', tank.engines.map(({ name }) => name).join(', ')],
				['burned', `${tokenCount(tank.burned)} in the last five hours`],
				['burning', `${tokenCount(tank.rate)} a minute`],
				[
					'left',
					(tank.empty && 'none: a usage limit is in force') ||
						(tank.level === null
							? 'not known until a limit is first hit, which measures the tank'
							: `about ${Math.round(tank.level * 100)}%, against the tank measured ${lasted(tank.capacityAgo)} ago`),
				],
			],
			hint: 'Tokens as input-token equivalents; the level is an estimate',
		};
	},
	subagent: ({ session, task }) => {
		return {
			title: task || 'A subagent',
			rows: [['sent by', session.title || session.project]],
			hint: 'Press for its tasks',
		};
	},
	commit: ({ commit, checkout }) => {
		return {
			title: commit.subject,
			rows: [
				['commit', commit.short],
				['branch', whereWorking(checkout)],
			],
			hint: 'Not pushed yet · press for its changes',
		};
	},
	cargo: ({ checkout }) => {
		return {
			title: `${checkout.project}: changes`,
			rows: [
				['changed', plural(checkout.changed, 'file')],
				['to push', plural(checkout.unpushed, 'commit')],
				['branch', whereWorking(checkout)],
				['checkout', `${checkout.root} on ${checkout.engineName}`],
			],
			hint: 'Press for its changes, to commit and push',
		};
	},
	person: target => {
		const { name, role, sessions } = target.person;

		return {
			title: name,
			rows: [
				['role', role],
				['terminals open', String(sessions.length)],
			],
		};
	},
	airlock: (target, ship) => {
		const guests = [...ship.people.values()].filter(({ role }) => role !== 'owner').map(({ name }) => name);

		return {
			title: 'Airlock',
			rows: [
				['for', 'inviting someone into one session, and seeing them off'],
				['invited aboard', guests.join(', ') || 'nobody'],
			],
			hint: 'Press to make or revoke invites',
		};
	},
	cloner: (target, ship) => ({
		title: 'New sessions',
		rows: [
			['for', 'a new prompt: paude finds the session it carries on, or the project to start one in'],
			ship.charged && ['now', 'waiting for the new session'],
		],
		hint: 'Press to write one',
	}),
	bridge: (target, ship) => {
		const people = [...ship.walkers.values()].map(({ name }) => name);

		return {
			title: 'Bridge',
			rows: [
				['aboard', people.join(', ') || 'nobody'],
				['terminals open', String(ship.screens.length)],
			],
			hint: lookHint(ship, BRIDGE),
		};
	},
	lounge: (target, ship) => ({
		title: 'Resting',
		rows: [['resting', plural(target.room.sessions.length, 'session')]],
		hint: `${lookHint(ship, LOUNGE)} · each wakes, or goes, from its orders`,
	}),
	system: ({ system, room }, ship) => {
		const hint = room && lookHint(ship, room.name);

		if (!system) return { title: titled(room.name), rows: [['now', 'not used on any machine yet']], hint };

		return {
			title: system.key.startsWith('mcp:') ? `${system.word} (MCP)` : titled(room?.name ?? system.label),
			rows: [
				['for', system.about],
				['now', system.active ? system.users.map(({ title, project }) => title || project).join(', ') : 'not in use'],
				['lately', `${plural(system.uses, 'use')} in the last ten minutes`],
				system.engines.length > 1 && [
					'by machine',
					system.engines.map(({ name, uses }) => `${name} ${uses}`).join(', '),
				],
				system.failures && ['failed', `${system.failures} of them`],
			],
			hint,
		};
	},
	engine: ({ engine }, ship) => {
		return {
			title: engine.name,
			rows: [
				['running', engine.detail],
				engine.limit && [
					'usage limit',
					`${plural(engine.limit.sessions, 'session')} waiting, ${limitWords(engine.limit.resetAt)}`,
				],
			],
			hint: lookHint(ship, engine.key),
		};
	},

	bay: ({ bay }, ship) => {
		const cargo = (bay.cargo ?? []).map(cargoWords).join('; ');
		const { language, files, since, commits } = bay.character ?? {};

		return {
			title: bay.name,
			hue: bay.hue,
			rows: [
				['sessions', plural(bay.sessions.length, 'session')],
				[
					'on',
					bay.engines.length > 1
						? bay.engines
								.map(
									({ key, name }) =>
										`${name} (${bay.sessions.filter(session => session.startsWith(`${key}/`)).length})`,
								)
								.join(', ')
						: bay.engines.map(({ name }) => name).join(', '),
				],
				cargo && ['changes', cargo],
				language && ['written in', LANGUAGE_NAMES[language] ?? language],
				files && ['size', plural(files, 'file')],
				since && ['since', `${new Date(since).toLocaleDateString()}, ${plural(commits, 'commit')}`],
			],
			hint: `${lookHint(ship, bay.name)} · right-click or hold for orders`,
		};
	},
};

export const flyoutOf = (target, ship) => (FLYOUTS[target.kind] ?? FLYOUTS.bay)(target, ship);
