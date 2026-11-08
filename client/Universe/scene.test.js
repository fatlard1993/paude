import { expect, test } from 'bun:test';

import Ship, {
	BEHIND_CONSOLE,
	appliancesOf,
	bendAround,
	countdown,
	remoteOfBay,
	resting,
	risersFor,
	runsFor,
	screenOf,
	tanksOf,
	triage,
} from './scene';
import { WATCHER_W, clonerAt, holdSpotAt, layOut, rowPitch, shortest, splitSeats, standingOf } from './plan';
import { huesApart } from '../../shared/hues';
import { SCREEN_RISE, UNIT, cableWeight, floor, setTrim, walls } from './station';
import { drawTransporter, shuttleAt } from './hull';
import { spriteSize } from './art';

const session = changes => ({
	id: 'a',
	title: 'A',
	project: 'paude',
	status: 'working',
	tool: 'Edit',
	unseen: 0,
	...changes,
});
const answer = (key, sessions, { projects = [], people = [] } = {}) => ({
	key,
	name: key,
	hue: 0,
	projects: projects.map(name => (typeof name === 'string' ? { name, hue: 10, watching: false } : name)),
	sessions,
	people,
});

const run = (ship, seconds) => {
	for (let step = 0; step < seconds * 60; step++) ship.step(1 / 60, false);
};

const shipWith = answers => {
	const made = new Ship();

	made.resize(800, 600);
	made.update(answers);
	run(made, 1);

	return made;
};

// Someone aboard, by the name they go by
const walkerNamed = (made, name) => [...made.walkers.values()].find(walker => walker.name === name);

test('a project is a section of the hull while a session of it is aboard or it is watched, in its place, by name when first aboard: the rest stay off', () => {
	const made = shipWith([
		answer('here', [session(), session({ id: 'b', project: 'site' })], {
			projects: ['paude', 'site', 'idle', { name: 'kept', hue: 20, watching: true }],
		}),
		answer('vps', [session({ id: 'c' })], { projects: ['paude'] }),
	]);

	expect(made.bays.map(({ name, sessions }) => [name, sessions])).toEqual([
		['kept', []],
		['paude', ['here/a', 'vps/c']],
		['site', ['here/b']],
	]);
	expect(made.bays.find(({ name }) => name === 'paude').engines.map(({ key }) => key)).toEqual(['here', 'vps']);
});

test('projects stand along the ship by name: one coming aboard goes in its place among the rest, and one that leaves and comes back is where it was', () => {
	const projects = ['paude', 'site', 'alpha', 'zeta'];
	const at = ids => [
		answer(
			'here',
			ids.map(([id, project]) => session({ id, project })),
			{ projects },
		),
	];
	const made = shipWith(
		at([
			['a', 'paude'],
			['b', 'site'],
		]),
	);

	expect(made.bays.map(({ name }) => name)).toEqual(['paude', 'site']);
	// site's one session gone, faded out
	made.update(
		at([
			['a', 'paude'],
			['c', 'zeta'],
			['d', 'alpha'],
		]),
	);
	run(made, 3);
	made.update(
		at([
			['a', 'paude'],
			['c', 'zeta'],
			['d', 'alpha'],
		]),
	);
	expect(made.bays.map(({ name }) => name)).toEqual(['alpha', 'paude', 'zeta']);
	made.update(
		at([
			['a', 'paude'],
			['b', 'site'],
			['c', 'zeta'],
			['d', 'alpha'],
		]),
	);
	expect(made.bays.map(({ name }) => name)).toEqual(['alpha', 'paude', 'site', 'zeta']);
});

test("a project's color is its own whatever else is at work: one before it by name on the same hue, it takes the nearest free one of the wheel, the same way every time", () => {
	const projects = [
		{ name: 'paude', hue: 150, watching: false },
		{ name: 'site', hue: 150, watching: false },
		{ name: 'alpha', hue: 300, watching: false },
	];
	const apart = huesApart(projects);

	expect(apart.get('paude')).toBe(150);
	expect(apart.get('alpha')).toBe(300);
	expect(apart.get('site')).toBe(165);
	// The step up taken, it steps down instead
	expect(huesApart([...projects, { name: 'ender', hue: 165 }]).get('site')).toBe(135);
	// However they're listed, whichever are at work, and with a remote paude naming one of them too
	expect(huesApart([...projects].reverse())).toEqual(apart);
	expect(huesApart([{ name: 'site', hue: 150 }])).toEqual(new Map([['site', 150]]));
	// A whole wheel of projects on one hue all read apart
	const crowd = huesApart(Array.from({ length: 24 }, (_, index) => ({ name: `p${index}`, hue: 45 })));

	expect(new Set(crowd.values()).size).toBe(24);
	expect([...crowd.values()].every(hue => hue % 15 === 0)).toBe(true);
	// A brand's hue is its own, whatever its name, and the others step round it; a paude that doesn't know the brand
	// doesn't unbrand it
	const branded = huesApart([
		{ name: 'alpha', hue: 160 },
		{ name: 'zeta', hue: 158, branded: true },
		{ name: 'zeta', hue: 150 },
	]);

	expect(branded.get('zeta')).toBe(158);
	expect(branded.get('alpha')).toBe(175);

	const hueOf = (made, name) => made.bays.find(bay => bay.name === name)?.hue;
	const alone = shipWith([answer('here', [session({ id: 'b', project: 'site' })], { projects })]);
	const together = shipWith([
		answer('here', [session(), session({ id: 'b', project: 'site' })], { projects }),
		answer('vps', [], { projects: [{ name: 'site', hue: 200, watching: false }] }),
	]);

	expect(hueOf(alone, 'site')).toBe(165);
	expect(hueOf(together, 'site')).toBe(165);
	expect(hueOf(together, 'paude')).toBe(150);
	// Idle, it's plain metal; its grey wears its color
	expect(hueOf(alone, 'paude')).toBeUndefined();
	expect(alone.workers.get('here/b').session.hue).toBe(165);
});

test('what needs you: those asking first, then those with news, newest reply first', () => {
	const needed = triage([
		session({ key: 'old', unseen: 1, reply: { at: 1 } }),
		session({ key: 'asks', status: 'waiting' }),
		session({ key: 'quiet' }),
		session({ key: 'new', unseen: 2, reply: { at: 5 } }),
	]);

	expect(needed.map(({ session: { key }, need }) => [key, need])).toEqual([
		['asks', 'asking'],
		['new', 'unread'],
		['old', 'unread'],
	]);
});

test('read here, its news goes until more comes', () => {
	const made = shipWith([answer('here', [session({ unseen: 2 })], { projects: ['paude'] })]);
	const worker = made.workers.get('here/a');

	expect(made.needs(worker.session)).toBe('unread');
	made.markRead(worker.session);
	expect(made.needs(worker.session)).toBeNull();

	made.update([answer('here', [session({ unseen: 3 })], { projects: ['paude'] })]);
	expect(made.needs(made.workers.get('here/a').session)).toBe('unread');
});

test('the owner stands among the greys by one they watch and moves on to the next, the same name on two servers one person', () => {
	const sam = sessions => ({ name: 'Sam', role: 'owner', sessions });
	const answers = watched => [
		answer('here', [session(), session({ id: 'b', project: 'site' })], {
			projects: ['paude', 'site'],
			people: [sam(watched)],
		}),
		answer('vps', [session({ id: 'x' })], { projects: ['paude'], people: [sam(['x'])] }),
	];
	const made = shipWith(answers(['a']));
	const walker = walkerNamed(made, 'Sam');
	const near = key => Math.abs(walker.spot.x - made.workers.get(key).seat.x) < 1.5;

	expect([...made.walkers.values()].map(({ name }) => name)).toEqual(['Sam']);
	expect(walker.person.sessions).toEqual(['here/a', 'vps/x']);
	expect(walker.pose).toBe('overseer');
	expect(near('here/a') || near('vps/x')).toBe(true);

	// Watching another session takes them to it in their turn
	made.update(answers(['b']));
	run(made, 60);
	made.update(answers(['b']));
	expect(near('here/b') || near('vps/x')).toBe(true);

	// With nothing at a port to watch, they wait by the nav table
	made.update(answers([]));
	made.update([answer('here', [], { projects: ['paude'], people: [sam([])] })]);
	expect(walkerNamed(made, 'Sam').room).toBe(made.bridge);
});

test('a guest comes aboard by the airlock to where their role puts them by their grey, and leaves by it', () => {
	const answers = people => [
		answer('here', [session(), session({ id: 'b', project: 'site' })], { projects: ['paude', 'site'], people }),
	];
	const made = shipWith(answers([]));
	const { airlock } = made;

	// Some while after the view opened, so they come aboard rather than being found there
	run(made, 10);
	made.update(
		answers([
			{ name: 'Sam', role: 'comment', sessions: ['b'] },
			{ name: 'Ada', role: 'drive', sessions: ['a'] },
		]),
	);

	const sam = walkerNamed(made, 'Sam');
	const ada = walkerNamed(made, 'Ada');

	expect([sam.x, sam.y]).toEqual([airlock.x, airlock.y]);
	run(made, 30);

	const seat = made.workers.get('here/a').seat;
	const watched = made.workers.get('here/b').seat;

	// Both on the bridge with the greys, just before their island's console, never behind a seat and clear of the next
	// row's screens: someone who may only comment looks in from before its terminal; someone who may drive sits by the grey
	expect(sam.pose).toBe('tourist');
	expect(sam.room).toBe(made.bridge);
	expect(Math.abs(sam.y - (watched.y + 0.25))).toBeLessThan(0.01);
	expect(sam.y).toBeGreaterThan(watched.y + 0.2);
	expect(ada.pose).toBe('copilot');
	expect(Math.hypot(ada.x - (seat.x + 0.55), ada.y - (seat.y + 0.25))).toBeLessThan(0.01);
	expect(made.screens).toEqual([]);

	made.update(answers([]));
	expect(walkerNamed(made, 'Sam').leaving).toBe(true);
	run(made, 30);
	expect(walkerNamed(made, 'Sam')).toBeUndefined();
});

test('whoever is aboard when the view opens is found at their place rather than walking in', () => {
	const answers = people => [answer('here', [session()], { projects: ['paude'], people })];
	const made = shipWith(answers([]));

	made.update(answers([{ name: 'Ada', role: 'drive', sessions: ['a'] }]));

	const ada = walkerNamed(made, 'Ada');
	const seat = made.workers.get('here/a').seat;

	expect(ada.path).toEqual([]);
	expect(Math.hypot(ada.x - (seat.x + 0.55), ada.y - (seat.y + 0.25))).toBeLessThan(0.01);
});

test('a stopped session waits in the lounge, its seat at its island kept, and goes back to its desk once woken', () => {
	const answers = status => [
		answer('here', [session(), session({ id: 'b', project: 'site', status })], { projects: ['paude', 'site'] }),
	];
	const made = shipWith(answers('stopped'));

	expect(made.bays.map(({ name, sessions }) => [name, sessions])).toEqual([
		['paude', ['here/a']],
		['site', ['here/b']],
	]);
	expect(made.lounge.sessions).toEqual(['here/b']);
	expect(made.workers.get('here/b').bay).toBe(made.lounge);
	expect(made.workers.get('here/b').homeSeat).toBeTruthy();

	made.update(answers('ready'));
	expect(made.bays.map(({ name, sessions }) => [name, sessions])).toEqual([
		['paude', ['here/a']],
		['site', ['here/b']],
	]);
	// The lounge stays, its couch waiting, rather than going with its last sitter
	expect(made.lounge.sessions).toEqual([]);
	expect(made.workers.get('here/b').bay.name).toBe('site');
});

test("an ended session leaves, and a watched project's machine stays aboard, nobody at it; one unwatched goes too", () => {
	const projects = ['paude', { name: 'site', hue: 10, watching: true }, 'other'];
	const made = shipWith([
		answer('here', [session(), session({ id: 'b', project: 'site' }), session({ id: 'c', project: 'other' })], {
			projects,
		}),
	]);

	made.update([answer('here', [session()], { projects })]);
	run(made, 1);
	made.update([answer('here', [session()], { projects })]);

	const site = made.layout.bays.find(({ name }) => name === 'site');

	expect(made.workers.has('here/b')).toBe(false);
	expect(made.layout.bays.map(({ name }) => name)).toEqual(['paude', 'site']);
	expect([site.parts.length, site.sessions.length, site.parts[0].machine > 0]).toEqual([1, 0, true]);
});

test('watched projects with nothing at work are machines like any other, each in its place along the ship, packed into whichever deck is shorter', () => {
	const watched = name => ({ name, hue: 10, watching: true });
	const made = shipWith([
		answer('here', [session()], { projects: ['paude', watched('a'), watched('b'), watched('c')] }),
	]);
	const idle = made.layout.bays.filter(({ name }) => name !== 'paude');

	expect(made.layout.bays.map(({ name }) => name)).toEqual(['a', 'b', 'c', 'paude']);
	for (const bay of idle)
		expect([bay.parts.length, bay.parts[0].machine > 0, Boolean(bay.sealed)]).toEqual([1, true, false]);
	// Each placed after those before it on its deck
	for (const deck of ['top', 'bottom']) {
		const xs = made.layout.bays.filter(({ hull }) => hull[deck]).map(({ x }) => x);

		expect(xs).toEqual([...xs].sort((a, b) => a - b));
	}
});

test("a machine's appliances: Claude at its core, then what it can reach, at work while its sessions are at it now", () => {
	const appliances = appliancesOf(
		['Read', 'Bash', 'mcp__github__search'],
		[
			session({ id: 'a', tool: 'Bash' }),
			session({ id: 'b', tool: 'mcp__github__search' }),
			session({ id: 'c', tool: 'Read', status: 'ready' }),
		],
		{ reactor: { uses: 63, failures: 2 }, library: { uses: 1, failures: 0 } },
	);
	const at = Object.fromEntries(appliances.map(({ key, users }) => [key, users.map(({ id }) => id)]));
	const shell = appliances.find(({ key }) => key === 'reactor');

	expect(appliances[0]).toMatchObject({ key: 'claude', uses: 64, failures: 2 });
	expect(at).toMatchObject({ claude: ['a', 'b'], reactor: ['a'], 'mcp:github': ['b'], library: [] });
	expect(shell).toMatchObject({ active: true, uses: 63, failures: 2, load: 1 });
	expect(appliances.find(({ key }) => key === 'dish')).toMatchObject({ active: false, uses: 0, load: 0 });
});

test('a new session is made in the materializer and walks to its desk; one stopped walks to the lounge, and back once woken', () => {
	const answers = (sessions, people = []) => [answer('here', sessions, { projects: ['paude', 'site'], people })];
	const made = shipWith(answers([session()]));

	made.charge();
	expect(made.charged).toBe(true);
	made.update(answers([session(), session({ id: 'b', project: 'site' })]));

	const worker = made.workers.get('here/b');
	const cloner = clonerAt(made.layout.materializer);

	expect([worker.x, worker.y]).toEqual([cloner.x, cloner.y]);
	expect(made.charged).toBe(false);
	run(made, 1);
	expect([worker.x, worker.y]).toEqual([cloner.x, cloner.y]);
	run(made, 30);
	expect(made.walking(worker)).toBe(false);
	expect(Math.hypot(worker.x - made.placeOf(worker).x, worker.y - made.placeOf(worker).y)).toBeLessThan(0.01);

	made.update(answers([session(), session({ id: 'b', project: 'site', status: 'stopped' })]));
	expect(made.walking(worker)).toBe(true);
	run(made, 30);
	expect(worker.bay).toBe(made.lounge);
	expect(Math.hypot(worker.x - made.placeOf(worker).x, worker.y - made.placeOf(worker).y)).toBeLessThan(0.01);
});

test('a checkout with work in it has cargo in the hold; fewer commits to push than last time pushed them, and a hauler takes them away', () => {
	const checkout = unpushed => ({ root: '/work/paude', changed: 2, unpushed });
	const working = checkouts => [
		{ ...answer('here', [session({ checkout: '/work/paude' })], { projects: ['paude'] }), checkouts },
	];
	const made = new Ship();

	made.resize(800, 600);
	made.update(working([checkout(3)]));
	expect(made.cargo).toMatchObject([{ changed: 2, unpushed: 3, project: 'paude' }]);
	expect(made.haulers).toHaveLength(0);

	made.update(working([checkout(0)]));
	expect(made.haulers).toMatchObject([{ crates: 3 }]);
	run(made, 7);
	expect(made.haulers).toHaveLength(0);
});

test("what is staged to ship is in the shipping bay in the hull's bottom deck, at the bridge's end, with the pad: a pod for each checkout, all inside it, clear of every project's machine", () => {
	// Six checkouts, each with a session working in it
	const names = Array.from({ length: 6 }, (_, index) => `p${index}`);
	const checkouts = names.map(name => ({ root: `/work/${name}`, changed: 2, unpushed: 1 }));
	const sessions = names.map(name => session({ id: name, project: name, checkout: `/work/${name}` }));
	const made = new Ship();

	made.resize(800, 600);
	made.update([{ ...answer('here', sessions, { projects: names }), checkouts }]);

	const { hold, hangar, building, bays } = made.layout;
	const inside = (point, box) =>
		point.x >= box.x && point.x <= box.x + box.w && point.y >= box.y && point.y <= box.y + box.d;
	const overlap = (a, b) =>
		a.x < b.x + b.w - 1e-9 && b.x < a.x + a.w - 1e-9 && a.y < b.y + b.d - 1e-9 && b.y < a.y + a.d - 1e-9;

	// In the hull, its floor the belly, the hangar ending where the bridge starts
	for (const room of [hold, hangar]) {
		expect(room.y + room.d).toBeCloseTo(building.bottom);
		expect(room.x).toBeGreaterThanOrEqual(building.left);
		for (const part of bays.flatMap(({ parts }) => parts)) expect(overlap(room, part)).toBe(false);
	}
	expect(hangar.x + hangar.w).toBeCloseTo(made.bridge.x);
	expect(made.layout.gondola).toBeUndefined();
	expect(made.cargo).toHaveLength(6);
	made.cargo.forEach((_, index) => expect(inside(holdSpotAt(hold, index), hold)).toBe(true));
});

test('a pod whose cradle before it empties slides over to it, hovering a little on the way, in the hold and the hangar alike', () => {
	const names = ['p0', 'p1', 'p2'];
	const working = roots => [
		{
			...answer(
				'here',
				roots.map(name => session({ id: name, project: name, checkout: `/work/${name}` })),
				{ projects: names },
			),
			checkouts: roots.map(name => ({
				root: `/work/${name}`,
				changed: 1,
				unpushed: 0,
				pullRequest: { state: 'OPEN', checks: {} },
			})),
		},
	];
	const made = new Ship();

	made.resize(800, 600);
	made.update(working(names));
	run(made, 2);

	const key = 'here:/work/p2';

	expect(made.cradleOf('hold', key, 2)).toEqual({ index: 2, lift: 0 });

	// The middle one's work is done: the last slides from its cradle to the middle one, lifted most half way
	made.update(working(['p0', 'p2']));
	expect(made.cargo.map(checkout => checkout.key)).toEqual(['here:/work/p0', key]);
	expect(made.deliveries.map(checkout => checkout.key)).toEqual(['here:/work/p0', key]);
	expect(made.cradleOf('hold', key, 1)).toEqual({ index: 2, lift: 0 });
	run(made, 0.45);

	const half = made.cradleOf('hold', key, 1);

	expect(half.index).toBeGreaterThan(1);
	expect(half.index).toBeLessThan(2);
	expect(half.lift).toBeGreaterThan(0.95);
	expect(made.cradleOf('hangar', key, 1).index).toBeCloseTo(half.index, 5);
	// The first, its cradle kept, stays put
	expect(made.cradleOf('hold', 'here:/work/p0', 0)).toEqual({ index: 0, lift: 0 });
	run(made, 1);
	expect(made.cradleOf('hold', key, 1)).toEqual({ index: 1, lift: 0 });
	expect(made.cradleOf('hangar', key, 1)).toEqual({ index: 1, lift: 0 });

	// Cut off mid-slide by another going, it carries on from where it's shown
	made.update(working(['p1', 'p2']));
	made.update(working(['p2']));
	run(made, 0.45);
	expect(made.cradleOf('hold', key, 0).index).toBeLessThan(1);
	expect(made.cradleOf('hold', key, 0).index).toBeGreaterThan(0);
});

test("a reactor out of power counts down to the limit's reset, and says only LIMIT when Claude didn't say", () => {
	const now = Date.UTC(2026, 9, 31, 12);

	expect(countdown(now + 80 * 60_000, now)).toBe('1H 20M');
	expect(countdown(now + 59_000, now)).toBe('1M');
	expect(countdown(now - 1000, now)).toBe('RESETTING');
	expect(countdown(null, now)).toBe('LIMIT');
});

test('an engine room is out of power while any of its sessions waits out a usage limit, until the soonest reset', () => {
	const ship = new Ship();
	const resetAt = Date.now() + 3_600_000;

	ship.update([
		{
			key: 'here',
			name: 'here',
			tools: [],
			projects: [{ name: 'paude' }],
			sessions: [
				session({ id: 'a', status: 'ready', limit: { resetAt } }),
				session({ id: 'b', status: 'ready', limit: { resetAt: resetAt + 60_000 } }),
				session({ id: 'c' }),
			],
		},
	]);

	expect(ship.engines[0].limit).toEqual({ sessions: 2, resetAt });
});

test('a context much emptier than last seen was compacted, and a cube of it goes', () => {
	const answers = fill => [answer('here', [session({ context: { fill } })], { projects: ['paude'] })];
	const made = shipWith(answers(0.7));

	made.update(answers(0.65));
	expect(made.workers.get('here/a').compactedAt).toBeUndefined();

	made.update(answers(0.1));
	expect(made.workers.get('here/a').compactedAt).toBe(made.time);
});

test("a machine elsewhere has a link as quick as its last answer, none when it didn't answer, and here none at all", () => {
	const made = shipWith([
		answer('here', [session()], { projects: ['paude'] }),
		{ ...answer('vps', [], { projects: ['paude'] }), remote: { url: 'https://vps', name: 'vps' }, latency: 120 },
		{ ...answer('far', [], { projects: ['paude'] }), remote: { url: 'https://far', name: 'far' }, latency: null },
	]);

	expect(Object.fromEntries(made.engines.map(({ key, link }) => [key, link]))).toEqual({
		here: undefined,
		vps: 120,
		far: null,
	});
});

test('engines on one Claude account share its tank: what they burned against the largest measured size', () => {
	const fuel = more => ({
		account: 'abc',
		plan: 'Max',
		burned: 0,
		rate: 0,
		capacity: null,
		capacityAgo: null,
		...more,
	});
	const [shared, own, unknown] = tanksOf([
		{ key: 'here', fuel: fuel({ burned: 300, rate: 10, capacity: 1000, capacityAgo: 60_000 }) },
		{ key: 'vps', fuel: fuel({ burned: 200, capacity: 800 }) },
		{ key: 'work', fuel: fuel({ account: 'xyz', burned: 50 }), limit: { sessions: 1 } },
		{ key: 'old' },
		{ key: 'older' },
	]);

	expect(shared).toMatchObject({ burned: 500, rate: 10, capacity: 1000, level: 0.5, empty: false });
	expect(shared.engines.map(({ key }) => key)).toEqual(['here', 'vps']);
	// Not measured yet, and run dry by a limit
	expect(own).toMatchObject({ level: null, empty: true });
	// Those that don't say what they run on share a tank, its level not known
	expect(unknown).toMatchObject({ unknown: true, level: null, burned: 0 });
	expect(unknown.engines.map(({ key }) => key)).toEqual(['old', 'older']);
});

test("what the work makes leaves its grey's desk: a reply for the bridge, a part for the hold", () => {
	const answers = ({ turn, changed }) => [
		{
			...answer('here', [session({ checkout: '/p/paude', reply: { turn, text: 'Done' } })], { projects: ['paude'] }),
			checkouts: [{ root: '/p/paude', changed, unpushed: 0, branch: 'main', trunk: true }],
		},
	];
	const made = shipWith(answers({ turn: 1, changed: 2 }));

	expect(made.parcels).toEqual([]);
	made.update(answers({ turn: 2, changed: 4 }));
	expect(made.parcels.map(({ kind }) => kind).sort()).toEqual(['part', 'part', 'reply']);

	const reply = made.parcels.find(({ kind }) => kind === 'reply');
	const part = made.parcels.find(({ kind }) => kind === 'part');
	const [bridge, hold] = [reply.path.at(-1), part.legs.at(-1).path.at(-1)];

	expect(bridge.x).toBeGreaterThan(made.bridge.x);
	expect(hold).toEqual(holdSpotAt(made.layout.hold, 0));
	// The part by way of the tube: up from its desk into the pipe in the ceiling over its island, down the bridge's aft
	// wall and along to the hold, and out of the hopper onto its stack
	const net = made.tubeNet();
	const { pipe } = part.tube;

	expect(pipe[0].y).toBe(net.rows.get(made.workers.get('here/a').seat.island.y).y);
	expect(pipe.at(-1)).toEqual({ x: net.drop, y: net.hopper });
	expect(pipe.some(({ x, y }) => x === net.trunk && y === net.rail)).toBe(true);
	// Out of the hopper on the crane's hook: along the rail to over its pod, then down onto it
	expect(part.legs[0]).toEqual({
		x: made.layout.tube.drop,
		y: made.layout.tube.hopper,
		path: [
			{ x: made.layout.tube.drop, y: made.layout.tube.hopper + 0.6 },
			{ x: hold.x, y: made.layout.tube.hopper + 0.6 },
			hold,
		],
		craned: true,
	});

	run(made, 12);
	expect(made.parcels.filter(({ kind }) => kind === 'part')).toEqual([]);
	run(made, 30);
	expect(made.parcels).toEqual([]);
});

test("a machine's sign on the hull is the shortest start of its name no other project's begins with", () => {
	expect(shortest(['home-page', 'humanity', 'hypertether', 'htpc-remote', 'log', 'lldtdd', 'listi'])).toEqual({
		'home-page': 'ho',
		humanity: 'hu',
		hypertether: 'hy',
		'htpc-remote': 'ht',
		log: 'lo',
		lldtdd: 'll',
		listi: 'li',
	});
	expect(shortest(['land', 'land-ledger'])).toEqual({ land: 'land', 'land-ledger': 'land-' });
});

test("a project's machine is as wide as the project is big, on one deck", () => {
	const project = (name, files) => ({ name, hue: 10, character: { files } });
	const made = shipWith([
		answer(
			'here',
			[
				session(),
				session({ id: 'b', project: 'site' }),
				session({ id: 'c', project: 'big' }),
				session({ id: 'd', project: 'big' }),
			],
			{ projects: [project('paude', 40), project('site', 10), project('big', 50000)] },
		),
	]);
	const byName = Object.fromEntries(made.layout.bays.map(bay => [bay.name, bay]));

	expect(made.layout.bays.every(bay => bay.parts.length === 1)).toBe(true);
	expect(byName.big.parts[0].machine).toBeGreaterThan(byName.paude.parts[0].machine);
	expect(byName.paude.parts[0].machine).toBeGreaterThan(byName.site.parts[0].machine);
	expect(byName.big.parts[0].machine).toBeLessThanOrEqual(2.6);
});

test('the shortest-name rule at its edges: one name alone, one name the start of another, case, and a one-letter name', () => {
	expect(shortest(['vanilla-bean-components'])).toEqual({ 'vanilla-bean-components': 'va' });
	expect(shortest(['log', 'logger'])).toEqual({ log: 'log', logger: 'logg' });
	expect(shortest(['Paude', 'paude-site'])).toEqual({ Paude: 'Paude', 'paude-site': 'paude-' });
	expect(shortest(['x', 'xy'])).toEqual({ x: 'x', xy: 'xy' });
	expect(shortest([])).toEqual({});
});

test('machines start right behind the engine bay, the first above the spine', () => {
	const layout = names =>
		shipWith([
			answer(
				'here',
				names.map((project, index) => session({ id: `s${index}`, project })),
				{ projects: names },
			),
		]).layout;

	expect(layout([]).bays).toEqual([]);

	const { bays, engineering, systems } = layout(['one']);

	expect([bays[0].parts.length, bays[0].hull.top]).toEqual([1, true]);
	expect(bays[0].x).toBeCloseTo(engineering.x + engineering.w);
	// Reading, editing, commands and the web all in the engine bay, so the data of each runs the same way
	expect(['library', 'forge', 'reactor', 'dish'].map(key => systems[`here/${key}`].within)).toEqual([
		engineering,
		engineering,
		engineering,
		engineering,
	]);
});

test('machines of every size pack on one deck each without overlapping, and stay inside the hull', () => {
	const sizes = [50421, 934, 385, 369, 271, 257, 108, 66, 34, 3, undefined];
	const names = sizes.map((files, index) => `p${index}`);
	const made = shipWith([
		answer(
			'here',
			names.flatMap((project, index) =>
				Array.from({ length: (index % 3) + 1 }, (_, n) => session({ id: `${project}-${n}`, project })),
			),
			{ projects: names.map((name, index) => ({ name, hue: index * 30, character: { files: sizes[index] } })) },
		),
	]);
	const parts = made.layout.bays.flatMap(bay => bay.parts);

	expect(parts.length).toBe(11);
	// Each deck holds all of its project's sessions
	for (const bay of made.layout.bays) expect(bay.parts[0].sessions).toEqual(bay.sessions);
	for (const [index, a] of parts.entries()) {
		expect(a.x + a.w).toBeLessThanOrEqual(made.layout.building.right + 1e-9);
		for (const b of parts.slice(index + 1))
			if (a.y === b.y) expect(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9).toBe(true);
	}
});

test('a hundred projects make a deeper ship rather than an endless one: more levels, the hull kept about three times as long as deep', () => {
	const names = Array.from({ length: 100 }, (_, index) => `p${index}`);
	const made = shipWith([
		answer('here', [session({ project: 'p0' }), session({ id: 'b', project: 'p1' })], {
			projects: names.map((name, index) => ({
				name,
				hue: index * 7,
				watching: true,
				character: { files: 3 + ((index * 37) % 400) },
			})),
		}),
	]);
	const { building, bays, halls } = made.layout;
	const parts = bays.flatMap(bay => bay.parts);

	expect(bays).toHaveLength(100);
	expect(halls.length).toBeGreaterThan(1);
	expect((building.right - building.left) / (building.bottom - building.top)).toBeLessThanOrEqual(3.2);
	for (const [index, a] of parts.entries()) {
		expect(a.x + a.w).toBeLessThanOrEqual(building.right + 1e-9);
		expect(a.y + a.d).toBeLessThanOrEqual(building.bottom + 1e-9);
		for (const b of parts.slice(index + 1))
			if (a.y === b.y) expect(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9).toBe(true);
	}
	// Only the top deck and the bottom one against the hull
	expect(bays.filter(({ hull }) => hull.top).every(({ y }) => y === building.top)).toBe(true);
});

test('the ship at its edges: none, one or two projects on one level, a level more only where it shortens the ship, and nothing outside the hull or not a number up to two hundred', () => {
	const shipOf = count => {
		const names = Array.from({ length: count }, (_, index) => `p${index}`);
		const working = names.slice(0, 12);

		return shipWith([
			answer(
				'here',
				working.flatMap((project, index) =>
					Array.from({ length: (index % 4) + 1 }, (_, n) => session({ id: `${project}-${n}`, project })),
				),
				{
					projects: names.map((name, index) => ({
						name,
						hue: index * 7,
						character: { files: 3 + ((index * 37) % 900) },
					})),
				},
			),
		]).layout;
	};

	for (const count of [0, 1, 2]) expect(shipOf(count).halls).toHaveLength(1);
	// A stopped session's lounge, exactly two of the bridge's rows deep, takes two of them, not all three, so a small
	// ship with one stays on one level
	const lounged = shipWith([
		answer('here', [session(), session({ id: 'b' }), session({ id: 's', status: 'stopped' })], {
			projects: ['paude', 'site', 'notes', 'ender-launcher', 'ops'],
		}),
	]).layout;

	expect(lounged.halls).toHaveLength(1);
	for (const count of [0, 1, 2, 49, 50, 51, 150, 200]) {
		const { building, bays, rooms } = shipOf(count);
		const parts = bays.flatMap(bay => bay.parts);
		const numbers = [
			...Object.values(building),
			...rooms.flatMap(({ x, y, w, d }) => [x, y, w, d]),
			...parts.flatMap(({ x, y, w, d }) => [x, y, w, d]),
		];

		expect(numbers.every(Number.isFinite)).toBe(true);
		for (const [index, a] of parts.entries()) {
			expect(a.x >= building.left - 1e-9 && a.x + a.w <= building.right + 1e-9).toBe(true);
			expect(a.y >= building.top - 1e-9 && a.y + a.d <= building.bottom + 1e-9).toBe(true);
			for (const b of parts.slice(index + 1))
				if (a.y === b.y) expect(a.x + a.w <= b.x + 1e-9 || b.x + b.w <= a.x + 1e-9).toBe(true);
		}
	}
});

test("a project's sessions sit at its islands in order, split so none runs on past six seats, however many projects share the bridge", () => {
	const bays = [
		{ name: 'big', hue: 10, sessions: Array.from({ length: 14 }, (_, index) => `big${index}`) },
		...Array.from({ length: 6 }, (_, project) => ({
			name: `p${project}`,
			hue: project * 40,
			sessions: Array.from({ length: 1 + (project % 3) }, (_, index) => `p${project}-${index}`),
		})),
	];
	const { rooms } = layOut({
		bays: bays.map(bay => ({ ...bay, seated: bay.sessions.length })),
		lounge: { count: 3, sessions: ['s1', 's2', 's3'] },
	});
	const bridge = rooms.find(({ kind }) => kind === 'bridge');

	for (const { name, sessions } of bays) {
		const islands = bridge.islands.filter(island => island.name === name);

		expect(islands.length).toBe(Math.ceil(sessions.length / 6));
		expect(islands.flatMap(({ seats }) => seats.map(({ key }) => key))).toEqual(sessions);
		for (const island of islands) expect(island.seats.length).toBeLessThanOrEqual(6);
	}
});

const MINUTE = 60_000;
const lounger = coldAgo => answer('here', [session({ status: 'stopped', tool: null, coldAgo, stoppedAgo: coldAgo })]);

test("a lounger's pile is one can each half hour since its cache went cold, already there when first seen", () => {
	const made = shipWith([lounger(95 * MINUTE)]);
	const worker = made.workers.get('here/a');

	expect(made.cansOf(worker)).toBe(3);
	expect(worker.tossedAt).toBeUndefined();
});

test('each half hour a lounger tosses a can onto its pile, landing there at the end of the toss', () => {
	const made = shipWith([lounger(29 * MINUTE)]);
	const worker = made.workers.get('here/a');

	expect(made.cansOf(worker)).toBe(0);
	made.update([lounger(31 * MINUTE)]);
	// In the air: not on the pile yet
	expect(made.cansOf(worker)).toBe(0);
	expect(worker.tossedAt).toBe(made.time);
	run(made, 1);
	expect(made.cansOf(worker)).toBe(1);
	// Nothing more to toss until the next half hour
	made.update([lounger(45 * MINUTE)]);
	expect(made.cansOf(worker)).toBe(1);
});

test("a lounger's empties go to its head by the same clock as its pile: steady at first, flushed, swaying and blinking long by the half, passed out with its head hung at eight cans' worth", () => {
	const at = minutes => {
		const made = shipWith([lounger(minutes * MINUTE)]);
		const worker = made.workers.get('here/a');

		run(made, 2);

		return { made, worker, pose: made.loungerPose(worker) };
	};
	const sober = at(10);

	expect(sober.made.drunkOf(sober.worker)).toBeCloseTo(10 / 240, 3);
	expect(sober.pose).toMatchObject({
		out: false,
		sway: 0,
		lurch: 0,
		hiccup: 0,
		sag: 0,
		lean: { x: 0, y: 0 },
		flush: 0,
	});

	const tipsy = at(150);

	expect(tipsy.made.drunkOf(tipsy.worker)).toBeCloseTo(150 / 240, 3);
	expect(tipsy.pose.out).toBe(false);
	expect(tipsy.pose.flush).toBeCloseTo((150 / 240 - 0.15) / 0.85, 3);
	// Swaying by up to a couple of pixels over a few seconds
	const sways = new Set();

	for (let step = 0; step < 60; step++) {
		run(tipsy.made, 0.1);
		sways.add(tipsy.made.loungerPose(tipsy.worker).sway);
	}
	expect(Math.max(...[...sways].map(Math.abs))).toBeGreaterThanOrEqual(1);
	expect(Math.max(...[...sways].map(Math.abs))).toBeLessThanOrEqual(2);

	const gone = at(5 * 60);

	expect(gone.made.drunkOf(gone.worker)).toBe(1);
	expect(gone.pose).toEqual({
		drunk: 1,
		out: true,
		sway: 0,
		lurch: 0,
		hiccup: 0,
		shut: true,
		sag: 0,
		lean: { x: 1, y: 4 },
		flush: 1,
	});
	// Its pile still counts every half hour
	expect(gone.made.cansOf(gone.worker)).toBe(10);
});

test("a lounger's pile goes when it's resumed, so stopping again starts a fresh one; and with it when it's removed", () => {
	const made = shipWith([lounger(95 * MINUTE)]);
	const worker = made.workers.get('here/a');

	made.cansOf(worker);
	made.update([answer('here', [session()])]);
	expect(worker.lounging).toBe(false);
	expect(worker.cans).toBeUndefined();
	expect(made.lounge?.sessions ?? []).not.toContain('here/a');
	// Stopped again: its cache is warm, so no cans, and none tossed for the old pile
	made.update([lounger(0)]);
	expect(made.cansOf(worker)).toBe(0);
	expect(worker.tossedAt).toBeUndefined();

	// Removed, it beams out from the couch, its pile with it, and is gone once it has
	made.update([answer('here', [])]);
	expect(worker.leaving).toBe(true);
	run(made, 3);
	made.update([answer('here', [])]);
	expect(made.lounge?.sessions ?? []).not.toContain('here/a');
	expect(made.workers.has('here/a')).toBe(false);
});

test('a waiting session whose cache has gone cold rests in the lounge, unless it is kept warm or going, or is asking', () => {
	const cold = { warm: false, cache: { left: 0, life: 300_000, ago: 60_000 } };

	expect(resting({ status: 'stopped' })).toBe(true);
	expect(resting({ status: 'ready', context: cold })).toBe(true);
	expect(resting({ status: 'ready', context: { ...cold, warm: true } })).toBe(false);
	expect(resting({ status: 'ready', context: cold, keeping: 'warm' })).toBe(false);
	// As an older paude says it
	expect(resting({ status: 'ready', context: cold, kept: 'going' })).toBe(false);
	expect(resting({ status: 'ready', context: cold, keeping: 'fabled' })).toBe(false);
	expect(resting({ status: 'waiting', context: cold })).toBe(false);
	expect(resting({ status: 'ready' })).toBe(false);

	const made = shipWith([
		answer('here', [session({ status: 'ready', tool: null, context: cold })], { projects: ['paude'] }),
	]);
	const worker = made.workers.get('here/a');

	expect(made.lounge.sessions).toEqual(['here/a']);
	// Its seat at its project's island kept for it while it rests, its grey on the couch
	expect(made.bays.find(({ name }) => name === 'paude').sessions).toEqual(['here/a']);
	expect(worker.homeSeat).toBeTruthy();
	expect(worker.seat).not.toEqual(worker.homeSeat);
});

test("a ship for each subscription: paudes on one account together, one that does not say sharing this machine's", async () => {
	const { shipsOf } = await import('./shown');
	const looks = [
		{ key: 'vps' },
		{ key: 'here', fuel: { account: 'a' } },
		{ key: 'work', fuel: { account: 'b' } },
		{ key: 'laptop', fuel: { account: 'a' } },
		{ key: 'old' },
	];
	const keys = ships => [...ships].map(([ship, answers]) => [ship, answers.map(({ key }) => key)]);

	expect(keys(shipsOf(looks))).toEqual([
		['account:a', ['here', 'vps', 'laptop', 'old']],
		['account:b', ['work']],
	]);
	expect(keys(shipsOf([{ key: 'here' }, { key: 'old' }]))).toEqual([['own:here', ['here', 'old']]]);
});

test("a session's subagent count is its paude's word: no more small greys are made than are ever drawn", () => {
	const made = shipWith([answer('here', [session({ agents: 1e9 })], { projects: ['paude'] })]);

	run(made, 1);
	expect(made.workers.get('here/a').smalls.length).toBeLessThanOrEqual(5);
});

test('the stars stream past faster the harder the engines burn', () => {
	const idle = shipWith([{ ...answer('here', []), fuel: { account: 'a', rate: 0 } }]);
	const burning = shipWith([{ ...answer('here', []), fuel: { account: 'a', rate: 60_000 } }]);

	run(idle, 1);
	run(burning, 1);
	expect(burning.pace).toBeGreaterThan(idle.pace * 5);
});

test('each engine has its own reading, editing, commands and web beside it, none over another', () => {
	const made = shipWith([
		{ ...answer('here', [session({ id: 'a', project: 'paude' })], { projects: ['paude'] }), fuel: { account: 'x' } },
		{
			...answer('https://vps', [session({ id: 'b', project: 'paude' })], { projects: ['paude'] }),
			fuel: { account: 'x' },
		},
	]);
	const { systems, engineering } = made.layout;
	const rooms = Object.values(systems);

	expect(Object.keys(systems).sort()).toEqual(
		['here', 'https://vps'].flatMap(machine => ['dish', 'forge', 'library', 'reactor'].map(key => `${machine}/${key}`)),
	);
	expect(new Set(rooms.map(({ name }) => name)).size).toBe(8);
	for (const room of rooms) {
		expect(room.within).toBe(engineering);
		for (const other of rooms.filter(other => other !== room))
			expect(
				room.x < other.x + other.w - 1e-9 &&
					other.x < room.x + room.w - 1e-9 &&
					room.y < other.y + other.d - 1e-9 &&
					other.y < room.y + room.d - 1e-9,
			).toBe(false);
	}
});

test("more engines' systems go compact, so the ship keeps its depth and its length and the projects their shape", () => {
	const bayWith = count =>
		shipWith(
			['here', 'https://vps', 'https://work'].slice(0, count).map(key => ({
				...answer(key, key === 'here' ? [session({ id: 'a', project: 'paude' })] : [], {
					projects: key === 'here' ? ['paude', 'site', 'notes'] : [],
				}),
				fuel: { account: 'x' },
			})),
		).layout.engineering;
	const depthWith = count => bayWith(count).d;
	const widthWith = count => bayWith(count).w;

	expect(depthWith(2)).toBeCloseTo(depthWith(1));
	expect(depthWith(3)).toBeCloseTo(depthWith(1));
	expect(widthWith(3)).toBeCloseTo(widthWith(1));
});

test("a walk across the bridge goes round its islands, never through a console nor over the next row's screens", () => {
	const made = shipWith([
		answer(
			'here',
			['one', 'two', 'three', 'four'].flatMap((project, index) =>
				[0, 1, 2].map(seat => session({ id: `s${index}-${seat}`, project })),
			),
			{ projects: ['one', 'two', 'three', 'four'] },
		),
	]);
	const { islands } = made.bridge;
	const seats = [...made.workers.values()].map(worker => made.placeOf(worker));
	// In a console, as it looks: from where its seats are to half a unit before its foot, so close that a grey's feet
	// there show among it; and among a row's screens, risen from its consoles'
	// foot toward the row before, but for the line just behind its consoles that leads to and from its seats
	const inConsole = ({ x, y }) =>
		islands.some(island => x > island.x && x < island.x + island.w && y > island.y && y < island.y + 0.5);
	const inScreens = ({ x, y }) =>
		islands.some(
			island =>
				x > island.x &&
				x < island.x + island.w &&
				y > island.y + 0.2 - SCREEN_RISE / UNIT.y &&
				y < island.y + 0.2 &&
				Math.abs(y - (island.y - BEHIND_CONSOLE)) > 1e-9,
		);

	expect(new Set(islands.map(({ y }) => y)).size).toBeGreaterThan(1);
	for (const from of seats)
		for (const to of seats) {
			const path = [from, ...made.acrossBridge(from, to)];

			// Every leg but the first step up from the seat and the last down into one
			for (let leg = 1; leg < path.length - 2; leg++)
				for (let t = 0; t <= 1; t += 0.05) {
					const point = {
						x: path[leg].x + (path[leg + 1].x - path[leg].x) * t,
						y: path[leg].y + (path[leg + 1].y - path[leg].y) * t,
					};

					expect(inConsole(point)).toBe(false);
					expect(inScreens(point)).toBe(false);
				}
		}
});

// The islands of the bridge in two rows of two, a grey at each
const twoRows = () =>
	shipWith([
		answer(
			'here',
			['one', 'two', 'three', 'four'].map((project, index) => session({ id: `s${index}`, project })),
			{ projects: ['one', 'two', 'three', 'four'] },
		),
	]);

test('whoever stands before an island walks to another place along its row down the aisle before it, never behind a console', () => {
	const made = twoRows();
	const { islands } = made.bridge;
	const rowOf = seat => islands.find(({ y }) => y === seat.y);
	const seats = [...made.workers.values()].map(({ seat }) => seat);
	const before = seat => ({ x: seat.x - 0.6, y: standingOf(made.bridge, seat.y) });
	// Behind any island's console: back from where anyone stands before it to where its screens' backs are, across its
	// console and its end caps
	const behind = ({ x, y }) =>
		islands.some(
			island =>
				x > island.x - 0.45 &&
				x < island.x + island.w + 0.45 &&
				y < standingOf(made.bridge, island.y) &&
				y > island.y - BEHIND_CONSOLE - 0.1,
		);

	expect(islands).toHaveLength(4);
	expect(new Set(seats.map(rowOf)).size).toBe(2);
	for (const from of seats)
		for (const to of seats) {
			const path = made.acrossBridge(before(from), before(to));

			for (const point of path) expect(behind(point)).toBe(false);
			// Along one row: a step down into the aisle, along it, and a step back up
			if (from.y === to.y && from !== to) expect(path).toHaveLength(3);
		}
});

test('whoever moves on to another place on the bridge after a poll laid its rooms anew walks there within it, not out of its door and back in', () => {
	const answers = [
		answer(
			'here',
			['one', 'two', 'three', 'four'].map((project, index) => session({ id: `s${index}`, project })),
			{
				projects: ['one', 'two', 'three', 'four'],
				people: [{ key: 'chase', name: 'chase', role: 'owner', sessions: [] }],
			},
		),
	];
	const made = shipWith(answers);
	const pilot = walkerNamed(made, 'chase');
	const { bridge } = made;
	const was = { ...pilot.spot };

	// Time for the pilot to move on to the next grey; the poll lays the rooms anew, the same as they were
	run(made, 25);
	made.update(answers);
	expect(made.moved).toBe(false);
	expect(pilot.spot).not.toEqual(was);
	expect(pilot.path.length).toBeGreaterThan(0);
	expect(pilot.path.length).toBeLessThanOrEqual(5);
	for (const { x, y } of pilot.path) {
		expect(x).toBeGreaterThan(bridge.x);
		expect(x).toBeLessThan(bridge.x + bridge.w);
		expect(y).toBeGreaterThan(bridge.y);
		expect(y).toBeLessThan(bridge.y + bridge.d);
	}
});

test('a grey moving along its own console to another of its seats walks behind it, straight there', () => {
	const made = shipWith([
		answer(
			'here',
			['a', 'b', 'c'].map(id => session({ id })),
			{ projects: ['paude'] },
		),
	]);
	const [a, , c] = [...made.workers.values()];
	const [from, to] = [made.placeOf(a), made.placeOf(c)];
	const back = a.seat.island.y - BEHIND_CONSOLE;

	expect(a.seat.island).toBe(c.seat.island);
	expect(made.acrossBridge(from, to)).toEqual([{ x: from.x, y: back }, { x: to.x, y: back }, to]);
});

test('between rows, a walk crosses by the aft wall or forward past the islands between, whichever is the shorter way', () => {
	const made = twoRows();
	const { islands } = made.bridge;
	const rows = [...new Set(islands.map(({ y }) => y))].sort((a, b) => a - b);
	const inRow = y => islands.filter(island => island.y === y).sort((a, b) => a.x - b.x);
	const seatOf = island => made.placeOf(made.workers.get(island.seats[0].key));
	const [aftmost, foremost] = [0, -1].map(end => rows.map(y => inRow(y).at(end)));
	const aft = Math.min(...islands.map(({ x }) => x));
	const fore = Math.max(...islands.map(({ x, w }) => x + w));

	expect(rows).toHaveLength(2);
	expect(inRow(rows[0])).toHaveLength(2);

	// Between the two islands by the aft wall: along it; between the two forward ones: round the forward side
	const byWall = made.acrossBridge(seatOf(aftmost[0]), seatOf(aftmost[1]));
	const byFore = made.acrossBridge(seatOf(foremost[0]), seatOf(foremost[1]));

	expect(Math.min(...byWall.map(({ x }) => x))).toBeLessThan(aft);
	expect(Math.max(...byWall.map(({ x }) => x))).toBeLessThan(fore);
	expect(Math.max(...byFore.map(({ x }) => x))).toBeGreaterThan(fore);
	expect(Math.min(...byFore.map(({ x }) => x))).toBeGreaterThan(aft);
});

test('the transporter is a room to press: looked at, its own flyout naming the other ships to beam to', async () => {
	const { ROOMS, flyoutOf } = await import('./flyout');
	const made = new Ship();

	made.resize(800, 600);
	made.fleet = [{ key: 'account:b', name: 'vps', needs: 0, news: 1, working: 0 }];
	made.update([answer('here', [session({ id: 'a', project: 'paude' })], { projects: ['paude'] })]);
	run(made, 1);

	const room = made.layout.transporter;

	expect(ROOMS.transporter).toBeDefined();
	expect(made.roomOf('transporter')).toBe(room);
	made.look('transporter');
	expect(made.looking).toBe('transporter');

	const flyout = flyoutOf({ kind: 'transporter', room }, made);

	expect(flyout.title).toBe('Transporter');
	expect(flyout.rows.map(([name]) => name)).toEqual(['vps']);
});

test("through the transporter: onto its pad and away from one ship, in on the other's pad and off to their place", async () => {
	const me = { key: 'me', name: 'chase', role: 'owner', sessions: [] };
	const from = new Ship();
	const to = new Ship();

	for (const ship of [from, to]) ship.resize(800, 600);
	from.fleet = [{ key: 'b', name: 'vps' }];
	to.fleet = [{ key: 'a', name: 'dellbook' }];
	from.update([{ ...answer('here', [session({ id: 'a', project: 'paude' })], { projects: ['paude'] }), people: [me] }]);
	to.update([answer('https://vps', [session({ id: 'v', project: 'site' })], { projects: ['site'] })]);
	run(from, 8);
	run(to, 8);

	let gone = false;

	expect(from.beamOut('me', () => (gone = true))).toBe(true);
	for (let second = 0; second < 10 && !gone; second++) run(from, 1);
	expect(gone).toBe(true);
	expect(from.walkers.has('me')).toBe(false);

	to.beamIn(me);

	const arrived = to.walkers.get('me');
	const pad = clonerAt(to.layout.transporter);

	expect([arrived.x, arrived.y]).toEqual([pad.x, pad.y]);
	run(to, 1);
	expect(arrived.path.length).toBeGreaterThan(0);
	run(to, 30);
	expect(arrived.room).toBe(to.bridge);
});

test('one held up on the way to the transporter beams out from wherever they got to', () => {
	const me = { key: 'me', name: 'chase', role: 'owner', sessions: [] };
	const ship = shipWith([
		{ ...answer('here', [session({ id: 'a', project: 'paude' })], { projects: ['paude'] }), people: [me] },
	]);
	let gone = false;

	ship.fleet = [{ key: 'b', name: 'vps' }];
	ship.update([{ ...answer('here', [session({ id: 'a', project: 'paude' })], { projects: ['paude'] }), people: [me] }]);
	run(ship, 8);
	expect(ship.beamOut('me', () => (gone = true))).toBe(true);

	// A detour that would take far longer than it's given
	const walker = ship.walkers.get('me');

	walker.path = Array.from({ length: 200 }, (_, index) => ({ x: walker.x + (index % 2 ? 4 : -4), y: walker.y }));
	run(ship, 2);
	expect(gone).toBe(false);
	run(ship, 4);
	expect(gone).toBe(true);
	expect(ship.walkers.has('me')).toBe(false);
});

test('looking at the transporter, whoever looks walks to beside its pad, onto the middle of it only once beaming away; looking off, they walk back', async () => {
	const me = { key: 'me', name: 'chase', role: 'owner', sessions: [] };
	const looks = [
		{ ...answer('here', [session({ id: 'a', project: 'paude' })], { projects: ['paude'] }), people: [me] },
	];
	const ship = shipWith(looks);
	let gone = false;

	ship.fleet = [{ key: 'b', name: 'vps' }];
	ship.update(looks);
	ship.viewer = 'me';
	run(ship, 8);
	ship.look('transporter');
	run(ship, 4);

	const walker = ship.walkers.get('me');
	const pad = clonerAt(ship.layout.transporter);

	// Beside it, not on it; on its middle once going
	expect(Math.hypot(walker.x - pad.x, walker.y - pad.y)).toBeGreaterThan(0.5);
	expect(Math.hypot(walker.x - pad.x, walker.y - pad.y)).toBeLessThan(1.5);
	ship.beamOut('me', () => (gone = true));
	run(ship, 0.3);
	expect(gone).toBe(false);
	run(ship, 2);
	expect(gone).toBe(true);
	expect(Math.hypot(walker.x - pad.x, walker.y - pad.y)).toBeLessThan(0.05);

	const stays = shipWith(looks);

	stays.fleet = ship.fleet;
	stays.update(looks);
	stays.viewer = 'me';
	run(stays, 8);
	stays.look('transporter');
	run(stays, 4);
	stays.look('all');
	run(stays, 8);
	expect(stays.walkers.get('me').room).toBe(stays.bridge);
});

test("a stream's straight run across the lounge bends round it, by its far side when it's against the hull; one clear of it is left be", () => {
	const made = shipWith([lounger(0)]);
	const { lounge } = made;
	const [from, past] = [made.art(lounge), made.art({ x: lounge.x + lounge.w, y: lounge.y + lounge.d })];
	const nearTop = Math.round(from.y + (past.y - from.y) / 4);
	const across = [
		{ x: from.x - 20, y: nearTop },
		{ x: past.x + 20, y: nearTop },
	];
	const bent = made.clearOfLounge(across);
	const inside = point => point.x > from.x && point.x < past.x && point.y > from.y && point.y < past.y;

	expect(bent.length).toBeGreaterThan(2);
	expect(bent.some(inside)).toBe(false);
	// By the top, the nearer edge
	expect(Math.min(...bent.map(({ y }) => y))).toBeLessThan(from.y);
	// Nearer its bottom, still by the top while the lounge stands against the hull
	const nearBottom = Math.round(past.y - (past.y - from.y) / 4);
	const low = made.clearOfLounge([
		{ x: from.x - 20, y: nearBottom },
		{ x: past.x + 20, y: nearBottom },
	]);

	expect(lounge.y + lounge.d).toBeCloseTo(made.layout.building.bottom, 5);
	expect(Math.max(...low.map(({ y }) => y))).toBe(nearBottom);
	for (const [index, point] of bent.slice(1).entries())
		expect(point.x === bent[index].x || point.y === bent[index].y).toBe(true);

	const clear = [
		{ x: from.x - 20, y: from.y - 30 },
		{ x: past.x + 20, y: from.y - 30 },
	];

	expect(made.clearOfLounge(clear)).toEqual(clear);
});

test('several bent round the lounge run side by side, each its own way out from it, never on one line', () => {
	const made = shipWith([lounger(0)]);
	const { lounge } = made;
	const [from, past] = [made.art(lounge), made.art({ x: lounge.x + lounge.w, y: lounge.y + lounge.d })];
	const y = Math.round((from.y + past.y) / 2);
	const run = [
		{ x: from.x - 20, y },
		{ x: past.x + 20, y },
	];
	const tops = [0, 6, 12].map(apart => Math.min(...made.clearOfLounge(run, apart).map(point => point.y)));

	expect(new Set(tops).size).toBe(3);
	expect(tops[1] - tops[0]).toBe(-6);
	expect(tops[2] - tops[1]).toBe(-6);
});

test('a lounge clear of the hull lets a run nearer its near side go round by that side', () => {
	const made = shipWith([lounger(0)]);
	const { lounge } = made;

	made.layout = { ...made.layout, building: { ...made.layout.building, bottom: made.layout.building.bottom + 5 } };

	const [from, past] = [made.art(lounge), made.art({ x: lounge.x + lounge.w, y: lounge.y + lounge.d })];
	const y = Math.round(past.y - (past.y - from.y) / 4);
	const bent = made.clearOfLounge([
		{ x: from.x - 20, y },
		{ x: past.x + 20, y },
	]);

	expect(Math.max(...bent.map(point => point.y))).toBeGreaterThan(past.y);
	expect(Math.min(...bent.map(point => point.y))).toBe(y);
});

test('a session resting on a couch, selected, is bracketed on the couch and at the terminal it left', () => {
	const made = shipWith([
		answer('here', [session(), session({ id: 'b', status: 'stopped' })], { projects: ['paude'] }),
	]);
	const worker = made.workers.get('here/b');

	run(made, 4);
	expect(worker.lounging).toBe(true);
	expect(worker.homeSeat).toBeTruthy();
	made.selected = 'worker:here/b';

	const boxes = made.selectionBoxes();
	const terminal = made.art({ x: worker.homeSeat.x, y: worker.homeSeat.y + 0.2 });

	const couch = made.art(made.placeOf(worker));
	const around =
		point =>
		({ from, to }) =>
			from.x < point.x && to.x > point.x && from.y < point.y && to.y >= point.y;

	expect(boxes).toHaveLength(2);
	expect(boxes.filter(around(terminal))).toHaveLength(1);
	expect(boxes.filter(around(couch))).toHaveLength(1);
	expect(boxes.find(around(terminal))).not.toBe(boxes.find(around(couch)));
});

test("a conduit bent round the lounge turns up its riser from the lounge's edge, not back down to where it started", () => {
	const made = shipWith([lounger(0)]);
	const { lounge } = made;
	const [from, past] = [made.art(lounge), made.art({ x: lounge.x + lounge.w, y: lounge.y + lounge.d })];
	const y = Math.round((from.y + past.y) / 2);
	const riser = from.x - 30;
	const bent = made.clearOfLounge([
		{ x: past.x + 20, y },
		{ x: riser, y },
		{ x: riser, y: from.y - 80 },
	]);
	const up = bent.findIndex(point => point.y < y);

	// Once it's left its island's height it never comes back to it, and it climbs its riser from above the lounge
	expect(bent.slice(up).some(point => point.y === y)).toBe(false);
	expect(bent.filter(point => point.x === riser).every(point => point.y < from.y)).toBe(true);
});

test('walking about the bridge, off it to the spine, or onto it from where new sessions are made, goes round the lounge', () => {
	const made = shipWith([
		answer(
			'here',
			[session(), ...Array.from({ length: 8 }, (_, index) => session({ id: `s${index}`, status: 'stopped' }))],
			{ projects: ['paude'] },
		),
	]);

	run(made, 4);

	const { lounge } = made;
	const middle = lounge.y + lounge.d / 2;
	const from = { x: made.bridge.x + 0.6, y: lounge.y - 0.5 };
	const to = { x: lounge.x + lounge.w + 1.5, y: middle };
	const there = [from, ...made.acrossBridge(from, to)];
	const back = [to, ...made.acrossBridge(to, from)];
	const { hold } = made.layout;
	const out = [to, ...made.route(to, made.bridge, holdSpotAt(hold, 0), hold)];
	const leaving = [to, ...made.route(to, made.bridge, made.airlock, made.bridge)];
	const tour = [to, ...made.walkTo({ ...to, room: made.bridge }, from, made.bridge)];
	const { materializer } = made.layout;
	const fresh = { x: materializer.x + materializer.w / 2, y: materializer.y + 1 };
	const arriving = [fresh, ...made.route(fresh, materializer, to, made.bridge)];
	const inside = { left: lounge.x, right: lounge.x + lounge.w, top: lounge.y + 0.3, bottom: lounge.y + lounge.d };

	for (const path of [there, back, out, leaving, tour, arriving])
		for (const [index, point] of path.slice(1).entries()) {
			const at = path[index];
			const crosses =
				Math.max(at.x, point.x) > inside.left &&
				Math.min(at.x, point.x) < inside.right &&
				Math.max(at.y, point.y) > inside.top &&
				Math.min(at.y, point.y) < inside.bottom;

			expect(crosses).toBe(false);
		}
	expect(there.at(-1)).toEqual(to);
	expect(back.at(-1)).toEqual(from);
});

test('a stream leaves its engine-bay unit straight across into its lane of the trunk, and along it to the hall', () => {
	const made = shipWith([
		{ ...answer('here', [session({ status: 'working', tool: 'Bash' })], { projects: ['paude'] }), tools: ['Bash'] },
	]);

	run(made, 2);

	const worker = made.workers.get('here/a');
	const room = made.layout.systems['here/reactor'];
	const lanes = ['library', 'forge', 'reactor', 'dish', 'tower', 'outpost'];
	const routed = made.streamRoute(worker, room, lanes, 'reactor', null);
	const [outlet, across, down] = routed.at(-1).track.legs.map(({ from }) => from);
	const lane = made.trunkLane(lanes.indexOf('reactor'));

	expect(outlet).toEqual(made.throughSystem(room).outlet);
	// In the gap beside the units, not over any of them
	for (const unit of Object.values(made.layout.systems))
		expect(lane).toBeGreaterThan(made.art({ x: unit.x + unit.w, y: 0 }).x);
	expect([across.x, across.y]).toEqual([lane, outlet.y]);
	// Along its lane to the hall, up or down as the hall lies
	expect(down.x).toBe(lane);
	expect(routed.at(-1).track.legs[2].to.x).toBe(lane);
	expect(routed.at(-1).track.legs[2].to.y).not.toBe(outlet.y);
});

test('a deleted session stands whole while the emitter comes down over it, crumbles under its beam, and the emitter goes back up after', () => {
	const made = shipWith([answer('here', [session(), session({ id: 'b' })], { projects: ['paude'] })]);

	run(made, 2);
	made.vaporize('here/b');
	expect(made.zaps).toMatchObject([{ key: 'here/b' }]);
	// Coming down: nothing of the grey has gone yet
	run(made, 0.4);
	expect(made.workers.get('here/b').opacity).toBe(1);
	// Firing: it crumbles
	run(made, 1);
	expect(made.workers.get('here/b').opacity).toBeLessThan(1);
	expect(made.workers.get('here/b').opacity).toBeGreaterThan(0);
	// Crumbled: nothing of the grey is left but its heap, the emitter still on its way up; it holds its seat, so the island
	// isn't laid again under the heap
	run(made, 1);
	expect(made.workers.get('here/b').ashedAt).toBeDefined();
	expect(made.dust).toHaveLength(1);
	expect(made.zaps).toHaveLength(1);
	expect(made.bays.find(({ name }) => name === 'paude').sessions).toContain('here/b');
	expect(made.sessions.map(({ key }) => key)).toEqual(['here/a']);
	run(made, 0.5);
	expect(made.zaps).toHaveLength(0);
	// The heap sucked up, its terminal sinks into the console, and only then does the seat go
	run(made, 4.5);
	const sinking = made.workers.get('here/b');

	expect(made.seatRise(sinking)).toBeLessThan(2);
	expect(made.seatRise(sinking)).toBeGreaterThan(1);
	run(made, 1);
	expect(made.workers.has('here/b')).toBe(false);
	made.update([answer('here', [session()], { projects: ['paude'] })]);
	expect(made.bays.find(({ name }) => name === 'paude').sessions).toEqual(['here/a']);
});

test('a fabled session deleted from here sends its monitor walking to the airlock, where a craft of its own takes it off, while its grey crumbles alone', () => {
	const made = shipWith([
		answer('here', [session(), session({ id: 'b', keeping: 'fabled' })], { projects: ['paude'] }),
	]);

	run(made, 10);
	const worker = made.workers.get('here/b');

	expect(made.watcherStands(worker)).toBe(true);
	made.vaporize('here/b');
	expect(made.zaps.map(({ key }) => key)).toEqual(['here/b']);
	expect(worker.watcher).toBeUndefined();
	const [gone] = made.monitorsGone;

	expect(gone.key).toBe('here/b');
	expect(gone.watcher.path.at(-1)).toEqual(made.airlock);
	expect(made.shuttles.find(({ key }) => key === 'here/b|monitor')).toMatchObject({ kind: 'out', craft: 'monitor' });
	run(made, 2.5);
	expect(made.dust).toHaveLength(1);
	run(made, 90);
	expect(made.monitorsGone).toEqual([]);
	expect(made.shuttles).toEqual([]);
	expect(made.workers.has('here/b')).toBe(false);
});

test('a session deleted from here crumbles to a heap of dust, which stays a while after it is gone', () => {
	const made = shipWith([answer('here', [session(), session({ id: 'b' })], { projects: ['paude'] })]);

	run(made, 2);
	made.vaporize('here/b');
	run(made, 0.5);
	expect(made.workers.get('here/b')?.leaving).toBe(true);
	// Still listed by its paude a moment longer, it keeps crumbling
	made.update([answer('here', [session(), session({ id: 'b' })], { projects: ['paude'] })]);
	expect(made.workers.get('here/b').leaving).toBe(true);
	run(made, 2);
	expect(made.workers.get('here/b').ashedAt).toBeDefined();
	expect(made.dust).toHaveLength(1);
	run(made, 7);
	expect(made.dust).toHaveLength(0);
	expect(made.workers.has('here/b')).toBe(false);
});

test("however many projects have islands, their conduits' risers stand side by side on the bridge's aft wall, apart, before the lounge", () => {
	for (const count of [1, 5, 14, 30])
		for (const busy of [0, 4]) {
			const bays = Array.from({ length: count }, (_, index) => ({
				name: `p${index}`,
				hue: index * 12,
				sessions: Array.from({ length: 1 + busy }, (_, seat) => `p${index}-${seat}`),
			}));
			const { bridge, lounge } = layOut({
				bays: bays.map(bay => ({ ...bay, seated: bay.sessions.length })),
				lounge: { count: 8, sessions: Array.from({ length: 8 }, (_, index) => `s${index}`) },
			});
			const [wall, stern] = [Math.round(bridge.x * UNIT.x), Math.round(lounge.x * UNIT.x)];
			// As thick as each gets with all its sessions at their desks
			const weights = bays.map(({ sessions }) => Math.min(5, 1 + sessions.length));
			const risers = risersFor(wall, stern, weights);
			const edges = risers.map((x, index) => {
				const from = x - Math.floor(weights[index] / 2) - 1;

				return [from, from + weights[index] + 1];
			});

			expect(edges[0][0]).toBeGreaterThan(wall);
			// None touching the next, outlines and all, and the last clear of the lounge
			for (const [index, [, right]] of edges.slice(0, -1).entries()) expect(right).toBeLessThan(edges[index + 1][0]);
			expect(edges.at(-1)[1]).toBeLessThan(stern);
		}
	expect(risersFor(0, null, [1, 1])).toEqual([5, 10]);
});

test('islands sharing a row each have their cable along it at its own height, none on another, the further ones under the nearer and none up over an island', () => {
	for (const count of [5, 30]) {
		const bays = Array.from({ length: count }, (_, index) => ({
			name: `p${index}`,
			hue: index * 12,
			sessions: Array.from({ length: 4 }, (_, seat) => `p${index}-${seat}`),
		}));
		const { bridge } = layOut({ bays: bays.map(bay => ({ ...bay, seated: bay.sessions.length })) });
		// Every cable as thick as it gets
		const ends = bridge.islands.map(island => ({
			x: Math.round((island.x + 0.15) * UNIT.x),
			y: Math.round((island.y + 0.2) * UNIT.y),
			weight: 5,
		}));
		const runs = runsFor(ends);
		const band = index => [runs[index] - 3, runs[index] + 3];
		const rows = [...new Set(ends.map(({ y }) => y))].sort((a, b) => a - b);

		for (const [index, end] of ends.entries())
			for (const [other, also] of ends.entries())
				if (other > index && also.y === end.y)
					expect(band(index)[1] < band(other)[0] || band(other)[1] < band(index)[0]).toBe(true);
		// The consoles stand from their foot up: no run goes above it, and the further along the row, the lower
		for (const [index, end] of ends.entries()) {
			expect(runs[index]).toBeGreaterThanOrEqual(end.y);
			for (const [other, also] of ends.entries())
				if (also.y === end.y && also.x < end.x) expect(runs[other]).toBeLessThan(runs[index]);
		}
		expect(rows.length).toBeGreaterThan(0);
	}
});

test('runs bent round the lounge with their risers apart stay apart over it and down its sides', () => {
	const box = { left: 0, right: 100, top: 0, bottom: 50 };
	const run = [
		{ x: 140, y: 15 },
		{ x: -30, y: 15 },
	];
	const [near, far] = [bendAround(run, box, { apart: 0 }), bendAround(run, box, { apart: 7 })];
	const sides = path => path.filter(({ y }) => y !== 15).map(({ x }) => x);

	expect(Math.min(...far.map(({ y }) => y))).toBe(Math.min(...near.map(({ y }) => y)) - 7);
	expect(Math.max(...sides(far))).toBe(Math.max(...sides(near)) + 7);
	expect(Math.min(...sides(far))).toBe(Math.min(...sides(near)) - 7);
});

test("the order of the conduits' risers is worked out again when a cable's thickness changes, and crosses none it needn't", () => {
	const ship = new Ship();
	const route = (name, weight, y) => ({
		bay: { name },
		weight,
		tray: 100 + y,
		out: { x: -40, y: 100 + y },
		exit: { x: -40, y: 110 + y },
		plates: [{ at: { x: 200, y } }],
	});
	const routes = [route('a', 1, 20), route('b', 1, 40), route('c', 1, 60)];

	ship.riserOrder(routes, 0);

	const first = ship.risers.key;

	// The same routes, one busier: its riser's place and its neighbours' move, so the order is weighed again
	ship.riserOrder([route('a', 1, 20), route('b', 5, 40), route('c', 1, 60)], 0);
	expect(ship.risers.key).not.toBe(first);
	// Nested so none of their runs crosses another's riser: the topmost island's riser nearest the wall
	expect(ship.riserOrder(routes, 0).map(({ bay }) => bay.name)).toEqual(['a', 'b', 'c']);
});

test("the risers' order is weighed at the places their thicknesses put them, not as if evenly spaced", () => {
	const route = (name, weight, tray, out, plate) => ({
		bay: { name },
		weight,
		tray,
		out: { x: out, y: tray },
		exit: { x: -10, y: tray + 5 },
		plates: [{ at: plate }],
	});
	// Evenly spaced, r0 r2 r1 looks best; where their thicknesses really put them, r2 r0 r1 crosses once and touches none
	const routes = [
		route('r0', 4, 26, -22, { x: 23, y: 56 }),
		route('r1', 2, 66, -16, { x: 44, y: 8 }),
		route('r2', 5, 6, -33, { x: 18, y: 56 }),
	];

	expect(new Ship().riserOrder(routes, 0).map(({ bay }) => bay.name)).toEqual(['r2', 'r0', 'r1']);
});

test("the risers' order keeps a cable coming along the hall from lying along another's run to its island", () => {
	const route = (name, tray, out, plate) => ({
		bay: { name },
		weight: 1,
		tray,
		out: { x: out, y: tray },
		exit: { x: out, y: tray + 5 },
		plates: [{ at: plate, run: plate.y }],
	});
	// The hall brings ender-launcher in at the height paude's island is reached at: ender-launcher's riser nearer the
	// wall, so its run out along the hall starts short of paude's
	const routes = [route('paude', 15, -32, { x: 73, y: 7 }), route('ender-launcher', 7, -39, { x: 73, y: -27 })];

	expect(new Ship().riserOrder(routes, 0).map(({ bay }) => bay.name)).toEqual(['ender-launcher', 'paude']);
});

test("each other ship has an unmanned terminal along the bridge's near wall, clear of the lounge and the islands", () => {
	const made = new Ship();

	made.resize(800, 600);
	made.fleet = [
		{ key: 'b', name: 'vps', needs: 2 },
		{ key: 'c', name: 'workbook', news: 1 },
		{ key: 'd', name: 'thinkpad' },
	];
	made.update([
		answer(
			'here',
			[session(), ...Array.from({ length: 6 }, (_, index) => session({ id: `s${index}`, status: 'stopped' }))],
			{
				projects: ['paude'],
			},
		),
	]);
	run(made, 2);

	const spots = made.fleetSpots();
	const { lounge, bridge } = made;

	expect(spots.map(({ ship }) => ship.key)).toEqual(['b', 'c', 'd']);
	for (const { x, y } of spots) {
		expect(y).toBeGreaterThan(bridge.y + bridge.d - 1);
		expect(x - 0.75 >= lounge.x + lounge.w || x + 0.75 <= lounge.x).toBe(true);
		for (const island of bridge.islands)
			if (island.y > y - 2.6) expect(x - 0.75 >= island.x + island.w || x + 0.75 <= island.x).toBe(true);
	}
	for (const [index, { x }] of spots.slice(1).entries())
		expect(Math.abs(spots[index].x - x)).toBeGreaterThanOrEqual(1.8 - 1e-9);
});

test("a row's conduits fit the aisle under it, clear of the next row's screens, however many islands share it", () => {
	for (const count of [3, 8, 16, 30, 50]) {
		const bays = Array.from({ length: count }, (_, index) => ({
			name: `p${index}`,
			hue: index * 12,
			sessions: Array.from({ length: 1 + (index % 5) }, (_, seat) => `p${index}-${seat}`),
		}));
		const { bridge } = layOut({ bays: bays.map(bay => ({ ...bay, seated: bay.sessions.length })) });
		const pitch = bridge.pitch;

		expect(pitch).toBeGreaterThanOrEqual(rowPitch(bridge.islands) - 1e-9);

		// Every cable as thick as its island's seats could make it, laid as the conduits are
		const ends = bridge.islands.map(island => ({
			x: (island.x + 0.15) * UNIT.x,
			y: (island.y + 0.2) * UNIT.y,
			weight: cableWeight(island.keys.length),
		}));
		const runs = runsFor(ends);

		for (const [index, end] of ends.entries()) {
			const below = ends.filter(other => other.y > end.y);

			if (!below.length) continue;

			const screens = Math.min(...below.map(other => other.y)) - SCREEN_RISE;

			expect(runs[index] + Math.ceil(end.weight / 2) + 1).toBeLessThan(screens);
		}
	}
});

test('the lounge, selected, is bracketed round it', () => {
	const made = shipWith([
		answer('here', [session(), session({ id: 'b', status: 'stopped' })], { projects: ['paude'] }),
	]);

	run(made, 4);
	made.selected = 'room:lounge';

	const [box] = made.selectionBoxes();
	const { lounge } = made;

	expect(box.from).toEqual(made.art(lounge));
	expect(box.to).toEqual(made.art({ x: lounge.x + lounge.w, y: lounge.y + lounge.d }));
});

test('a droid passing behind an island or the couches is hidden by them, and drawn over the floor and its cables anywhere else', () => {
	const made = shipWith([
		answer('here', [session(), session({ id: 'b', status: 'stopped' })], { projects: ['paude'] }),
	]);

	run(made, 4);

	const furniture = made.furniture();
	const [island] = made.bridge.islands;
	const { lounge } = made;

	// Just behind an island's console, among its screens; just behind a couch
	expect(made.behindFurniture({ x: island.x + island.w / 2, y: island.y - 0.2 }, furniture)).toBe(true);
	expect(made.behindFurniture({ x: lounge.x + lounge.w / 2, y: lounge.y + lounge.d / 2 }, furniture)).toBe(true);
	// In front of the island, in the aisle; out on the open floor
	expect(made.behindFurniture({ x: island.x + island.w / 2, y: island.y + 1 }, furniture)).toBe(false);
	expect(made.behindFurniture({ x: made.bridge.x + 0.3, y: made.bridge.y + made.bridge.d - 0.1 }, furniture)).toBe(
		false,
	);
});

test('a project seating more than an island holds is split into as few islands as hold it, its seats shared out evenly', () => {
	const plain = () => 1.5;
	const keys = count => Array.from({ length: count }, (_, index) => `k${index}`);

	expect(splitSeats(keys(6), plain).map(run => run.length)).toEqual([6]);
	expect(splitSeats(keys(7), plain).map(run => run.length)).toEqual([4, 3]);
	for (const count of [13, 14, 19, 25]) {
		const sizes = splitSeats(keys(count), plain).map(run => run.length);

		expect(sizes).toHaveLength(Math.ceil(count / 6));
		expect(Math.max(...sizes)).toBeLessThanOrEqual(6);
		expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);
	}
	expect(splitSeats([], plain)).toEqual([[]]);
	expect(splitSeats(['only'], plain)).toEqual([['only']]);
	// Wider seats (subagents' terminals beside them) split sooner
	expect(splitSeats(keys(6), key => (key === 'k0' ? 4 : 1.5)).length).toBe(2);
	// Every seat once, in order
	expect(splitSeats(keys(14), plain).flat()).toEqual(keys(14));

	const bays = [
		{ name: 'big', hue: 10, sessions: keys(14) },
		{ name: 'small', hue: 50, sessions: ['s0'] },
	];
	const { bridge } = layOut({ bays: bays.map(bay => ({ ...bay, seated: bay.sessions.length })) });
	const big = bridge.islands.filter(({ name }) => name === 'big');

	expect(big).toHaveLength(3);
	expect(big.flatMap(({ keys: seated }) => seated)).toEqual(keys(14));
	expect(Object.keys(bridge.seats)).toHaveLength(15);
});

test("the crew's droids wait in line in engineering's trunk and leave up it, clear of its units", () => {
	const made = shipWith([answer('here', [session()], { projects: ['paude'] })]);

	run(made, 2);

	const engineering = made.layout.engineering;
	const units = Object.values(made.layout.systems ?? {});
	const clear = ({ x }) => units.every(unit => x > unit.x + unit.w);

	for (const index of [0, 1, 2, 3]) {
		const berth = made.berthOf(index);

		expect(clear(berth)).toBe(true);
		expect(berth.y).toBeLessThan(engineering.y + engineering.d);
		expect(made.route(berth, engineering, { x: made.bridge.x + 1, y: made.bridge.y + 1 }, made.bridge)[0].x).toBe(
			engineering.aisle,
		);
	}
	expect(new Set([0, 1, 2, 3].map(index => made.berthOf(index).y)).size).toBe(4);
});

test('several sessions picked together are each bracketed', () => {
	const made = shipWith([answer('here', [session(), session({ id: 'b' })], { projects: ['paude'] })]);

	run(made, 4);
	made.selected = 'group:here/a|here/b';

	const boxes = made.selectionBoxes();
	const at = key => made.art({ x: made.workers.get(key).seat.x, y: made.workers.get(key).seat.y + 0.2 });
	const around =
		point =>
		({ from, to }) =>
			from.x < point.x && to.x > point.x && from.y < point.y && to.y >= point.y;

	expect(boxes).toHaveLength(2);
	expect(boxes.filter(around(at('here/a')))).toHaveLength(1);
	expect(boxes.filter(around(at('here/b')))).toHaveLength(1);
});

test('one deleted on a couch keeps its place till its dust has gone, the others staying where they sit, and only then are the couches laid again', () => {
	const stopped = id => session({ id, status: 'stopped', tool: null, coldAgo: 60_000, stoppedAgo: 60_000 });
	const all = [stopped('a'), stopped('b'), stopped('c')];
	const made = shipWith([answer('here', all, { projects: ['paude'] })]);

	run(made, 4);

	// Where on the couches, wherever the lounge itself stands
	const seatOf = key => {
		const place = made.placeOf(made.workers.get(key));

		return { x: Math.round((place.x - made.lounge.x) * 100), y: Math.round((place.y - made.lounge.y) * 100) };
	};
	const [a, c] = [seatOf('here/a'), seatOf('here/c')];

	made.vaporize('here/b');
	run(made, 3);
	made.update([answer('here', [stopped('a'), stopped('c')], { projects: ['paude'] })]);
	expect(made.workers.get('here/b').ashedAt).toBeDefined();
	expect(made.layout.rooms.find(({ kind }) => kind === 'lounge').count).toBe(3);
	expect(seatOf('here/a')).toEqual(a);
	expect(seatOf('here/c')).toEqual(c);

	// Its dust gone, the couch it freed is zapped, and the lounge keeps its size till that ash is gone too
	run(made, 7);
	made.update([answer('here', [stopped('a'), stopped('c')], { projects: ['paude'] })]);
	expect(made.couchZaps).toMatchObject([{ index: 1 }]);
	expect(made.layout.rooms.find(({ kind }) => kind === 'lounge').count).toBe(3);
	run(made, 9);
	made.update([answer('here', [stopped('a'), stopped('c')], { projects: ['paude'] })]);
	expect(made.layout.rooms.find(({ kind }) => kind === 'lounge').count).toBe(2);
});

test('a sealed ship comes in out of warp once there is one to show, and opens only once it has arrived, however soon it is asked to', () => {
	const made = new Ship();

	made.resize(1600, 900);
	made.sealed = true;
	// Nothing to show yet: not on its way, and asked to open, it waits
	run(made, 1);
	made.open();
	expect(made.entering()).toBe(0);
	expect(made.coverOf()).toBe(1);

	made.update([answer('here', [session()], { projects: ['paude'] })]);
	run(made, 1);
	expect(made.entering()).toBeGreaterThan(0);
	expect(made.entering()).toBeLessThan(1);
	expect(made.entryShift()).toBeLessThan(0);
	expect(made.coverOf()).toBe(1);

	// Arrived: the open asked for before comes, the plating fading, the ship at its place
	run(made, 3);
	expect(made.arrived()).toBe(true);
	expect(made.sealed).toBe(false);
	expect(made.entryShift()).toBeCloseTo(0);
	run(made, 1);
	expect(made.coverOf()).toBe(0);
});

test("a ship that's never sealed never comes in, nor is covered", () => {
	const made = shipWith([answer('here', [session()], { projects: ['paude'] })]);

	expect(made.entering()).toBe(1);
	expect(made.entryShift()).toBeCloseTo(0);
	expect(made.coverOf()).toBe(0);
	made.open();
	expect(made.coverOf()).toBe(0);
});

test("an island gaining a seat grows to its new length over a moment rather than jumping, and a new project's island rises out of the floor, its terminals after", () => {
	const projects = ['paude', 'other', 'third'];
	const made = shipWith([answer('here', [session(), session({ id: 'c', project: 'other' })], { projects })]);

	run(made, 1);

	const was = made.islandsShown.get('paude#0').w;

	made.update([
		answer(
			'here',
			[session(), session({ id: 'b' }), session({ id: 'c', project: 'other' }), session({ id: 'd', project: 'third' })],
			{ projects },
		),
	]);

	const goal = made.bridge.islands.find(({ name }) => name === 'paude').w;

	expect(goal).toBeGreaterThan(was);
	run(made, 0.05);
	expect(made.islandsShown.get('paude#0').w).toBeGreaterThan(was);
	expect(made.islandsShown.get('paude#0').w).toBeLessThan(goal);
	// The new one at its whole length, rising: its console part way up, its terminals not yet
	expect(made.islandRise('third#0')).toBeGreaterThan(0);
	expect(made.islandRise('third#0')).toBeLessThan(1);
	expect(made.islandRise('paude#0')).toBe(2);
	run(made, 2);
	expect(made.islandsShown.get('paude#0').w).toBeCloseTo(goal);
	expect(made.islandRise('third#0')).toBe(2);
});

test('islands keep their rows as sessions come, go and grow: a new one goes into whichever row reaches least far', () => {
	const projects = ['a', 'b', 'c', 'd', 'e', 'f'];
	const at = list => [
		answer(
			'here',
			list.map(([id, project]) => session({ id, project })),
			{ projects },
		),
	];
	const first = [
		['1', 'a'],
		['2', 'b'],
		['3', 'c'],
		['4', 'd'],
		['5', 'e'],
	];
	const made = shipWith(at(first));
	const rows = () => Object.fromEntries(made.bridge.islands.map(({ name, row }) => [name, row]));
	const before = rows();

	// a grows by two sessions, f comes aboard: the others stay where they were
	made.update(at([...first, ['6', 'a'], ['7', 'a'], ['8', 'f']]));

	const after = rows();

	for (const name of ['a', 'b', 'c', 'd', 'e']) expect(after[name]).toBe(before[name]);
	expect(after.f).toBeDefined();

	// One leaves and comes back: back in a row, the rest unmoved
	run(made, 3);
	made.update(at(first.filter(([, project]) => project !== 'c')));
	run(made, 3);
	made.update(at(first.filter(([, project]) => project !== 'c')));
	for (const name of ['a', 'b', 'd', 'e']) expect(rows()[name]).toBe(before[name]);
});

test("a project's machine moved along its deck by one before it growing is drawn gliding there from where it was", () => {
	const at = files => [
		answer('here', [session(), session({ id: 'b', project: 'b' }), session({ id: 'c', project: 'c' })], {
			projects: [
				{ name: 'paude', hue: 10, character: { files } },
				{ name: 'b', hue: 90, character: { files: 10 } },
				{ name: 'c', hue: 180, character: { files: 10 } },
			],
		}),
	];
	const made = shipWith(at(2));

	run(made, 1);

	const xOf = name => made.layout.bays.find(bay => bay.name === name).x;
	const moved = ['b', 'c'].map(name => [name, xOf(name)]);

	made.update(at(100_000));

	const shifted = moved.filter(([name, x]) => Math.abs(xOf(name) - x) > 0.01);

	expect(shifted.length).toBeGreaterThan(0);
	for (const [name, x] of shifted) {
		const bay = made.layout.bays.find(other => other.name === name);

		run(made, 0.02);
		expect(made.bayShift(bay)).not.toBe(0);
		expect(Math.sign(made.bayShift(bay))).toBe(Math.sign(x - bay.x));
	}
	run(made, 2);
	for (const [name] of shifted) expect(made.bayShift(made.layout.bays.find(bay => bay.name === name))).toBe(0);
});

test('a grey on its feet walks over the conduits it crosses, and behind what stands in front of it', () => {
	const made = shipWith([answer('here', [session(), session({ id: 'b' })], { projects: ['paude'] })]);

	run(made, 4);

	const worker = made.workers.get('here/a');
	const [island] = made.bridge.islands;
	const layerAt = point => {
		Object.assign(worker, point, { path: [{ x: point.x + 1, y: point.y }] });

		return made.workerParts(null, worker)[0].y;
	};

	// Out on the floor by the aft wall, over the conduits; just behind an island's console, sorted in behind it
	expect(layerAt({ x: made.bridge.x + 0.3, y: made.bridge.y + made.bridge.d - 0.2 })).toBeGreaterThan(1e5);
	expect(layerAt({ x: island.x + island.w / 2, y: island.y - 0.2 })).toBeLessThan(1e5);
});

test("the hold's crane wanders its rail, and a commit made while it's mid-way brings it over that pod at once", () => {
	const at = unpushed => [
		{
			...answer('here', [session({ checkout: '/w/a' }), session({ id: 'b', project: 'b', checkout: '/w/b' })], {
				projects: ['paude', 'b'],
			}),
			checkouts: [
				{ root: '/w/a', changed: 3, unpushed },
				{ root: '/w/b', changed: 0, unpushed: 8 },
			],
		},
	];
	const made = shipWith(at(1));

	run(made, 2);

	const wandered = made.craneX;

	run(made, 3);
	expect(made.craneX).not.toBeCloseTo(wandered);
	made.update(at(2));
	run(made, 0.6);
	expect(Math.abs(made.craneX - (made.art(holdSpotAt(made.layout.hold, 0)).x + 3))).toBeLessThan(2);
	// More commits than a pod shows: drawn no more than it holds, without fault
	expect(() =>
		made.drawPod({ fillStyle: '', fillRect: () => {} }, { x: 0, y: 0 }, { hue: 10, crates: 8, sheets: 9 }),
	).not.toThrow();
});

test('a coffee given to a grey comes down the tube to its desk, and taken away goes back up it', () => {
	const keeping = value => [answer('here', [session({ status: 'ready', keeping: value })], { projects: ['paude'] })];
	const made = shipWith(keeping(undefined));
	const [worker] = made.workers.values();

	expect(made.pipeFrom(worker.seat)).not.toBeNull();
	expect(made.serving(worker)).toBeNull();

	made.update(keeping('warm'));
	expect(made.serving(worker)).toMatchObject({ give: 'warm', take: undefined });
	run(made, 2);
	expect(made.serving(worker)).toBeNull();

	made.update(keeping(undefined));
	expect(made.serving(worker)).toMatchObject({ give: undefined, take: 'warm' });
	run(made, 2);
	expect(made.serving(worker)).toBeNull();

	// A fabled session's monitor keeps it: no drink on its console, so none comes down, and going's cup goes back up
	made.update(keeping('going'));
	run(made, 2);
	made.update(keeping('fabled'));
	expect(made.serving(worker)).toMatchObject({ give: undefined, take: 'going' });
	run(made, 2);
	made.update(keeping('fabled'));
	expect(made.serving(worker)).toBeNull();
});

test("a tank with the account's limits known gauges what's left of each, and is as full as the one nearest running out", () => {
	const usage = ago => ({
		session: { percent: 60, resetsAt: 'soon' },
		week: { percent: 28, resetsAt: 'later' },
		models: [],
		ago,
	});
	const [tank] = tanksOf([
		{ key: 'here', fuel: { account: 'a', burned: 10, rate: 1, usage: usage(5000) } },
		{ key: 'vps', fuel: { account: 'a', burned: 5, rate: 0, usage: { ...usage(100), week: { percent: 30 } } } },
	]);

	expect(tank.gauges.session).toBeCloseTo(0.4);
	expect(tank.gauges.week).toBeCloseTo(0.7);
	expect(tank.level).toBeCloseTo(0.4);
	expect(tanksOf([{ key: 'here', fuel: { account: 'a', burned: 10, rate: 1 } }])[0]).toMatchObject({
		gauges: undefined,
		level: null,
	});
});

test('a tank that reads fuller than it did is sent a refuel ship, its gauge rising from where it was as it pumps; none on first sight', () => {
	const engine = left => ({
		key: 'here',
		fuel: {
			account: 'a',
			burned: 0,
			rate: 0,
			usage: { session: { percent: 100 - left }, week: { percent: 10 }, models: [], ago: 0 },
		},
	});
	const made = new Ship();

	made.refuelled(tanksOf([engine(20)]));
	expect(made.refuels).toEqual([]);

	made.refuelled(tanksOf([engine(18)]));
	expect(made.refuels).toEqual([]);

	const [tank] = made.refuelled(tanksOf([engine(100)]));

	expect(made.refuels).toMatchObject([{ key: 'a', index: 0, time: 0 }]);
	expect(made.tankShown(tank).gauges.session).toBeCloseTo(0.18);
	made.refuels[0].time = 0.75;
	expect(made.tankShown(tank).gauges.session).toBeCloseTo(1);
});

test('the one opening the view comes aboard by shuttle once the ship is in, and its plating stays shut till they have walked in', () => {
	const me = { key: 'me', name: 'chase', role: 'owner', sessions: [] };
	const looks = [{ ...answer('here', [session()], { projects: ['paude'] }), people: [me] }];
	const made = new Ship();

	made.resize(1600, 900);
	made.sealed = true;
	// Told who's looking only once it's heard who's aboard, as the view tells it
	made.update(looks);
	made.viewer = 'me';
	made.open();
	// Still in warp: just their shuttle, the ship held off, the view close on it
	run(made, 1);
	expect(made.entering()).toBe(0);
	expect(made.shuttles).toMatchObject([{ key: 'me', kind: 'in', join: true }]);
	expect(made.joinGoal()).not.toBeNull();
	// The ship pulled in under it, the view drawn back to all of it, its plating held shut while the shuttle settles and
	// they walk its tube
	run(made, 4);
	expect(made.arrived()).toBe(true);
	// The view still on their coming aboard: over the shuttle's tube while they walk it, then out to the whole ship
	expect(made.joinGoal()).not.toBeNull();
	expect(made.joining()).toBe(true);
	expect(made.coverOf()).toBe(1);
	expect(made.settled()).toBe(false);
	run(made, 4);
	expect(made.joining()).toBe(false);
	expect(made.sealed).toBe(false);
	// Settled once its plating is gone and they've walked from the airlock to where they belong: what's to be focused
	// on opening is, only now
	run(made, 1);
	expect(made.walkingIn() || made.settled()).toBe(true);
	run(made, 7);
	expect(made.walkingIn()).toBe(false);
	expect(made.settled()).toBe(true);
	expect(made.joinGoal()).toBeNull();
	expect(shipWith([answer('here', [session()], { projects: ['paude'] })]).settled()).toBe(true);
});

test('coming aboard, the view is held on the shuttle, drawn back to the whole ship, in over the airlock, and only then flown where it was asked', () => {
	const me = { key: 'me', name: 'chase', role: 'owner', sessions: [] };
	const made = new Ship();

	made.resize(1600, 900);
	made.sealed = true;
	made.update([{ ...answer('here', [session()], { projects: ['paude'] }), people: [me] }]);
	made.viewer = 'me';
	made.open();
	// Opened centered on their shuttle's hull, far off in warp, close up; the hand can't take the view from it
	made.step(1 / 60, false);
	const far = shuttleAt(made.shuttleDock(), 1);

	expect(made.camera.x).toBeCloseTo(far.x - 1, 0);
	expect(made.camera.y).toBeCloseTo(far.y - 4, 0);
	expect(made.camera.zoom).toBeGreaterThanOrEqual(4);
	made.pan(300, 300);
	made.zoom(0.5, { x: 0, y: 0 });
	expect(made.camera.x).toBeCloseTo(far.x - 1, 0);
	expect(made.flying).toBe(true);
	// The ship pulled in under it, the view drawn back to all of it
	run(made, 5.5);
	const { joinAt } = made;

	made.joinAt = undefined;
	const whole = made.goal();

	made.joinAt = joinAt;
	expect(made.camera.zoom).toBe(whole.zoom);
	// In over the airlock as they walk the tube and step out; asked to look at the bay meanwhile, it waits
	run(made, 2);
	const dock = made.shuttleDock();

	expect(made.camera.x).toBeCloseTo(dock.x, 0);
	expect(made.camera.y).toBeCloseTo(dock.y + 8, 0);
	expect(made.camera.zoom).toBeGreaterThan(whole.zoom);
	made.look('paude');
	run(made, 1.5);
	expect(made.joinGoal()).not.toBeNull();
	expect(made.camera.x).toBeCloseTo(dock.x, 0);
	// Stepped out: flown to the bay
	run(made, 3);
	expect(made.joinGoal()).toBeNull();
	expect(made.looking).toBe('paude');
	expect(made.camera.x).toBeCloseTo(made.goal().x, 0);
	expect(made.camera.zoom).toBe(made.goal().zoom);
});

test('someone coming aboard waits at the airlock till they are down its shuttle tube; going, the shuttle takes them once its tube is down', () => {
	const sam = { key: 'sam', name: 'Sam', role: 'comment', sessions: ['b'] };
	const looks = people => [
		answer('here', [session(), session({ id: 'b', project: 'site' })], { projects: ['paude', 'site'], people }),
	];
	const made = shipWith(looks([]));

	run(made, 10);
	made.update(looks([sam]));

	const walker = walkerNamed(made, 'Sam');
	const { airlock } = made;

	expect(made.shuttles).toMatchObject([{ key: 'sam', kind: 'in' }]);
	run(made, 2.5);
	expect([walker.x, walker.y]).toEqual([airlock.x, airlock.y]);
	expect(made.boarding(walker)).toBe(true);
	run(made, 30);
	expect(made.boarding(walker)).toBe(false);
	expect(Math.hypot(walker.x - airlock.x, walker.y - airlock.y)).toBeGreaterThan(0.5);
	expect(made.shuttles).toEqual([]);

	made.update(looks([]));
	expect(made.shuttles).toMatchObject([{ key: 'sam', kind: 'out' }]);
	run(made, 30);
	expect(walkerNamed(made, 'Sam')).toBeUndefined();
	expect(made.shuttles).toEqual([]);
});

test("a project's sessions share one rack for what they run beside Claude, at its island's end, rather than one behind each grey", () => {
	const running = [{ pid: 1, cpuSeconds: 3 }];
	const made = shipWith([
		answer(
			'here',
			[
				session({ processes: running }),
				session({ id: 'b', processes: running }),
				session({ id: 'c', project: 'site', services: [{ port: 3000 }] }),
				session({ id: 'd', project: 'site' }),
			],
			{ projects: ['paude', 'site'] },
		),
	]);
	const racks = made.rackParts(null);
	const island = made.bridge.islands.find(({ name }) => name === 'paude');

	expect(racks).toHaveLength(2);
	expect(racks.some(({ y }) => Math.abs(y - (island.y - 0.15)) < 1e-9)).toBe(true);
});

test('rooms laid out anew while the one looking comes aboard keep them at the airlock, then walking out of it, rather than put in place', () => {
	const me = { key: 'me', name: 'chase', role: 'owner', sessions: [] };
	const looks = projects => [
		{
			...answer(
				'here',
				projects.map((project, index) => session({ id: `s${index}`, project })),
				{ projects },
			),
			people: [me],
		},
	];
	const made = new Ship();

	made.resize(1600, 900);
	made.sealed = true;
	made.update(looks(['paude']));
	made.viewer = 'me';
	made.open();
	run(made, 6);
	// Another engine's projects come in: the rooms move round while they're on their way down the shuttle's tube
	made.update(looks(['paude', 'site', 'notes']));
	expect(made.moved).toBe(true);

	const walker = made.walkers.get('me');

	run(made, 0.1);
	expect(made.boarding(walker)).toBe(true);
	expect(Math.hypot(walker.x - made.airlock.x, walker.y - made.airlock.y)).toBeLessThan(0.01);
	expect(walker.path.length).toBeGreaterThan(0);
	// Down it and out of the doorway, they walk from the airlock rather than being found where they belong
	run(made, 3);
	expect(Math.hypot(walker.x - made.airlock.x, walker.y - made.airlock.y)).toBeGreaterThan(0.1);
	expect(walker.path.length).toBeGreaterThan(0);
});

test('the bay doors in the belly slide open while a push goes out through them and shut again after', () => {
	const checkout = unpushed => ({ root: '/work/paude', changed: 0, unpushed });
	const working = checkouts => [
		{ ...answer('here', [session({ checkout: '/work/paude' })], { projects: ['paude'] }), checkouts },
	];
	const made = new Ship();

	made.resize(800, 600);
	made.update(working([checkout(2)]));
	run(made, 1);
	expect(made.bayDoors).toEqual({ hold: 0, hangar: 0 });
	made.update(working([checkout(0)]));
	// The pod lifting off and dropping, the tug diving after it: both doors opening, then wide
	run(made, 1.2);
	expect(made.bayDoors.hold).toBe(1);
	expect(made.bayDoors.hangar).toBe(1);
	// The pod and the tug gone through, the doors shut; the tug back in, the hangar's shut behind it
	run(made, 2.5);
	expect(made.bayDoors.hold).toBe(0);
	expect(made.bayDoors.hangar).toBe(0);
	run(made, 4);
	expect(made.haulers).toHaveLength(0);
	expect(made.bayDoors).toEqual({ hold: 0, hangar: 0 });
});

test('a couch more needed is dropped out of the tube; one no longer needed is zapped from the ceiling, the lounge its size till its ash is sucked up', () => {
	const resting = ids => [
		answer(
			'here',
			['a', 'b', 'c', 'd'].map(id => session({ id, status: ids.includes(id) ? 'stopped' : 'working' })),
			{ projects: ['paude'] },
		),
	];
	const made = shipWith(resting(['a', 'b']));

	run(made, 2);
	expect(made.couches).toBe(1);

	// Two more come to rest: a second couch is needed, dropped in
	made.update(resting(['a', 'b', 'c']));
	expect(made.couches).toBe(2);
	expect(made.couchDrops).toMatchObject([{ index: 1 }]);
	expect(made.couchesLifted()[1]).toBeGreaterThan(0);
	run(made, 3);
	expect(made.couchesLifted()[1] ?? 0).toBe(0);

	// The one on it gets up: it's no longer needed, and the emitter comes down for it; the lounge stays its size
	const loungeCount = () => made.layout.rooms.find(({ kind }) => kind === 'lounge').count;

	made.update(resting(['a', 'b']));
	expect(made.couches).toBe(1);
	expect(made.couchZaps).toMatchObject([{ index: 1 }]);
	expect(loungeCount()).toBe(3);

	const ashes = made.dust.length;

	// While zapped, and while its ash lies, the lounge leaves the couch out: its zap draws it crumbling, then nothing
	expect([...made.couchesGone()]).toEqual([1]);
	run(made, 2);
	expect(made.dust.length).toBe(ashes + 1);
	expect(made.dust.at(-1).couch).toBe(1);
	expect([...made.couchesGone()]).toEqual([1]);
	made.update(resting(['a', 'b']));
	expect(loungeCount()).toBe(3);

	// Its ash sucked up, the lounge still leaves the couch out until it's laid again, for the one couch
	run(made, 7);
	expect(made.dust.some(({ couch }) => couch === 1)).toBe(false);
	expect(loungeCount()).toBe(3);
	expect([...made.couchesGone()]).toEqual([1]);
	made.update(resting(['a', 'b']));
	expect(loungeCount()).toBe(2);
	expect([...made.couchesGone()]).toEqual([]);
});

test('a lounger whose couch moves up as one before it gets up hops down and scoots over to it, rather than appearing there; to another row by the side', () => {
	const resting = ids => [
		answer(
			'here',
			['a', 'b', 'c', 'd', 'e'].map(id => session({ id, status: ids.includes(id) ? 'stopped' : 'working' })),
			{ projects: ['paude'] },
		),
	];
	const made = shipWith(resting(['a', 'b', 'c']));

	run(made, 30);

	const c = made.workers.get('here/c');
	const was = { ...made.placeOf(c) };

	expect(made.walking(c)).toBe(false);
	made.update(resting(['a', 'c']));

	const now = made.placeOf(c);

	expect(now).not.toEqual(was);
	// Off from where it sat, down into the aisle, along, and up onto the couch it has now
	expect([c.x, c.y]).toEqual([was.x, was.y]);
	expect(c.path).toEqual([{ x: was.x, y: was.y + 0.55 }, { x: now.x, y: now.y + 0.55 }, now]);
	// The one before it, whose couch didn't move, stays put
	expect(made.walking(made.workers.get('here/a'))).toBe(false);
	// Mid-hop it's off the ground
	run(made, 0.1);
	expect(made.hopOf(c)).toBeGreaterThan(0);
	expect(made.standingAt(c).y).toBeLessThan(made.art(c).y);
	run(made, 30);
	expect(made.walking(c)).toBe(false);
	expect(made.hopOf(c)).toBe(null);
	expect(Math.hypot(c.x - now.x, c.y - now.y)).toBeLessThan(0.01);

	// Five resting fill a row and start a second; the first of the second row, its couch gone up a row, goes round by
	// the lounge's side rather than through the couches
	made.update(resting(['a', 'b', 'c', 'd', 'e']));
	run(made, 40);

	const e = made.workers.get('here/e');
	const seatedAt = { ...made.placeOf(e) };

	made.update(resting(['b', 'c', 'd', 'e']));
	expect(made.placeOf(e).y).toBeLessThan(seatedAt.y);
	expect(e.path).toHaveLength(5);
	expect(e.path[1].x).toBeCloseTo(made.lounge.x + 0.4, 5);
	expect(e.path[1].y).toBeCloseTo(seatedAt.y + 0.55, 5);
	expect(e.path[2].y).toBeCloseTo(made.placeOf(e).y + 0.55, 5);
});

test('islands stay where they stood as others come and go, unless they no longer fit there', () => {
	const projects = ['one', 'two', 'three', 'four'];
	const crew = names => [
		answer(
			'here',
			names.flatMap((project, index) =>
				[0, 1].map(seat => session({ id: `${project}-${seat}`, project, status: index ? 'ready' : 'working' })),
			),
			{ projects },
		),
	];
	const made = shipWith(crew(['one', 'two', 'three']));
	const standing = () =>
		Object.fromEntries(made.bridge.islands.map(({ key, row, x }) => [key, `${row}@${(x - made.bridge.x).toFixed(2)}`]));
	const before = standing();

	made.update(crew(['one', 'two', 'three', 'four']));
	run(made, 1);

	const after = standing();

	for (const key of Object.keys(before)) expect(after[key]).toBe(before[key]);
	expect(after['four#0']).toBeDefined();
});

test('those sat at an island that has to move get up and walk to where it has gone, rather than gliding with it', () => {
	const projects = ['paude', 'other'];
	const made = shipWith([answer('here', [session()], { projects })]);

	run(made, 2);

	const worker = made.workers.get('here/a');
	const before = made.bridge.islands.find(({ name }) => name === 'paude').at;

	// Another project's conduit widens the risers' room into the island: it has to move
	made.update([answer('here', [session(), session({ id: 'c', project: 'other' })], { projects })]);
	expect(made.bridge.islands.find(({ name }) => name === 'paude').at).not.toBe(before);
	expect(made.walking(worker)).toBe(true);
	expect(worker.seatGoal).toBeNull();
	run(made, 0.3);
	expect(made.islandRise('paude#0')).toBeLessThan(2);
	run(made, 8);
	expect(made.walking(worker)).toBe(false);
	expect(made.islandRise('paude#0')).toBe(2);
});

// A surface that notes each sprite drawn on it; sprites are drawn through canvases the art makes, stood in for here.
// `done` once drawn with
const spriteSurface = () => {
	const drawn = [];
	const canvasLike = () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: () => {} }) });
	const hadDocument = 'document' in globalThis;

	if (!hadDocument) globalThis.document = { createElement: canvasLike };

	const ctx = {
		fillStyle: '',
		fillRect: () => {},
		drawImage: (image, x, y) => drawn.push({ image, x, y }),
		save: () => {},
		restore: () => {},
		translate: () => {},
		scale: () => {},
		beginPath: () => {},
		rect: () => {},
		clip: () => {},
		createRadialGradient: () => ({ addColorStop: () => {} }),
	};

	return { ctx, drawn, done: () => !hadDocument && delete globalThis.document };
};

test("a fabled session's monitor stands behind its grey, and points at the terminal while the session asks something", () => {
	const kept = (keeping, status = 'ready') => [answer('here', [session({ status, keeping })], { projects: ['paude'] })];
	const made = shipWith(kept('fabled'));
	const [worker] = made.workers.values();
	const { ctx, drawn, done } = spriteSurface();

	run(made, 10);
	expect(made.walking(worker)).toBe(false);

	const parts = made.watcherParts(ctx, worker);

	expect(parts).toHaveLength(1);
	// Behind its grey: drawn before it
	expect(parts[0].y).toBeLessThan(worker.seat.y - 0.12);
	made.hits = [];
	parts[0].draw();
	expect(made.hits.find(hit => hit.kind === 'watcher')?.session).toBe(worker.session);
	expect(drawn).toHaveLength(1);

	// The session stops to ask: the monitor takes it in first, standing as it was with its skull aglow, then points
	made.update(kept('fabled', 'waiting'));
	made.watcherParts(ctx, worker)[0].draw();
	expect(drawn).toHaveLength(2);
	expect(drawn[1].image).toBe(drawn[0].image);
	run(made, 3);
	made.watcherParts(ctx, worker)[0].draw();
	// The pointing arm is drawn on, pixel by pixel
	expect(drawn).toHaveLength(3);
	expect(drawn[2].image).not.toBe(drawn[0].image);

	// A person walking the aisle behind it is drawn over the whole scene; the monitor is drawn again over them, and not
	// over someone in front of it
	const spot = made.watcherAt(worker);

	made.watcherParts(ctx, worker)[0].draw();
	const before = drawn.length;

	made.drawWatchersOver(ctx, { x: spot.x, y: spot.y - 0.5 });
	expect(drawn).toHaveLength(before + 1);
	made.drawWatchersOver(ctx, { x: spot.x, y: spot.y + 0.5 });
	made.drawWatchersOver(ctx, { x: spot.x + 2, y: spot.y - 0.5 });
	expect(drawn).toHaveLength(before + 1);

	// No longer fabled: it walks off to the airlock, no longer its grey's, and is gone once its craft has taken it
	made.update(kept('going'));
	expect(made.watcherParts(ctx, worker)).toEqual([]);
	expect(made.monitorsGone).toHaveLength(1);
	run(made, 90);
	expect(made.monitorsGone).toEqual([]);
	done();
});

test("a fabled session's monitor jabs at the terminal the whole time it has the reply, and for a few seconds after it prompts the session", () => {
	const kept = changes => [
		answer('here', [session({ status: 'ready', keeping: 'fabled', ...changes })], { projects: ['paude'] }),
	];
	const made = shipWith(kept({}));
	const [worker] = made.workers.values();
	const { ctx, drawn, done } = spriteSurface();

	run(made, 10);
	made.watcherParts(ctx, worker)[0].draw();
	expect(made.watcherPrompting(worker)).toBe(false);
	// The reply with its monitor: at the terminal, arm out, for as long as that takes, the screen sending it out
	made.update(kept({ reading: { kind: 'fabled', ago: 1000 } }));
	expect(made.watcherPrompting(worker)).toBe(true);
	expect(screenOf(worker.session)).toEqual({ kind: 'send', hue: 275 });
	run(made, 30);
	expect(made.watcherPrompting(worker)).toBe(true);
	expect(made.drinking(worker)).toBe(false);
	// Its nudge typed in half a second ago: it stands at the terminal, arm out
	made.update(kept({ status: 'working', boost: { kind: 'fabled', ago: 500 } }));
	expect(made.watcherPrompting(worker)).toBe(true);
	made.watcherParts(ctx, worker)[0].draw();
	expect(drawn).toHaveLength(2);
	expect(drawn[1].image).not.toBe(drawn[0].image);
	// Done a few seconds later
	run(made, 5);
	expect(made.watcherPrompting(worker)).toBe(false);
	// A session kept warm is pinged, not prompted: no monitor, no jab
	const warm = shipWith([
		answer('here', [session({ keeping: 'warm', boost: { kind: 'warm', ago: 500 } })], { projects: ['paude'] }),
	]);

	expect(warm.watcherPrompting([...warm.workers.values()][0])).toBe(false);
	done();
});

test("a session kept going drinks from its cup the whole time its reply is with Haiku, its screen sending the reply out, and sets the cup back a few seconds after Haiku's nudge", () => {
	const kept = changes => [
		answer('here', [session({ status: 'ready', keeping: 'going', ...changes })], { projects: ['paude'] }),
	];
	const made = shipWith(kept({}));
	const [worker] = made.workers.values();

	expect(made.drinking(worker)).toBe(false);
	expect(screenOf(worker.session).kind).toBe('idle');
	made.update(kept({ reading: { kind: 'going', ago: 500 } }));
	run(made, 0.1);
	expect(made.drinking(worker)).toBe(true);
	expect(made.sipLift(worker)).toBeLessThan(1);
	expect(screenOf(worker.session)).toEqual({ kind: 'send', hue: 140 });
	run(made, 20);
	expect(made.drinking(worker)).toBe(true);
	expect(made.sipLift(worker)).toBe(1);
	// Haiku's nudge typed and Claude at work: the drink goes on a few seconds, then the cup is set back
	made.update(kept({ status: 'working', boost: { kind: 'going', ago: 100 } }));
	expect(screenOf(worker.session).kind).toBe('work');
	run(made, 3);
	expect(made.drinking(worker)).toBe(true);
	run(made, 5);
	expect(made.drinking(worker)).toBe(false);
	// Left to wait: the cup set back, the screen idle
	made.update(kept({ reading: { kind: 'going', ago: 500 } }));
	run(made, 1);
	made.update(kept({}));
	run(made, 2);
	expect(made.drinking(worker)).toBe(false);
	expect(screenOf(worker.session).kind).toBe('idle');
});

test('a seat is kept through a stop and a waking: seats go by when a session was born, as its paude says, or by its age at first sight', () => {
	const at = (id, changes) => session({ id, checkout: id, ...changes });
	const seats = made => made.bridge.islands[0].seats.map(({ key }) => key);
	const made = shipWith([
		answer('here', [at('a', { age: 90000 }), at('b', { age: 50000 }), at('c', { age: 5000 })], { projects: ['paude'] }),
	]);

	expect(seats(made)).toEqual(['here/a', 'here/b', 'here/c']);
	// b stops (no age any more), then wakes as a fresh process (a small age): it stays where it sat
	made.update([
		answer('here', [at('a', { age: 92000 }), at('b', { status: 'stopped', tool: null }), at('c', { age: 7000 })], {
			projects: ['paude'],
		}),
	]);
	expect(seats(made)).toEqual(['here/a', 'here/b', 'here/c']);
	made.update([
		answer('here', [at('a', { age: 94000 }), at('b', { age: 100 }), at('c', { age: 9000 })], { projects: ['paude'] }),
	]);
	expect(seats(made)).toEqual(['here/a', 'here/b', 'here/c']);

	// A paude that says when each was born is believed over their ages, so a reload seats them the same
	const told = shipWith([
		answer(
			'here',
			[at('a', { age: 90000, born: 3000 }), at('b', { age: 50000, born: 1000 }), at('c', { born: 2000 })],
			{
				projects: ['paude'],
			},
		),
	]);

	expect(seats(told)).toEqual(['here/b', 'here/c', 'here/a']);
});

test("seats run oldest to newest from the aft end, small terminals to a seat's left; short-lived sessions sit on the floor past the desk, each after the last", () => {
	const sessions = [
		session({ id: 'old', age: 90000, checkout: 'z' }),
		session({ id: 'brief', lifetime: 'brief', age: 1000, checkout: 'a' }),
		session({ id: 'new', age: 5000, checkout: 'b', agents: 2 }),
		session({ id: 'later', lifetime: 'brief', age: 500, checkout: 'c' }),
	];
	const made = shipWith([answer('here', sessions, { projects: ['paude'] })]);
	const [island] = made.bridge.islands;

	expect(island.seats.map(({ key }) => key)).toEqual(['here/old', 'here/new', 'here/brief', 'here/later']);

	const [old, fresh, brief, later] = ['old', 'new', 'brief', 'later'].map(id => made.workers.get(`here/${id}`));

	// On the floor past the desk's end, level with the row, its laptop between it and the desk clear of the end cap
	expect(brief.seat.floor).toBe(true);
	expect(brief.seat.x).toBeGreaterThan(island.x + island.w);
	expect(made.placeOf(brief).y).toBeCloseTo(island.y + 0.2, 5);
	expect(made.deskOf(brief.seat).x - 6).toBeGreaterThan(made.art({ x: island.x + island.w, y: 0 }).x + 1);
	expect(later.seat.x - brief.seat.x).toBeCloseTo(1.7, 5);
	// The desk is only the seats'; nothing on it marks the floor places
	expect(island.w).toBeLessThan(brief.seat.x - island.x);
	expect(fresh.seat.x).toBeLessThan(island.x + island.w);
	// Small terminals to the left of their grey's seat, within its own room: past the seat before's keyboard
	for (const index of [0, 1]) {
		const small = made.art(made.smallGreyAt(fresh, index));

		expect(small.x).toBeLessThan(made.art(fresh.seat).x - 17);
		expect(small.x - 14).toBeGreaterThanOrEqual(made.art(old.seat).x + 10);
	}
	expect(made.watcherAt(fresh).x).toBeCloseTo(fresh.seat.x + 1, 5);
	// Sat cross-legged: a body of its own, and one waving
	expect(spriteSize('bodySit').h).toBe(7);
	expect(spriteSize('bodySitWave').h).toBe(10);
});

test('a session turned fabled gets its monitor by a craft of its own at the airlock, walking to its place; turned back, it walks there and the craft takes it off', () => {
	const kept = keeping => [answer('here', [session({ status: 'ready', keeping })], { projects: ['paude'] })];
	const made = shipWith(kept(undefined));
	const [worker] = made.workers.values();
	const { airlock } = made;

	expect(airlock).toBeTruthy();
	expect(worker.watcher).toBeUndefined();

	made.update(kept('fabled'));

	expect(worker.watcher).toBeTruthy();
	expect(worker.watcher.x).toBeCloseTo(airlock.x, 5);
	expect(worker.watcher.y).toBeCloseTo(airlock.y, 5);
	expect(worker.watcher.path.length).toBeGreaterThan(0);
	expect(worker.watcher.path.at(-1)).toEqual(made.watcherAt(worker));
	// Its craft, come for it alone, holds it at the airlock till it's down the tube; out of sight the while
	expect(worker.watcher.shuttle).toMatchObject({ key: 'here/a|monitor', kind: 'in', craft: 'monitor' });
	expect(made.shuttles).toContain(worker.watcher.shuttle);
	expect(made.boarding(worker.watcher)).toBe(true);
	run(made, 1);
	expect(worker.watcher.x).toBeCloseTo(airlock.x, 5);
	// Round its island's forward end, the one nearer the airlock, with its whole width clear of the console's end cap,
	// then in behind the console
	const { island } = worker.seat;
	const climb = worker.watcher.path.findIndex(({ y }) => Math.abs(y - (island.y - BEHIND_CONSOLE)) < 1e-9);

	expect(climb).toBeGreaterThan(0);
	expect(worker.watcher.path[climb].x).toBe(worker.watcher.path[climb - 1].x);
	expect(worker.watcher.path[climb].x).toBeGreaterThanOrEqual(island.x + island.w + 0.45);
	// Striding as a grey does: a step sprite each way, the monitor's own size
	for (const step of ['watcherStepLeft', 'watcherStepRight']) expect(spriteSize(step)).toEqual(spriteSize('watcher'));

	run(made, 90);
	expect(worker.watcher.path).toHaveLength(0);
	expect(worker.watcher.x).toBeCloseTo(made.watcherAt(worker).x, 5);
	expect(worker.watcher.y).toBeCloseTo(made.watcherAt(worker).y, 5);
	expect(made.shuttles).toEqual([]);

	// No longer fabled: no longer its grey's, it walks to the airlock, where a craft comes for it and takes it off
	made.update(kept('warm'));
	expect(worker.watcher).toBeUndefined();
	const [gone] = made.monitorsGone;

	expect(gone.key).toBe('here/a');
	expect(gone.watcher.path.at(-1)).toEqual(airlock);
	expect(made.shuttles.find(({ key }) => key === 'here/a|monitor')).toMatchObject({ kind: 'out', craft: 'monitor' });
	run(made, 90);
	expect(made.monitorsGone).toEqual([]);
	expect(made.shuttles).toEqual([]);

	// Fabled again while it was still walking to the airlock: it turns round, and its craft leaves without it
	made.update(kept('fabled'));
	run(made, 90);
	made.update(kept('warm'));
	run(made, 0.5);
	expect(made.monitorsGone[0].watcher.path.length).toBeGreaterThan(0);
	made.update(kept('fabled'));
	expect(made.monitorsGone).toEqual([]);
	expect(worker.watcher).toBeTruthy();
	expect(made.shuttles.find(({ key }) => key === 'here/a|monitor')).toMatchObject({ empty: true });
	run(made, 90);
	expect(worker.watcher.x).toBeCloseTo(made.watcherAt(worker).x, 5);
	expect(made.shuttles).toEqual([]);

	// Fabled at first sight, it's simply there
	const first = shipWith(kept('fabled'));
	const [seen] = first.workers.values();

	expect(seen.watcher.path).toHaveLength(0);
	expect(seen.watcher.shuttle).toBeUndefined();
});

test("the island keeps room for a fabled session's monitor past its seat, so it isn't under the next seat's screen", () => {
	const two = keeping => [
		answer('here', [session({ keeping }), { ...session({}), id: 'b', title: 'B', key: 'here/b' }], {
			projects: ['paude'],
		}),
	];
	const plain = shipWith(two(undefined));
	const [a, b] = [...plain.workers.values()].map(worker => worker.seat);
	const fabled = shipWith(two('fabled'));
	const [fa, fb] = [...fabled.workers.values()].map(worker => worker.seat);

	expect(fb.x - fa.x).toBeCloseTo(b.x - a.x + WATCHER_W, 5);

	const [watched] = fabled.workers.values();
	const spot = fabled.watcherAt(watched);

	// The next seat's screen begins 17 art pixels (0.85 units) before its seat; the monitor's body reaches 5 past its spot
	expect(spot.x).toBeGreaterThan(fa.x + 0.3 + 0.3);
	expect(fb.x - 0.85).toBeGreaterThan(spot.x + 0.25);
	// Behind its grey
	expect(spot.y).toBeLessThan(fa.y - 0.12);
});

// A canvas that remembers each filled rectangle's color
const recordingContext = () => {
	const fills = [];
	const ctx = {
		fillStyle: '',
		globalAlpha: 1,
		fillRect: () => fills.push(ctx.fillStyle),
		drawImage: () => {},
		save: () => {},
		restore: () => {},
		beginPath: () => {},
		rect: () => {},
		clip: () => {},
	};

	return { ctx, fills };
};

test("the ship's color trims every room: a band on each girder and a line along each deck's front edge, once set", () => {
	const art = ({ x, y }) => ({ x: Math.round(x * UNIT.x), y: Math.round(y * UNIT.y) });
	const room = { x: 1, y: 1, w: 4, d: 2, hull: {}, name: 'Hold' };
	const hadDocument = 'document' in globalThis;

	if (!hadDocument)
		globalThis.document = {
			createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillStyle: '', fillRect: () => {} }) }),
		};
	try {
		setTrim(120);

		const trimmed = recordingContext();

		walls(trimmed.ctx, art, () => {}, room, { name: 'Hold', color: '#fff' }).forEach(part => part.draw());
		floor(trimmed.ctx, art, room);
		expect(trimmed.fills.filter(color => color === 'hsl(120 55% 48%)')).toHaveLength(3);

		setTrim(null);

		const plain = recordingContext();

		walls(plain.ctx, art, () => {}, room, { name: 'Hold', color: '#fff' }).forEach(part => part.draw());
		floor(plain.ctx, art, room);
		expect(plain.fills.some(color => color.startsWith('hsl(120'))).toBe(false);
	} finally {
		if (!hadDocument) delete globalThis.document;
	}
});

test("the transporter's beam is the color of the ship being gone to, and its console lights each ship in its own", () => {
	const art = ({ x, y }) => ({ x: Math.round(x * UNIT.x), y: Math.round(y * UNIT.y) });
	const room = { x: 2, y: 2, w: 3, d: 2, hull: {}, name: 'Transporter', within: true };
	const ships = [
		{ key: 'vps', name: 'vps', hue: 200 },
		{ key: 'wb', name: 'workbook', hue: 40, working: true },
	];
	const beaming = recordingContext();

	drawTransporter(beaming.ctx, art, () => {}, room, { time: 0, ships, beaming: 0.5, hue: 200 }).forEach(part =>
		part.draw?.(),
	);
	expect(beaming.fills).toContain('hsl(200 70% 76%)');
	// An idle ship's light is its color; a working one's says so instead
	expect(beaming.fills).toContain('hsl(200 50% 42%)');
	expect(beaming.fills).not.toContain('hsl(40 50% 42%)');

	const idle = recordingContext();

	drawTransporter(idle.ctx, art, () => {}, room, { time: 0, ships, beaming: null, hue: null }).forEach(part =>
		part.draw?.(),
	);
	expect(idle.fills).not.toContain('hsl(200 70% 76%)');
});

test("a deck's project only another paude has is started there: the deck says which paude, and none when this paude has it too", () => {
	const vps = { url: 'https://vps', name: 'vps' };

	expect(remoteOfBay({ engines: [{ key: 'https://vps', name: 'vps', remote: vps }] })).toBe(vps);
	expect(
		remoteOfBay({
			engines: [
				{ key: 'here', name: 'dellbook' },
				{ key: 'https://vps', remote: vps },
			],
		}),
	).toBeUndefined();
	expect(remoteOfBay({ engines: [] })).toBeUndefined();
	expect(remoteOfBay(undefined)).toBeUndefined();
});

test("each person aboard wears a suit of their own color: two going by one name on two servers' invites are told apart", () => {
	const made = shipWith([
		answer('here', [session()], {
			projects: ['paude'],
			people: [
				{ key: 'k1', name: 'Sam', role: 'owner', sessions: ['a'] },
				{ key: 'k2', name: 'Sam', role: 'drive', sessions: ['a'] },
				{ key: 'k3', name: 'Pat', role: 'drive', sessions: ['a'] },
			],
		}),
	]);
	const hues = [...made.people.values()].map(person => person.hue);
	const apart = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

	expect(hues).toHaveLength(3);
	for (const [index, hue] of hues.entries())
		for (const other of hues.slice(index + 1)) expect(apart(hue, other)).toBeGreaterThanOrEqual(60);
	// The same mark keeps its color from one answer to the next
	made.update([
		answer('here', [session()], {
			projects: ['paude'],
			people: [{ key: 'k2', name: 'Sam', role: 'drive', sessions: ['a'] }],
		}),
	]);
	expect(made.people.get('k2').hue).toBe(hues[1]);
});
