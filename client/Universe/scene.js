import { facilitiesFor, facilityOf } from '../../shared/facilities';
import { cksum } from '../../shared/hues';
import { PALETTE, drawSprite, spriteSize } from './art';
import { drawLighting, lightOf } from './lighting';
import { FORMS, drawHousing } from './machine';
import { pixelText, textWidth } from './retro';
import {
	TANK_COLORS,
	clipToShip,
	drawBridge,
	REACTOR_SIDE,
	drawEngineering,
	drawHangar,
	drawHold,
	drawHull,
	drawLounge,
	drawMaterializer,
	drawSystem,
	drawTransporter,
} from './hull';
import {
	standingOf,
	clonerAt,
	holdSpotAt,
	layOut,
	navAt,
	padAt,
	panelAt,
	recyclerAt,
	seatOf,
	stockAt,
	systemFootOf,
	systemTallOf,
} from './plan';
import {
	DESK_PITCH,
	DESK_ROW,
	FACE,
	HALL_FACE,
	HULL_FACE,
	UNIT,
	box,
	COUCH_SEAT,
	drawIsland,
	drawPennant,
	drawSeat,
	housingOf,
	drawHall,
	couchEndOf,
	loungeSeatAt,
	rect,
	seeded,
} from './station';

const TAU = Math.PI * 2;
// How far behind the stern the engines reach, in world units, kept in view when looking at the whole ship
const ENGINE_REACH = 2.2;
// How fast the nearest stars stream past, in screen pixels a second: this at a standstill, and up to `most` times it
// with the engines burning flat out (tokens a minute, on the tanks' scale); easing to a new pace over a few seconds
const STAR_SPEED = 4;
const STAR_PACE = { most: 8, easing: 0.6 };
const WALK_SPEED = 1.2;
// Anyone seen this soon after the view opens was already aboard
const ABOARD_SECONDS = 6;
// How long a can's toss onto its pile takes, and a drink of a grey's coffee or energy drink
const TOSS_SECONDS = 0.7;
const DRINK_SECONDS = 3;
// How long a beam off a transporter, or onto one, lasts
export const BEAM_SECONDS = 0.9;
// Someone off to the transporter walks this many times as fast, and beams out after this long however far they got
const HURRY = 5;
const TRAVEL_MOST = 3;
// How long a stream stays after its tool, fading, and how far apart its packets run
const STREAM_LINGER = 4;
const PACKET_GAP = 14;
// How many of a lounger's empties lie crushed about its feet before the rest pile on the backrest
const CANS_DROPPED = 6;
// How long the pilot stands by one grey they watch before moving on to the next
const MILL_SECONDS = 25;
// A worker crosses the ship quicker than a visitor strolls it
const WORKER_SPEED = 2.6;
// How fast the service crew trundles about the ship
const BOT_SPEED = 2.2;
// How long a worker takes to be made in the materializer
const MAKE_SECONDS = 1.6;
// How long the materializer stays charged for a prompt sent, waiting for its session to show
const CHARGE_SECONDS = 30;
const EASE = 4;
// Screen pixels to an art pixel: whole steps only, so every pixel stays square
const ZOOMS = { least: 1, room: 5, most: 8 };
// The least the whole ship is shown at for its pixels to read; the bridge's panel folds rather than push it below
const READABLE_ZOOM = 2;
// What the plans station and the lounge are looked at by, apart from any project's name
export const BRIDGE = '#bridge';
export const LOUNGE = '#lounge';
// Words stay this many screen pixels to the font's pixel at any zoom, as a pixel game's lettering does
const TEXT = 2;
// How much cargo shows, however much there is
const MOST = { papers: 8, crates: 6, canisters: 6, cans: 12, smallGreys: 4, bots: 4 };
// A lounger's empties pile up, one more every half hour since its session's prompt cache went cold
const CAN_MS = 30 * 60_000;
const HAUL_SECONDS = 3;
// Something said in a session's chat shows over its speaker this long
const SPOKE_MS = 90_000;
// How fast what the work made travels the ship
const PARCEL_SPEED = 4;
// How much faster a parcel shoots through the tube than it walks; how high its run is off the floor; and where in the
// drawing order it stands, in front of everything in the rooms along the near wall it runs by
const TUBE_PACE = 4;
const TUBE_Z = 0.25;
const TUBE_FRONT = 1e6;
const SPARKLE_SECONDS = 1.2;
// A small grey takes this long to bud from its grey's bench, or to go
const SMALL_GREY_SECONDS = 0.7;
// A failed tool throws sparks for a moment and smokes a while after; a cube of compacted context takes this long to
// go; a turn running this long steams, and this long glows hot
const SPARK_SECONDS = 2.5;
const SMOKE_SECONDS = 20;
const COMPACT_SECONDS = 3.5;
// Of compacting: its head squeezed down to size over the first part, then the cube of what was squeezed out popping
// from its skull onto the floor, then carted off
const SQUEEZED = 0.25;
const POPPED = 0.4;
// Heads from the biggest down, for squeezing one down through the sizes between
const HEAD_SIZES = ['bursting', 'huge', 'big', 'small'];
// This close to compacting itself (percent of its context left, as Claude counts it), a grey's skull throbs
const BURSTING = 5;
const STEAM_SECONDS = 5 * 60;
const HOT_SECONDS = 15 * 60;
// A walk's frames by turns, as suffixes of the standing sprite's name
const STEPS = ['', 'StepLeft', '', 'StepRight'];
// An island's hit sorts after every figure on it and before the rooms round it
const ISLAND_HIT = 1e6;
// Where each kind of stream runs from, in the order their packets are spaced along a shared conduit
const STREAM_LANES = ['library', 'forge', 'reactor', 'dish', 'tower', 'outpost'];
// A lightning bolt, three pixels across, for the side of an energy drink
const ZAP = [
	[2, 0],
	[1, 1],
	[0, 2],
	[1, 2],
	[2, 2],
	[1, 3],
	[0, 4],
];
// A context this much emptier than last seen was compacted (or cleared)
const COMPACTED = 0.2;
// Whether what changed was tested since, worst first, and how inspection shows each
const VERDICTS = ['failing', 'stale', 'untested', 'current'];
const VERDICT_COLORS = { failing: '#d4524a', stale: '#f0b43c', untested: '#77829a', current: '#2fb39a' };
// The most of a system's latest uses its log keeps, as each engine's does
const LOG_LENGTH = 12;

// The pip on a worker's chest, by the model its session runs: gold, silver, bronze, and violet for Fable
const RANKS = [
	['opus', PALETTE.y],
	['sonnet', PALETTE.w],
	['haiku', PALETTE.o],
	['fable', PALETTE.p],
];

const rankOf = model => RANKS.find(([name]) => model?.includes(name))?.[1] ?? PALETTE.a;

// 'warm', 'going' or none; paudes before `keeping` send it as `kept`
const keepingOf = session => session.keeping ?? session.kept;

// Resting in the lounge: stopped, or ready with its prompt cache gone cold and nobody keeping it warm; one asking you
// something stays at its seat
export const resting = session =>
	session.status === 'stopped' ||
	(session.status === 'ready' && session.context?.warm === false && !keepingOf(session));

const headFor = fill => (fill >= 0.75 && 'huge') || (fill >= 0.5 && 'big') || 'small';

const screenOf = session => {
	const facility = facilityOf(session.tool);
	const working = session.status === 'working';
	const kind =
		(session.limit && !working && 'limit') ||
		(working && !session.tool && 'think') ||
		(working && facility === 'reactor' && 'terminal') ||
		(working && 'work') ||
		{ waiting: 'ask', ready: 'idle' }[session.status] ||
		'off';

	return { kind, hue: accentOf(facility) };
};

// A branch's hue, the same for it on every engine
const branchHue = branch => Math.round(seeded(`branch:${branch}`) * 360);

// When a usage limit resets, from now, as the reactor shows it
export const countdown = (resetAt, now) => {
	if (!resetAt) return 'LIMIT';

	const minutes = Math.max(0, Math.ceil((resetAt - now) / 60_000));

	if (!minutes) return 'RESETTING';

	return `${minutes >= 60 ? `${Math.floor(minutes / 60)}H ` : ''}${minutes % 60}M`;
};

// Each system's own color, far enough apart that their packets in one conduit tell apart
const ACCENTS = { library: 209, forge: 29, reactor: 164, dish: 320, hatchery: 254, tower: 45, outpost: 215 };

const APPLIANCE_WORDS = {
	library: 'files',
	forge: 'edits',
	reactor: 'shell',
	dish: 'web',
	hatchery: 'agents',
	tower: 'plans',
	outpost: 'other',
};

const accentOf = key => (key?.startsWith('mcp:') ? Math.round(seeded(key) * 360) : (ACCENTS[key] ?? 200));

// How hard a facility has worked lately, 0 to 1: a use a minute for ten minutes is about half, a few a minute full
const loadOf = uses => Math.min(1, Math.log2(1 + uses) / 6);

// An engine's appliances: Claude itself (its reactor), then one for each thing it can reach, its MCP servers among
// them; each with the sessions at it, its uses and failures in the last ten minutes (`usage`, as the server counts
// them), and its latest uses, each with its session where that's still known (`log`)
export const appliancesOf = (tools, sessions, usage = {}, log = {}) => {
	const working = sessions.filter(({ status }) => status === 'working');
	const at = key => working.filter(({ tool }) => tool && facilityOf(tool) === key);
	const all = Object.values(usage).reduce(
		(sum, { uses, failures }) => ({ uses: sum.uses + uses, failures: sum.failures + failures }),
		{ uses: 0, failures: 0 },
	);

	return [
		{ key: 'claude', word: 'claude', label: 'The core', about: 'Claude at work', hue: 200, users: working, ...all },
		...facilitiesFor(tools).map(({ key, label, about, mcp }) => ({
			key,
			word: mcp
				? key
						.slice(4)
						.replace(/^claude_ai_/, '')
						.replaceAll('_', ' ')
				: APPLIANCE_WORDS[key],
			label,
			about: mcp ? `the ${label.replace(/ uplink$/, '')} MCP server` : about,
			hue: accentOf(key),
			users: at(key),
			uses: usage[key]?.uses ?? 0,
			failures: usage[key]?.failures ?? 0,
			log: (log[key] ?? []).map(use => ({ ...use, session: sessions.find(({ id }) => id === use.session) })),
		})),
	].map(appliance => ({ ...appliance, active: appliance.users.length > 0, load: loadOf(appliance.uses) }));
};

const mix = (a, b, amount) => a + (b - a) * amount;

// How fast fuel runs to an engine, 0 to 1, from what it burns a minute (in input-token equivalents): a trickle for a
// quiet turn, full for several sessions at it
const flowOf = rate => Math.min(1, Math.log10(1 + rate) / 5);

// A fuel tank for each Claude account the engines run on, or for each engine that doesn't say its account: what they
// burned this window, how fast, and its size as measured when a limit last stopped one of them (each engine measures
// only its own burn, so the largest is the closest); empty while any is limited
const EMPTY_TANK = { burned: 0, rate: 0, capacity: null, capacityAgo: null };

export const tanksOf = engines => {
	const tanks = new Map();

	for (const engine of engines) {
		// Those that don't say what they run on (paudes too old to) share one tank, what's in it not known
		if (!engine.fuel) {
			const unknown = tanks.get('unknown') ?? { ...EMPTY_TANK, engines: [], unknown: true };

			unknown.engines.push(engine);
			tanks.set('unknown', unknown);
			continue;
		}

		const key = engine.fuel.account ?? engine.key;
		const tank = tanks.get(key) ?? {
			account: engine.fuel.account,
			plan: engine.fuel.plan,
			engines: [],
			...EMPTY_TANK,
		};

		tank.engines.push(engine);
		tank.burned += engine.fuel.burned ?? 0;
		tank.rate += engine.fuel.rate ?? 0;
		if ((engine.fuel.capacity ?? 0) > (tank.capacity ?? 0))
			Object.assign(tank, { capacity: engine.fuel.capacity, capacityAgo: engine.fuel.capacityAgo });
		tanks.set(key, tank);
	}

	return [...tanks.values()].map(tank => ({
		...tank,
		empty: tank.engines.some(({ limit }) => limit),
		level: tank.capacity ? Math.max(0, Math.min(1, 1 - tank.burned / tank.capacity)) : null,
		flow: flowOf(tank.rate),
	}));
};

// Hazard tape from `from` to `to` (art pixels), painted once for its size and where its stripes fall
const tapes = new Map();
const tapeOf = (from, to) => {
	const [w, h] = [to.x - from.x, to.y - from.y];
	const phase = (((from.x + from.y) % 4) + 4) % 4;
	const key = `${w},${h},${phase}`;

	if (tapes.has(key)) return tapes.get(key);

	const canvas = document.createElement('canvas');
	const ctx = canvas.getContext('2d');
	const stripe = (x, y) => rect(ctx, x, y, 1, 1, Math.floor((x + y + phase) / 2) % 2 ? PALETTE.y : PALETTE.k);

	canvas.width = Math.max(1, w + 1);
	canvas.height = Math.max(1, h + 1);
	for (let x = 0; x < w; x++) for (const y of [0, h]) stripe(x, y);
	for (let y = 0; y < h; y++) for (const x of [0, w]) stripe(x, y);
	tapes.set(key, canvas);

	return canvas;
};

// A line through `points` (art pixels), its legs' pixels from each point up to the next as boxes to fill, a straight
// leg one box and a slanted one a pixel at a time; and each leg with the index along the line of its first pixel
const trackOf = points => {
	const runs = [];
	const legs = [];
	let first = 0;

	for (let index = 1; index < points.length; index++) {
		const [from, to] = [points[index - 1], points[index]];
		const length = Math.max(Math.abs(to.x - from.x), Math.abs(to.y - from.y));
		const whole = [from.x, from.y, to.x, to.y].every(Number.isInteger);

		if (length && whole && from.y === to.y) runs.push([Math.min(from.x, to.x + 1), from.y, length, 1]);
		else if (length && whole && from.x === to.x) runs.push([from.x, Math.min(from.y, to.y + 1), 1, length]);
		else
			for (let step = 0; step < length; step++)
				runs.push([
					Math.round(from.x + ((to.x - from.x) * step) / length),
					Math.round(from.y + ((to.y - from.y) * step) / length),
					1,
					1,
				]);
		legs.push({ from, to, length, first });
		first += Math.ceil(length);
	}

	return { runs, legs };
};

// From inside a room out to the spine at `lane`: across to its door and through it
const exitOf = (room, from, lane) => {
	// A project's section is left by the deck the point is on
	if (room.parts) return exitOf(room.parts.find(part => from.y <= part.y + part.d) ?? room.parts.at(-1), from, lane);

	const { door } = room;

	if (!room.kind) {
		const gap = from.x + DESK_PITCH / 2 - 0.3;
		const aisle = Math.min(from.y + 0.6, room.y + room.d - 0.15);

		return [
			{ x: from.x, y: from.y - 0.3 },
			{ x: gap, y: from.y - 0.3 },
			{ x: gap, y: aisle },
			{ x: door.x, y: aisle },
			door,
			{ x: door.x, y: lane },
		];
	}

	if (door.side === 'left' || door.side === 'right') {
		const inside = door.x + (door.side === 'left' ? 0.6 : -0.6);
		const outside = door.x + (door.side === 'left' ? -0.4 : 0.4);

		// Off the bridge along the front of its row's consoles, then along its aft wall, never behind an island nor over
		// the screens of the row before it
		if (room.kind === 'bridge') {
			const aisle = standingOf(room, from.y);

			return [
				{ x: from.x, y: aisle },
				{ x: inside, y: aisle },
				{ x: inside, y: lane },
				{ x: door.x, y: lane },
				{ x: outside, y: lane },
			];
		}

		return [
			{ x: inside, y: from.y },
			{ x: inside, y: lane },
			{ x: door.x, y: lane },
			{ x: outside, y: lane },
		];
	}

	return [{ x: door.x, y: from.y }, door, { x: door.x, y: lane }];
};

// The ship's systems from its engines' appliances: by default one of each for the whole ship, its users, uses,
// failures and log from every engine, each MCP server one mast; or one for each engine and appliance, as `keyOf` keys
// them
const systemsOf = (engines, keyOf = (engine, appliance) => appliance.key) => {
	const systems = new Map();

	for (const engine of engines)
		for (const appliance of engine.appliances ?? []) {
			const known = systems.get(keyOf(engine, appliance)) ?? {
				...appliance,
				users: [],
				uses: 0,
				failures: 0,
				log: [],
				engines: [],
			};

			known.users.push(...appliance.users);
			known.log = [...known.log, ...(appliance.log ?? [])].sort((a, b) => a.ago - b.ago).slice(0, LOG_LENGTH);
			known.uses += appliance.uses;
			known.failures += appliance.failures;
			known.engines.push({ name: engine.name, hue: engine.hue, uses: appliance.uses });
			systems.set(keyOf(engine, appliance), known);
		}

	return new Map(
		[...systems].map(([key, system]) => [
			key,
			{ ...system, active: system.users.length > 0, load: Math.min(1, Math.log2(1 + system.uses) / 6) },
		]),
	);
};

// Someone along their path as far as `budget` takes them, facing the way they go
const walk = (mover, budget, seconds) => {
	let left = budget;

	while (mover.path.length && left > 0) {
		const [next] = mover.path;
		const across = next.x - mover.x;
		const down = next.y - mover.y;
		const distance = Math.hypot(across, down);
		const travel = Math.min(distance, left);

		if (distance > 0) {
			mover.x += (across / distance) * travel;
			mover.y += (down / distance) * travel;
			if (Math.abs(across) > 0.01) mover.facing = Math.sign(across);
		}
		left -= travel;
		if (distance - travel < 0.005) mover.path.shift();
	}
	if (mover.path.length) mover.step += seconds * 8;
};

export const sessionKey = (engineKey, id) => `${engineKey}/${id}`;

// What needs this person, most pressing first: those asking something, then those with something new for them
export const triage = (sessions, read = new Map()) => {
	const unread = session => session.unseen > (read.get(session.key) ?? 0);

	return [
		...sessions.filter(session => session.status === 'waiting').map(session => ({ session, need: 'asking' })),
		...sessions
			.filter(session => session.status !== 'waiting' && unread(session))
			.sort((a, b) => (b.reply?.at ?? 0) - (a.reply?.at ?? 0))
			.map(session => ({ session, need: 'unread' })),
	];
};

// Your work as one ship. `update` takes what the engines answered, `step` moves it on, `draw` paints it, `hit` names
// what's under a point.
export default class Ship {
	bays = [];
	engines = [];
	unseen = [];
	labels = [];
	// The engines that have answered at least once
	answered = new Set();
	workers = new Map();
	walkers = new Map();
	haulers = [];
	// The shared systems, each from every engine's appliances, and the hold's cargo
	systems = new Map();
	engineSystems = new Map();
	cargo = [];
	tanks = [];
	// Each checkout's commits not pushed, as last seen: fewer now means a push went; and its files changed, more meaning
	// more parts made
	pushed = new Map();
	changed = new Map();
	// What the work made, waiting to set off from its seat, and on its way: replies to the bridge, parts to the hold
	outgoing = [];
	parcels = [];
	// Each session's changes as of when they were read here, until the server says it's seen them too
	read = new Map();
	stars = [];
	// Screen pixels at the right reserved for the panel about a room looked at
	aside = 0;
	selected = null;
	bots = new Map();
	drift = 0;
	pace = 1;
	hits = [];
	time = 0;
	width = 0;
	height = 0;
	// Where the view's middle is, in art pixels, and how many screen pixels each art pixel takes
	camera = { x: 0, y: 0, zoom: 2 };
	// Each worker's stream as last routed, and what it was routed from
	streamPaths = new WeakMap();
	// Each label's words and size for its place, as last worked out
	fitted = new Map();
	layout = layOut();
	// 'all', a bay's name or an engine's key, or 'free' once dragged or zoomed by hand
	looking = 'all';

	resize(width, height) {
		const first = !this.width;

		this.width = width;
		this.height = height;
		this.stars = Array.from({ length: Math.round((width * height) / 3000) }, (_, index) => ({
			x: seeded(`x${index}`) * width,
			y: seeded(`y${index}`) * height,
			big: seeded(`s${index}`) > 0.92,
			phase: seeded(`p${index}`) * TAU,
			depth: 0.25 + seeded(`d${index}`) * 0.75,
		}));
		if (first) Object.assign(this.camera, this.goal());
	}

	get sessions() {
		return [...this.workers.values()].filter(({ leaving }) => !leaving).map(({ session }) => session);
	}

	// A point in the world, in art pixels: across, and down the screen less however high it stands
	art({ x, y, z = 0 }) {
		return { x: Math.round(x * UNIT.x), y: Math.round(y * UNIT.y - z * UNIT.z) };
	}

	// The other ships of its fleet, as its transporter hears from them: [{ key, name, needs, news, working }]
	fleet = [];
	beamAt = -Infinity;
	// Someone traveling by the transporter: aboard from another ship (`visitor`), gone to one (`away`, their key), walking
	// to its pad to go (`departing`), and just beamed in (`arriving`)
	visitor = null;
	away = null;
	departing = null;
	arriving = null;

	get offset() {
		return {
			x: Math.round(this.width / 2 - this.camera.x * this.camera.zoom),
			y: Math.round(this.height / 2 - this.camera.y * this.camera.zoom),
		};
	}

	// The same point on the screen, for what's hit there and what opens beside it
	screen(point) {
		const at = this.art(point);
		const { x, y } = this.offset;

		return { x: at.x * this.camera.zoom + x, y: at.y * this.camera.zoom + y };
	}

	toScreen({ x, y }) {
		const offset = this.offset;

		return { x: x * this.camera.zoom + offset.x, y: y * this.camera.zoom + offset.y };
	}

	goal() {
		if (this.looking === 'free') return null;

		const room = this.roomOf(this.looking);
		const { left, right, top, bottom } = room
			? { left: room.x - 0.4, right: room.x + room.w + 0.4, top: room.y - 1, bottom: room.y + room.d + 1 }
			: this.ship();
		const [from, to] = [this.art({ x: left, y: top }), this.art({ x: right, y: bottom })];
		// The screen's right edge is left to the panel about what's looked at (the bridge's, for the whole ship), and the
		// room or ship sits in what's left. For the whole ship, where that would shrink it below READABLE_ZOOM, the
		// bridge's panel folds to a summary in the corner instead (`tight`), and the ship has the whole width
		const zoomWith = aside => {
			const fit = Math.min((this.width - 32 - aside) / (to.x - from.x), (this.height - 48) / (to.y - from.y));

			return Math.max(ZOOMS.least, Math.min(room ? ZOOMS.room : ZOOMS.most, Math.floor(fit)));
		};

		// Only where it would drop the ship below the zoom it reads at: a wide window that fits it a step larger alone
		// keeps the panel
		this.tight = !room && zoomWith(this.aside) < Math.min(zoomWith(0), READABLE_ZOOM);

		const aside = this.tight ? 0 : this.aside;
		const zoom = zoomWith(aside);

		return { x: (from.x + to.x) / 2 + aside / 2 / zoom, y: (from.y + to.y) / 2, zoom };
	}

	// The whole ship: the building and a little of the saucer round it, its rim cut off at the sides when it must be
	ship() {
		const { building, bounds } = this.layout;

		if (!building) return { ...bounds, bottom: bounds.bottom + 1.6 };

		// The engines behind the stern always in view; the fins and the nose's tip may be cut short
		return {
			left: Math.max(bounds.left, building.left - ENGINE_REACH),
			right: Math.min(bounds.right, building.right + 1.2),
			top: building.top - 2.6,
			bottom: building.bottom + 3.2,
		};
	}

	// Looking at the transporter, whoever is looking (`viewer`, their key aboard) walks onto its pad, ready to go
	look(at) {
		const known = Boolean(this.roomOf(at));
		const readying = this.roomOf(at)?.kind === 'transporter';

		this.looking = known ? at : 'all';
		if (readying !== Boolean(this.readying)) {
			this.readying = readying;
			if (this.layout) this.board();
		}
	}

	// A room by what it's looked at by: a bay by its project, engineering by an engine's key, or the bridge or lounge
	roomOf(at) {
		if (at === BRIDGE) return this.bridge;
		if (at === LOUNGE) return this.lounge;
		if (this.engines.some(({ key }) => key === at)) return this.layout.engineering;

		return (
			this.bays.find(({ name }) => name === at) ?? this.layout.rooms?.find(({ kind, name }) => kind && name === at)
		);
	}

	// Somewhere particular, closely: a worker's seat
	lookAt(point) {
		const at = this.art(point);

		this.looking = 'free';
		Object.assign(this.camera, { x: at.x, y: at.y - 10, zoom: Math.max(this.camera.zoom, 4) });
	}

	pan(across, down) {
		this.looking = 'free';
		this.camera.x -= across / this.camera.zoom;
		this.camera.y -= down / this.camera.zoom;
	}

	// A step in or out, keeping what's under the pointer there
	zoom(factor, { x, y }) {
		const before = this.camera.zoom;
		const zoom = Math.max(ZOOMS.least, Math.min(ZOOMS.most, before + (factor > 1 ? 1 : -1)));

		if (zoom === before) return;
		this.looking = 'free';
		this.camera.x += (x - this.width / 2) * (1 / before - 1 / zoom);
		this.camera.y += (y - this.height / 2) * (1 / before - 1 / zoom);
		this.camera.zoom = zoom;
	}

	// answers: [{ key, name, hue, remote, error, projects, sessions, people }], what each engine last answered
	update(answers) {
		const sessions = answers.flatMap(answer =>
			(answer.sessions ?? []).map(session => ({
				...session,
				key: sessionKey(answer.key, session.id),
				engine: { key: answer.key, name: answer.name, hue: answer.hue, remote: answer.remote },
			})),
		);
		const keys = new Set(sessions.map(({ key }) => key));

		for (const worker of this.workers.values()) worker.leaving = !keys.has(worker.session.key);
		for (const session of sessions) {
			const worker = this.workers.get(session.key);

			if (worker && (session.reply?.turn ?? 0) > (worker.session.reply?.turn ?? 0)) {
				worker.finishedAt = this.time;
				this.outgoing.push({ kind: 'reply', key: session.key });
			}
			const lounging = resting(session);

			// Its empties go with it from the lounge, so a pile is only ever since its cache last went cold
			if (worker && !lounging) worker.cans = undefined;
			if (worker?.seat && worker.lounging !== lounging)
				worker.trip = {
					from: { x: worker.x ?? this.placeOf(worker).x, y: worker.y ?? this.placeOf(worker).y },
					room: worker.room ?? worker.bay,
				};
			if (worker && (worker.session.context?.fill ?? 0) - (session.context?.fill ?? 1) >= COMPACTED) {
				worker.compactedAt = this.time;
				worker.compactedFrom = this.headOf(worker.session);
			}
			if (worker) Object.assign(worker, { session, lounging, leaving: false });
			if (worker) this.noteKeeping(worker, session);
			else
				this.workers.set(session.key, {
					session,
					lounging,
					seed: seeded(session.key) * TAU,
					opacity: 0,
					leaving: false,
					path: [],
					// New since its engine first answered, it's made in the materializer and walks to its place
					arriving: this.answered.has(session.engine.key) && !lounging,
				});
			Object.assign(this.workers.get(session.key), {
				faultAt: session.faultAgo === undefined ? null : this.time - session.faultAgo / 1000,
				turnAt: session.turnAge === undefined ? null : this.time - session.turnAge / 1000,
			});
			if (session.unseen === 0) this.read.delete(session.key);
		}

		// Where each project's machine was last drawn, kept for its new bay until it's drawn again: the conduits and
		// streams are routed from it before the machines draw
		const built = new Map((this.bays ?? []).map(({ name, built: where }) => [name, where]));

		this.bays = this.baysFor(answers);
		// Each grey in its project's color, the one its machine, island and conduit have
		for (const bay of this.bays)
			for (const key of bay.sessions) {
				const worker = this.workers.get(key);

				if (worker && bay.hue !== null) worker.session = { ...worker.session, hue: bay.hue };
			}
		this.people = this.peopleOf(answers);
		this.projectHues = new Map(answers.flatMap(answer => (answer.projects ?? []).map(({ name, hue }) => [name, hue])));

		const lounging = [...this.workers]
			.filter(([, worker]) => worker.lounging && (!worker.leaving || worker.opacity > 0))
			.map(([key]) => key);

		// Each session watched by whoever isn't any one session's guest, once
		const pilots = [...this.people.values()].filter(person => !this.guestOf(person));

		this.screens = [...new Set(pilots.flatMap(({ sessions: keys }) => keys))].filter(key => this.workers.has(key));
		const engines = answers.map(answer => this.engineOf(answer, sessions));

		this.systems = systemsOf(engines.filter(({ quiet }) => !quiet));
		this.engineSystems = systemsOf(
			engines.filter(({ quiet }) => !quiet),
			(engine, appliance) => `${engine.key}/${appliance.key}`,
		);
		this.loadCargo(answers);
		this.layout = layOut({
			bays: this.bays.map(bay => ({ ...bay, seated: bay.sessions.length })),
			engines: engines.filter(({ quiet }) => !quiet),
			lounge: { count: lounging.length, sessions: lounging },
			agents: Object.fromEntries([...this.workers].map(([key, worker]) => [key, worker.session.agents ?? 0])),
			checkouts: this.cargo.length,
			fleet: this.fleet.length,
		});
		// What can't be seen into takes no room aboard; it's named off to the side
		this.unseen = engines.filter(({ quiet }) => quiet);
		this.bays = this.layout.bays;
		for (const bay of this.bays) bay.built ??= built.get(bay.name);
		this.engines = this.layout.engines;
		this.tanks = tanksOf(this.engines);
		this.crew = answers.reduce(
			(all, { crew }) => {
				all.busy.push(...(crew?.busy ?? []));
				for (const [job, count] of Object.entries(crew?.lately ?? {})) all.lately[job] = (all.lately[job] ?? 0) + count;

				return all;
			},
			{ busy: [], lately: {} },
		);
		this.journey = answers.reduce(
			(sum, { journey }) => {
				for (const kind of Object.keys(sum)) sum[kind] += journey?.[kind] ?? 0;

				return sum;
			},
			{ replies: 0, commits: 0, artifacts: 0, distance: 0, lately: 0 },
		);
		this.bridge = this.layout.bridge;
		this.lounge = this.layout.lounge;

		// The rooms moved round as bays came and went: whoever was aboard is put straight where they're going
		const plan = this.layout.rooms.map(({ name, x, y, w }) => `${name}@${x},${y},${w}`).join('|');

		this.moved = plan !== this.plan;
		this.plan = plan;
		for (const worker of this.workers.values()) worker.homeSeat = undefined;
		this.bays.forEach(bay =>
			bay.sessions.forEach(key => {
				const worker = this.workers.get(key);
				const seat = seatOf(this.bridge, key);

				if (worker && seat) Object.assign(worker, { seat, homeSeat: seat, bay, room: this.bridge });
			}),
		);
		this.lounge?.sessions.forEach((key, index) =>
			Object.assign(this.workers.get(key), {
				seat: loungeSeatAt(this.lounge, index),
				bay: this.lounge,
				room: this.lounge,
			}),
		);
		this.send();
		this.board();
		this.launch();
		for (const answer of answers) if (answer.sessions) this.answered.add(answer.key);
	}

	placeOf(worker) {
		const { seat } = worker;

		return worker.lounging ? { x: seat.x, y: seat.y } : { x: seat.x + 0.3, y: seat.y + 0.2 };
	}

	// From a point in one room to one in another: to its door, out to the spine (along `lane`, the spine's middle unless
	// given), along it, and in; from nowhere (`room` null) it starts on the spine
	route(from, room, to, toRoom, lane = this.layout.halls[0]?.lane) {
		// Within one room, or between rooms on the bridge, straight there
		const home = place => place?.within ?? place;

		if (lane === undefined || home(room) === home(toRoom))
			return home(room) === this.bridge ? this.acrossBridge(from, to) : [to];

		const out = room ? exitOf(room, from, lane) : [{ x: from.x, y: lane }];

		return [...out, ...exitOf(toRoom, to, lane).reverse(), to];
	}

	// From one place on the bridge to another along the fronts of the rows' consoles and up or down its aft wall, where
	// nobody walks over a screen
	acrossBridge(from, to) {
		const wall = this.bridge.x + 0.6;
		const [leave, reach] = [standingOf(this.bridge, from.y), standingOf(this.bridge, to.y)];

		if (leave === reach) return [{ x: from.x, y: leave }, { x: to.x, y: reach }, to];

		return [{ x: from.x, y: leave }, { x: wall, y: leave }, { x: wall, y: reach }, { x: to.x, y: reach }, to];
	}

	// Workers set off: one new from the materializer, one stopped or woken from where it was; and one already on its way
	// keeps going to wherever its place is now. When the rooms moved round, everyone but the new is put straight in
	// their place.
	send() {
		for (const worker of this.workers.values()) {
			if (!worker.seat || worker.leaving) continue;

			const place = this.placeOf(worker);

			// Where it was walking to is gone with the old plan; a new one still comes out of the materializer, and one
			// stopped or woken sets off from its old room's door, or from the hall where that room was
			if (this.moved) worker.path = [];
			if (this.moved && worker.trip) worker.trip = this.tripAfterMoving(worker.trip);
			if (worker.arriving && this.layout.materializer) {
				const cloner = clonerAt(this.layout.materializer);

				Object.assign(worker, cloner, {
					path: this.route(cloner, this.layout.materializer, place, worker.room),
					madeAt: this.time,
					facing: 1,
					step: 0,
				});
				this.chargedAt = -Infinity;
			} else if (worker.trip)
				Object.assign(worker, worker.trip.from, {
					path: this.route(worker.trip.from, worker.trip.room, place, worker.room),
					facing: 1,
					step: 0,
				});
			else if (worker.path.length) {
				worker.path[worker.path.length - 1] = place;
			}
			Object.assign(worker, { arriving: false, trip: null });
		}
	}

	tripAfterMoving({ room }) {
		const origin = room?.kind === 'lounge' ? this.lounge : this.roomOf(room?.name);
		const lane = this.layout.halls[0]?.lane;

		if (origin) return { from: { ...origin.door }, room: origin };
		if (lane === undefined || !room?.door) return null;

		return { from: { x: room.door.x, y: lane }, room: null };
	}

	// A prompt was just sent from here: the materializer charges, until a new session shows or it's waited long enough
	charge() {
		this.chargedAt = this.time;
	}

	get charged() {
		return this.time - (this.chargedAt ?? -Infinity) < CHARGE_SECONDS;
	}

	walking(worker) {
		return worker.path?.length > 0 && !worker.leaving;
	}

	// The hold's cargo: for each checkout a session works in, the files changed and the commits not pushed, with the
	// project it's for. A checkout with fewer commits to push than last time pushed them, and a hauler takes them away.
	loadCargo(answers) {
		this.checkouts = new Map();
		this.cargo = [];
		for (const answer of answers)
			for (const checkout of answer.checkouts ?? []) {
				const key = `${answer.key}:${checkout.root}`;

				this.checkouts.set(key, checkout);
				const users = (answer.sessions ?? []).filter(session => session.checkout === checkout.root);
				const project = users.find(({ project: name }) => this.bays.some(bay => bay.name === name))?.project;
				const before = this.pushed.get(key);
				const changed = this.changed.get(key);

				this.pushed.set(key, checkout.unpushed);
				this.changed.set(key, checkout.changed);
				if (changed !== undefined && checkout.changed > changed) {
					const maker = users.find(({ status }) => status === 'working') ?? users[0];

					if (maker)
						this.outgoing.push({
							kind: 'part',
							key: sessionKey(answer.key, maker.id),
							checkout: key,
							count: Math.min(3, checkout.changed - changed),
						});
				}
				if (!project) continue;

				this.cargo.push({ ...checkout, key, engineName: answer.name, project });
				// Pushed: its pod drops out through the doors under the dock
				if (before > checkout.unpushed)
					this.haulers.push({ crates: before - checkout.unpushed, time: 0, pod: this.cargo.length - 1, project });
			}
	}

	checkoutOf(session) {
		return session.checkout ? this.checkouts?.get(`${session.engine.key}:${session.checkout}`) : undefined;
	}

	// An engine as engineering shows it: Claude at its reactor, its appliances, and whether it's busy at all
	engineOf(answer, sessions) {
		const own = sessions.filter(({ engine }) => engine.key === answer.key);
		const running = own.filter(({ status }) => status !== 'stopped').length;
		const quiet = Boolean(answer.error) || !answer.projects;
		const limited = own.filter(({ limit }) => limit);
		const resets = limited.map(({ limit }) => limit.resetAt).filter(Boolean);

		return {
			key: answer.key,
			name: answer.name,
			hue: answer.hue,
			quiet,
			busy: own.some(({ status }) => status === 'working'),
			older: Boolean(answer.older),
			detail:
				(quiet && (answer.error ? 'out of reach' : "can't see in")) ||
				`${running || 'nothing'} running${answer.older ? ', on an older paude' : ''}`,
			...(([claude, ...appliances]) => ({ claude, appliances }))(
				quiet ? [] : appliancesOf(answer.tools ?? [], own, answer.usage, answer.log),
			),
			limit: limited.length ? { sessions: limited.length, resetAt: resets.length ? Math.min(...resets) : null } : null,
			link: answer.remote ? (answer.latency ?? null) : undefined,
			fuel: answer.fuel,
		};
	}

	// A bay for each project with a session aboard, or watched; a project of the same name on two engines is one
	// bay
	baysFor(answers) {
		const bays = new Map();
		const bayOf = (name, hue) => {
			const bay = bays.get(name) ?? { name, hue: hue ?? null, engines: [], sessions: [], watching: false };

			bays.set(name, bay);

			return bay;
		};

		for (const answer of answers)
			for (const project of answer.projects ?? []) {
				const has = (answer.sessions ?? []).some(
					session => session.project === project.name && session.status !== 'stopped',
				);

				const bay = bayOf(project.name, project.hue);

				bay.active ||= has;

				bay.watching ||= project.watching;
				bay.character ??= project.character;
				bay.engines.push({ key: answer.key, name: answer.name, remote: answer.remote, hue: answer.hue });
			}

		// Gone to rest in the lounge, it keeps its seat at its project's island all the same: its terminal frosted over
		// gone cold, switched off stopped
		for (const [key, worker] of this.workers)
			if (!worker.leaving || worker.opacity > 0) bayOf(worker.session.project ?? 'elsewhere').sessions.push(key);
		for (const bay of bays.values())
			bay.sessions.sort((a, b) =>
				(this.workers.get(a).session.checkout ?? '').localeCompare(this.workers.get(b).session.checkout ?? ''),
			);

		// A project is a section of the hull while one of its sessions is aboard or it's watched: those at work nearest
		// the core, then the watched, each by name; the rest stay off the ship
		const rank = bay => {
			if (bay.sessions.length || bay.active) return 0;

			return bay.watching ? 1 : 2;
		};

		const ranked = [...bays.values()]
			.filter(bay => rank(bay) < 2)
			.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));

		// Only a project at work has a color: idle ones are plain metal, so no two at work share one and each stays its
		// own; one too close to a color already taken moves round the wheel until it's clear of the rest
		const taken = [];

		for (const bay of ranked) {
			if (rank(bay) > 0 || bay.hue === null) {
				bay.hue = null;
				continue;
			}

			let hue = bay.hue;

			for (let turn = 0; turn < 12 && taken.some(other => Math.abs(((hue - other + 540) % 360) - 180) < 28); turn++)
				hue = (hue + 37) % 360;
			bay.hue = hue;
			taken.push(hue);
		}

		return ranked;
	}

	peopleOf(answers) {
		const people = new Map();

		for (const answer of answers)
			for (const person of answer.people ?? []) {
				// Told apart by the mark their paude gives them: the owner's is the same on every paude, so they're one person
				// across them, and two guests going by one name are two
				const key = person.key ?? person.name;
				const known = people.get(key) ?? {
					...person,
					sessions: [],
					hue: Math.round(seeded(person.name) * 360),
				};

				known.sessions.push(...person.sessions.map(id => sessionKey(answer.key, id)));
				people.set(key, known);
			}

		// Someone beamed aboard from another ship, though this one's paude doesn't list them; and someone beamed away
		if (this.visitor && !people.has(this.visitor.key)) people.set(this.visitor.key, { ...this.visitor, sessions: [] });
		if (this.away) people.delete(this.away);

		return people;
	}

	// Where each person aboard stands, by what their invite lets them do, all of them in the bridge's aisles where
	// nothing hides them: the owner, the pilot, before one of the sessions whose terminal they have open (or any aboard),
	// moving on to the next every little while; someone who may drive a session on a stool before its grey, as its co-pilot; someone who may only watch or
	// comment before its terminal, looking in. Invites are for one session, so a guest is only ever there. One with no
	// terminal aboard to watch waits by the nav table.
	spotsOfPeople() {
		const names = [...this.people.keys()].sort();
		const seatedHostOf = person => this.guestOf(person)?.seat && this.guestOf(person);
		const pilots = names.filter(name => !seatedHostOf(this.people.get(name)));
		const crowd = new Map();

		return new Map(
			names.map(name => {
				// Off to the transporter, or ready by it: its pad
				if ((this.departing?.key === name || (this.readying && this.viewer === name)) && this.layout.transporter)
					return [name, { pose: 'traveler', spot: padAt(this.layout.transporter), room: this.layout.transporter }];

				const person = this.people.get(name);
				const worker = seatedHostOf(person);

				if (!worker) {
					const index = pilots.indexOf(name);
					const seated = other => other?.seat && !other.lounging && !other.leaving;
					// Those whose terminals they have open, or with none open, every grey aboard: all of them are watched
					const open = person.sessions.map(key => this.workers.get(key)).filter(seated);
					const watched = open.length ? open : [...this.workers.values()].filter(seated);

					if (!watched.length) {
						const nav = navAt(this.bridge);

						return [
							name,
							{ pose: 'overseer', spot: { x: nav.x + 0.9 + index * 0.45, y: nav.y + 0.4 }, room: this.bridge },
						];
					}

					// One of them a while, then the next, each pilot on their own turn through them; in the aisle before its
					// island, to its left
					const by = watched[(Math.floor(this.time / MILL_SECONDS) + index) % watched.length];

					return [
						name,
						{
							pose: 'overseer',
							room: by.room,
							spot: { x: by.seat.x - 0.6 - index * 0.4, y: standingOf(this.bridge, by.seat.y) },
							facing: 1,
						},
					];
				}

				const pose = person.role === 'drive' ? 'copilot' : 'tourist';
				const place = `${pose}:${pose === 'copilot' ? worker.session.key : worker.bay.name}`;
				const index = crowd.get(place) ?? 0;

				crowd.set(place, index + 1);

				return [
					name,
					{
						pose,
						room: worker.room,
						spot:
							pose === 'copilot'
								? { x: worker.seat.x + 0.55 + index * 0.4, y: standingOf(this.bridge, worker.seat.y) }
								: { x: worker.seat.x - 0.05 + index * 0.45, y: standingOf(this.bridge, worker.seat.y) },
					},
				];
			}),
		);
	}

	// The grey a guest belongs beside: the first of their sessions seated aboard; none for the owner
	guestOf(person) {
		if (person.role === 'owner') return null;

		return person.sessions
			.map(key => this.workers.get(key))
			.find(worker => worker && !worker.lounging && !worker.leaving);
	}

	// From where a person is to the airlock, or from the airlock to where they belong, by the spine
	viaSpine(from, fromRoom, to, toRoom) {
		const airlock = this.layout.halls[0]?.airlock;
		const lane = this.layout.halls[0]?.lane;
		const out = fromRoom ? exitOf(fromRoom, from, lane) : [{ x: airlock.x, y: lane }];
		const into = toRoom ? [...exitOf(toRoom, to, lane).reverse(), to] : [{ x: airlock.x, y: lane }, airlock];

		return [...out, ...into];
	}

	// Each person comes aboard by the airlock and walks to where they belong, and walks back out when they go; one
	// whose place moved walks there. Whoever was aboard when the ship was first seen, or when the rooms moved round,
	// is put straight in place.
	board() {
		const airlock = this.layout.halls[0]?.airlock;
		const spots = this.spotsOfPeople();

		for (const [name, walker] of this.walkers) {
			if (spots.has(name) || walker.leaving) continue;
			if (!airlock || walker.x === undefined) this.walkers.delete(name);
			else Object.assign(walker, { leaving: true, path: this.viaSpine(walker, walker.room, airlock, null) });
		}

		for (const [name, { pose, spot, room, facing }] of spots) {
			const walker = this.walkers.get(name) ?? { name: this.people.get(name).name, path: [], step: 0, facing: 1 };
			const moved = walker.spot && (walker.spot.x !== spot.x || walker.spot.y !== spot.y);

			walker.person = this.people.get(name);
			walker.leaving = false;
			this.walkers.set(name, walker);

			const placed = walker.x === undefined && (!airlock || !this.answered.size || this.time < ABOARD_SECONDS);

			if (placed || (this.moved && walker.spot)) Object.assign(walker, spot, { path: [] });
			else if (walker.x === undefined)
				Object.assign(walker, airlock, { path: this.viaSpine(airlock, null, spot, room) });
			// Beamed in on the transporter's pad: from there to where they belong
			else if (!walker.spot) walker.path = this.viaSpine(walker, walker.room, spot, room);
			// Along the console to a new seat as others come and go; across the ship to a new place
			else if (moved) walker.path = room === walker.room ? [spot] : this.viaSpine(walker, walker.room, spot, room);
			Object.assign(walker, { spot, pose, room, stand: facing ?? 1 });
		}
	}

	// The person `key` walks onto the transporter's pad, in a hurry, and beams away, `then` called once they're gone;
	// false when there's no transporter or they're not aboard, so they go at once
	beamOut(key, then) {
		if (!this.layout.transporter || !this.walkers.has(key)) return false;
		this.departing = { key, then, since: this.time };
		this.board();
		this.look('transporter');

		return true;
	}

	// The person beams in on the transporter's pad and walks to where they belong: a visitor where this ship's paude
	// doesn't list them
	beamIn(person) {
		const transporter = this.layout.transporter;

		this.away = null;
		if (!this.people.has(person.key)) {
			this.visitor = person;
			this.people = new Map([...this.people, [person.key, { ...person, sessions: [] }]]);
		}
		if (transporter) {
			const pad = padAt(transporter);
			const walker = this.walkers.get(person.key) ?? { name: person.name, person, step: 0, facing: 1 };

			this.walkers.set(person.key, Object.assign(walker, pad, { path: [], spot: null, room: transporter }));
			this.arriving = { key: person.key, at: this.time };
		}
		this.board();
	}

	// One walking to the pad beams out once there (or once they've taken too long), and is gone a beam later
	tendTravel() {
		const going = this.departing;

		if (!going) return;

		const walker = this.walkers.get(going.key);
		// By its kind: the layout's rooms are made anew with each look
		const there = walker && !walker.path.length && walker.room?.kind === 'transporter';

		if (walker && going.beamAt === undefined && (there || this.time - going.since > TRAVEL_MOST))
			going.beamAt = this.beamAt = this.time;
		if (walker && (going.beamAt === undefined || this.time - going.beamAt < BEAM_SECONDS)) return;
		this.away = going.key;
		if (this.visitor?.key === going.key) this.visitor = null;
		this.walkers.delete(going.key);
		this.people.delete(going.key);
		this.departing = null;
		going.then();
	}

	step(seconds, calm) {
		this.time += seconds;
		// The ship under way: space streams past astern, faster the more was delivered in the last hour
		const burning = flowOf(this.tanks.reduce((sum, { rate }) => sum + rate, 0));

		const pace = 1 + (STAR_PACE.most - 1) * burning ** 2;

		this.pace = calm ? pace : this.pace + (pace - this.pace) * Math.min(1, seconds * STAR_PACE.easing);
		if (!calm) this.drift += seconds * STAR_SPEED * this.pace;

		for (const [key, worker] of this.workers) {
			worker.opacity = worker.leaving ? worker.opacity - seconds * 1.5 : Math.min(1, worker.opacity + seconds * 2);
			if (worker.opacity <= 0 && worker.leaving) this.workers.delete(key);
		}

		for (const worker of this.workers.values()) this.tendSmallGreys(worker, calm);
		this.tendCrew(seconds);
		for (const [name, walker] of this.walkers)
			walk(walker, calm ? Infinity : WALK_SPEED * seconds * (this.departing?.key === name || (this.readying && this.viewer === name) ? HURRY : 1), seconds);
		this.tendTravel();
		for (const worker of this.workers.values())
			if (worker.path?.length && (calm || this.time - (worker.madeAt ?? -Infinity) >= MAKE_SECONDS))
				walk(worker, calm ? Infinity : WORKER_SPEED * seconds, seconds);
		for (const [name, walker] of this.walkers) if (walker.leaving && !walker.path.length) this.walkers.delete(name);

		for (const parcel of this.parcels) {
			parcel.step += seconds * 9;
			if (parcel.step >= 0)
				walk(parcel, calm ? Infinity : PARCEL_SPEED * (parcel.tube ? TUBE_PACE : 1) * seconds, seconds);
			if (!parcel.path.length && parcel.legs?.length) Object.assign(parcel, { tube: false }, parcel.legs.shift());
		}
		this.parcels = this.parcels.filter(({ path }) => path.length);
		for (const hauler of this.haulers) hauler.time += seconds / HAUL_SECONDS;
		this.haulers = this.haulers.filter(({ time }) => time < 1);

		const goal = this.goal();

		if (goal) {
			const ease = calm ? 1 : Math.min(1, seconds * EASE);

			this.camera.zoom = goal.zoom;
			for (const measure of ['x', 'y']) this.camera[measure] = mix(this.camera[measure], goal[measure], ease);
		}
	}

	// Read here: its marker goes until something newer comes
	markRead(session) {
		this.read.set(session.key, session.unseen);
	}

	// What the work made sets off from its grey's seat: a reply forward to the pilot; each part (a file newly changed) to
	// its checkout's stack in the hold. Nothing sets off from a grey away from its seat, or before the first answer.
	launch() {
		const hold = this.layout.hold;
		// A reply goes to the pilot wherever they're standing, or to the nav table while nobody is aboard to take it
		const pilot = [...this.walkers.values()].find(({ pose, leaving }) => pose === 'overseer' && !leaving);
		const console = pilot?.spot ?? navAt(this.bridge);
		const consoleRoom = (pilot?.spot && pilot.room) || this.bridge;

		for (const { kind, key, checkout, count = 1 } of this.outgoing) {
			const worker = this.workers.get(key);

			if (!worker?.seat || worker.lounging || !this.answered.size) continue;

			const from = this.placeOf(worker);
			const spot = this.cargo.findIndex(({ key: other }) => other === checkout);
			const to = kind === 'reply' ? console : hold && spot >= 0 && holdSpotAt(hold, spot);

			if (!to) continue;

			// A part from the bridge goes by the tube: a few steps to its station, through it, and from its hopper down
			// onto its stack
			const tube = kind !== 'reply' && worker.room === this.bridge && this.layout.tube;

			for (let index = 0; index < count; index++)
				this.parcels.push({
					kind,
					hue: worker.session.hue,
					...from,
					path: tube
						? this.route(from, worker.room, tube.inlet, this.bridge)
						: this.route(from, worker.room, to, kind === 'reply' ? consoleRoom : hold),
					legs: tube ? [{ path: tube.points.slice(1), tube: true }, { path: [to] }] : [],
					step: -index * 4,
				});
		}
		this.outgoing = [];
	}

	needs(session) {
		if (session.status === 'waiting') return 'asking';

		return session.unseen > (this.read.get(session.key) ?? 0) ? 'unread' : null;
	}

	// Each frame: the sky and its stars on the screen, then the world in art pixels, every one a square of `zoom`
	// screen pixels
	draw(ctx, ratio = 1) {
		this.hits = [];
		ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
		ctx.imageSmoothingEnabled = false;
		ctx.fillStyle = '#07090f';
		ctx.fillRect(0, 0, this.width, this.height);

		const size = this.camera.zoom;

		for (const star of this.stars) {
			const on = Math.sin(this.time * 1.3 + star.phase) > -0.4;
			const x =
				Math.round(((((star.x - this.drift * star.depth) % this.width) + this.width) % this.width) / size) * size;
			const y = Math.round(star.y / size) * size;

			ctx.fillStyle = (!on && '#434d61') || (star.depth > 0.7 && '#c3cad6') || '#77829a';
			ctx.fillRect(x, y, size, size);
			if (star.big && on) {
				ctx.fillRect(x - size, y, size * 3, size);
				ctx.fillRect(x, y - size, size, size * 3);
			}
		}

		// Only stars until the first answer
		if (!this.answered.size) return;

		const { x, y } = this.offset;

		ctx.setTransform(size * ratio, 0, 0, size * ratio, x * ratio, y * ratio);

		const art = point => this.art(point);
		const label = (text, at, options) => this.labels.push({ text, at, ...options });
		const standing = [];
		const working = key => this.workers.get(key)?.session.status === 'working';
		const running = this.bays.some(bay => bay.sessions.some(working));
		const sessions = this.sessions;
		const masts = [...this.systems.values()]
			.filter(({ key }) => key.startsWith('mcp:'))
			.map(system => ({
				...system,
				color: `hsl(${system.hue} 75% 64%)`,
				dim: `hsl(${system.hue} 20% 28%)`,
				faulty: system.failures > 0,
			}));
		this.labels = [];
		drawHull(ctx, this.layout, {
			time: this.time,
			// The sky's stream in art pixels, so the window's stars move with the sky's
			drift: this.drift / this.camera.zoom,
			tanks: this.tanks,
			engines: this.engines.map((engine, index) => ({
				y: this.thrusterAt(index),
				hue: engine.hue ?? 215,
				thrust: Math.min(
					1,
					sessions.filter(session => session.engine.key === engine.key && session.status === 'working').length / 3,
				),
				limited: Boolean(engine.limit),
			})),
			comms: {
				active: Boolean(this.systems.get('dish')?.active),
				hue: `hsl(${accentOf('dish')} 75% 64%)`,
				masts,
			},
			hangarOpen: this.haulers.length > 0,
			sections: this.sectionsOfHull(),
			// The plumes as long as the stars are fast
			pace: 1 + ((this.pace - 1) * 3) / (STAR_PACE.most - 1),
		});
		for (const mast of masts)
			if (mast.at) this.hits.push({ ...this.toScreen(mast.at), r: 6 * this.camera.zoom, kind: 'system', system: mast });
		for (const tank of this.tanks)
			if (tank.at) this.hits.push({ ...this.toScreen(tank.at), r: 9 * this.camera.zoom, kind: 'fuel', tank });

		clipToShip(ctx, this.layout);
		const movers = [...this.walkers.values(), ...[...this.workers.values()].filter(worker => this.walking(worker))];
		const near = door => movers.some(mover => Math.hypot(mover.x - door.x, mover.y - door.y) < 0.9);

		for (const hall of this.layout.halls) {
			const doors = hall.airlock ? [{ ...hall.airlock, open: near(hall.airlock), lamp: PALETTE.r }] : [];
			// Through the rooms, no walls
			const gaps = this.layout.rooms.map(room => ({
				from: art({ x: room.x, y: 0 }).x,
				to: art({ x: room.x + room.w, y: 0 }).x,
			}));

			standing.push(...drawHall(ctx, art, hall, { doors, time: this.time, running, gaps }));
		}
		standing.push(
			...drawEngineering(ctx, art, label, this.layout.engineering, {
				time: this.time,
				systems: Object.values(this.layout.systems),
				engines: this.engines.map((engine, index) => {
					const tank = this.tanks.findIndex(({ engines }) => engines.includes(engine));

					return {
						...engine,
						thruster: this.thrusterAt(index),
						working: sessions.filter(session => session.engine.key === engine.key && session.status === 'working')
							.length,
						outage: engine.limit ? countdown(engine.limit.resetAt, Date.now()) : undefined,
						feed:
							tank < 0
								? undefined
								: {
										tank,
										below: tank % 2 === 1,
										x: this.tanks[tank].at?.x,
										color: TANK_COLORS[tank % TANK_COLORS.length],
									},
					};
				}),
				recycling: [...this.workers.values()].some(
					worker => this.time - (worker.compactedAt ?? -Infinity) < COMPACT_SECONDS,
				),
				zoom: this.camera.zoom,
			}),
		);
		for (const engine of this.engines) {
			const at = this.art(engine.reactor);

			this.hits.push({
				...this.toScreen({ x: at.x, y: at.y - 11 }),
				r: 12 * this.camera.zoom,
				kind: 'engine',
				engine,
			});
		}
		for (const room of Object.values(this.layout.systems)) {
			const system = this.systemOf(room) ?? { active: false, load: 0, failures: 0 };
			const panel = this.art(panelAt(room));

			this.hits.push({
				...this.toScreen({ x: panel.x, y: panel.y - 10 }),
				r: 6 * this.camera.zoom,
				kind: 'log',
				room,
				system,
			});
			stockAt(room, system.uses).forEach((spot, index) => {
				const at = this.art(spot);
				const use = system.log?.[index];

				if (use)
					this.hits.push({
						...this.toScreen({ x: at.x, y: at.y - 4 }),
						r: 4 * this.camera.zoom,
						kind: 'use',
						use,
						room,
					});
			});

			standing.push(
				...drawSystem(ctx, art, label, room, {
					time: this.time,
					system: { ...system, hue: accentOf(room.key), masts: room.key === 'dish' ? masts : undefined },
				}),
			);
		}
		if (this.layout.materializer)
			standing.push(
				...drawMaterializer(ctx, art, label, this.layout.materializer, {
					time: this.time,
					charge: this.charged ? 1 : 0,
				}),
			);
		if (this.layout.transporter) {
			const beam = (this.time - this.beamAt) / BEAM_SECONDS;

			standing.push(
				...drawTransporter(ctx, art, label, this.layout.transporter, {
					time: this.time,
					ships: this.fleet,
					beaming: beam >= 0 && beam < 1 ? beam : null,
				}),
			);
		}
		if (this.layout.hold) standing.push(...drawHold(ctx, art, label, this.layout.hold));
		if (this.layout.hangar)
			standing.push(
				...drawHangar(ctx, art, label, this.layout.hangar, {
					time: this.time,
					hauler: !this.haulers.length,
					journey: this.journey,
				}),
				...this.deliveryParts(ctx),
			);
		standing.push(...this.crewParts(ctx));
		for (const bay of this.bays) {
			this.drawBayOfMachine(ctx, bay);
			standing.push(...this.machineParts(ctx, bay));
			this.bayHits(bay);
		}
		if (this.bridge) standing.push(...this.bridgeParts(ctx, art, label));
		if (this.lounge) standing.push(...drawLounge(ctx, art, label, this.lounge, { time: this.time }));
		for (const room of this.layout.rooms.filter(({ kind }) => kind))
			this.hits.push({
				...this.screen({ x: room.x + room.w / 2, y: room.y + room.d / 2 }),
				area: this.area(room),
				kind: room.kind === 'system' ? 'system' : room.kind,
				room,
				system: room.kind === 'system' ? this.systemOf(room) : undefined,
			});
		this.drawConduits(ctx, this.layout.halls[0]);
		this.cables = this.conduitsOf();
		this.fed = this.feedsOf();
		this.drawTerminalCables(ctx);
		for (const { lane } of this.layout.halls)
			standing.push({ y: lane - 0.24, draw: () => this.drawTerminalCables(ctx, { trays: lane }) });
		standing.push(...this.inspectionParts(ctx));
		this.drawMats(ctx);
		standing.push(...this.cargoParts(ctx));
		for (const worker of this.workers.values()) if (worker.seat) standing.push(...this.workerParts(ctx, worker));
		standing.push(...this.tubeParts(ctx));
		for (const parcel of this.parcels)
			standing.push({ y: parcel.tube ? TUBE_FRONT : parcel.y, draw: () => this.drawParcel(ctx, parcel) });

		for (const thing of standing.sort((a, b) => a.y - b.y)) thing.draw();
		this.light(ctx, working, running);
		// Lit, so laid over the light
		this.drawPathways(ctx);
		// Whoever's aboard over everything, as a game draws its people over the scenery: the bridge's aisles are too narrow
		// to clear the consoles and screens about them
		for (const walker of this.walkers.values()) if (walker.x !== undefined) this.drawWalker(ctx, walker);
		this.drawSelection(ctx);
		ctx.restore();
		for (const hauler of this.haulers) this.drawHauler(ctx, hauler);
		for (const worker of this.workers.values()) if (worker.seat) this.drawMarker(ctx, worker);
		this.drawLabels(ctx, ratio);
	}

	light(ctx, working, running) {
		const { building, halls } = this.layout;

		if (!building) return;

		const WARM = [255, 228, 186];
		const IDLE = [120, 140, 196];
		const box = (room, color, level, deep = FACE) => ({
			from: this.art(room),
			to: this.art({ x: room.x + room.w, y: room.y + room.d }),
			face: Math.round((room.hull?.top ? HULL_FACE : deep) * UNIT.y),
			color,
			level,
		});
		const tinted = (hue, warmth = 0.7) => {
			const color = hue === null || hue === undefined ? WARM : lightOf(hue, 50, 72);

			return color.map((part, index) => Math.round(WARM[index] * warmth + part * (1 - warmth)));
		};
		const rooms = [];
		const lights = [];
		const pools = [];

		for (const hall of halls) {
			rooms.push(box(hall, IDLE, 0.45, HALL_FACE));
			for (let x = hall.x + 1.2; x < hall.x + hall.w - 0.5; x += 2.4) {
				const at = this.art({ x, y: hall.y + hall.d * 0.6 });

				pools.push({ ...at, r: 18, deep: 0.45, color: WARM, strength: running ? 0.35 : 0.22 });
			}
		}
		for (const bay of this.bays) {
			const sessions = bay.sessions.map(key => this.workers.get(key)?.session).filter(Boolean);
			const busy = bay.sessions.some(working);
			const asking = sessions.some(session => this.needs(session) === 'asking');
			const pulse = 0.75 + 0.25 * Math.sin(this.time * 4);
			const room = this.layout.bays?.find(({ name }) => name === bay.name);

			// A project's machine lights itself: a glow from each housing, its color while it runs, amber while one asks,
			// low while it waits; no lamps over a floor that isn't there
			if (room?.parts) {
				room.parts.forEach(part => {
					const housing = housingOf(part);
					const at = this.art({ x: housing.middle, y: (part.y + housing.floor) / 2 });

					lights.push({
						...at,
						r: 34,
						color: (asking && [255, 176, 70]) || (busy && lightOf(bay.hue ?? 200, 60, 66)) || [110, 130, 175],
						strength: (asking && pulse) || (busy && 0.9) || (sessions.length ? 0.45 : 0.25),
						moving: asking,
					});
				});
				continue;
			}
			if (asking) rooms.push({ ...box(bay, [255, 176, 70], pulse), moving: true });
			else if (busy) rooms.push(box(bay, tinted(bay.hue), 1));
			else rooms.push(box(bay, IDLE, sessions.length ? 0.4 : 0.2));
		}
		for (const room of Object.values(this.layout.systems)) {
			const active = this.systemOf(room)?.active;

			rooms.push(box(room, active ? lightOf(accentOf(room.key), 55, 70) : IDLE, active ? 0.95 : 0.35));
		}
		const engineering = this.layout.engineering;

		if (engineering) rooms.push(box(engineering, running ? WARM : IDLE, running ? 0.55 : 0.3));
		if (this.bridge) {
			rooms.push(box(this.bridge, [170, 200, 255], this.people.size ? 0.95 : 0.45));
			if (this.layout.hangar?.log)
				lights.push({ ...this.layout.hangar.log, r: 22, color: [255, 190, 90], strength: 0.6 });
		}
		if (this.lounge) rooms.push(box(this.lounge, [255, 186, 140], 0.5));
		if (this.layout.materializer)
			rooms.push(box(this.layout.materializer, this.charged ? [120, 240, 220] : IDLE, this.charged ? 0.9 : 0.35));
		for (const room of [this.layout.hold, this.layout.hangar].filter(Boolean))
			rooms.push(box(room, [255, 214, 160], 0.5));
		// The transporter lit always, violet, its pad glowing, so the way to the other ships is never in the dark
		if (this.layout.transporter) {
			rooms.push(box(this.layout.transporter, [200, 170, 255], 0.9));
			lights.push({ ...this.art(clonerAt(this.layout.transporter)), r: 26, color: [190, 160, 255], strength: 0.7 });
		}

		for (const worker of this.workers.values()) {
			if (!worker.seat || worker.lounging || this.walking(worker)) continue;

			const at = this.art({ x: worker.seat.x, y: worker.seat.y + 0.2 });
			const { status } = worker.session;
			const asking = this.needs(worker.session) === 'asking';
			const glow = { x: at.x - 8, y: at.y - 16 };

			if (status === 'stopped' || !glow) continue;
			lights.push({
				x: glow.x,
				y: glow.y,
				r: status === 'working' || asking ? 26 : 16,
				color: (asking && [255, 190, 80]) || (status === 'working' && [150, 215, 255]) || [110, 130, 175],
				strength: status === 'working' || asking ? 0.8 : 0.35,
			});
		}
		for (const engine of this.engines) {
			const at = this.art(engine.reactor);
			const flicker = engine.limit && Math.floor(this.time * 7) % 3 === 0;

			lights.push({
				x: at.x,
				y: at.y - 11,
				r: 42,
				color: engine.limit ? [220, 70, 60] : lightOf(engine.hue ?? 215, 70, 66),
				strength: (engine.limit && (flicker ? 0.15 : 0.55)) || (running ? 0.95 : 0.6),
				moving: Boolean(engine.limit),
			});
		}
		if (this.lounge) {
			const at = this.art({ x: this.lounge.x + (this.lounge.w - 0.9) / 2, y: this.lounge.y + FACE + 1.75 });
			const show = Math.floor(this.time / 4) % 3;

			lights.push({
				x: at.x,
				y: at.y - 12,
				r: 34,
				color: [
					[120, 170, 255],
					[150, 230, 140],
					[255, 130, 160],
				][show],
				strength: 0.7,
			});
		}
		if (this.layout.materializer && this.charged) {
			const at = this.art(clonerAt(this.layout.materializer));

			lights.push({ x: at.x, y: at.y - 14, r: 30, color: [120, 255, 230], strength: 0.9 });
		}

		const [from, to] = [
			this.art({ x: building.left, y: building.top }),
			this.art({ x: building.right, y: building.bottom }),
		];

		drawLighting(ctx, { left: from.x, top: from.y, right: to.x, bottom: to.y }, { rooms, pools, lights });
	}

	// Corner brackets round what's selected (a worker at its seat, a deck, engineering for an engine, the bridge or the
	// materializer), pulsing a little; one resting on a couch both there and at the terminal it left
	drawSelection(ctx) {
		for (const box of this.selectionBoxes()) this.drawBrackets(ctx, box);
	}

	selectionBoxes() {
		const { selected } = this;

		if (!selected) return [];

		const [kind, ...rest] = selected.split(':');
		const name = rest.join(':');
		const around = room =>
			room && { from: this.art(room), to: this.art({ x: room.x + room.w, y: room.y + room.d }), inset: 2 };
		const atSeat = seat => {
			const at = this.art(seat);

			return { from: { x: at.x - 19, y: at.y - 40 }, to: { x: at.x + 19, y: at.y + 3 }, inset: 0 };
		};
		const boxes = [];

		if (kind === 'bay') boxes.push(around(this.bays.find(bay => bay.name === name)));
		else if (kind === 'engine') boxes.push(around(this.layout.engineering));
		else if (kind === 'room') boxes.push(around(name === 'bridge' ? this.bridge : this.layout.materializer));
		else if (kind === 'worker') {
			const worker = this.workers.get(name);

			if (worker?.seat && !worker.lounging)
				boxes.push(atSeat(this.walking(worker) ? worker : { x: worker.seat.x, y: worker.seat.y + 0.2 }));
			else if (worker?.lounging) {
				const at = this.art(this.placeOf(worker));

				boxes.push({ from: { x: at.x - 9, y: at.y - 24 }, to: { x: at.x + 9, y: at.y + 2 }, inset: 0 });
				if (worker.homeSeat) boxes.push(atSeat({ x: worker.homeSeat.x, y: worker.homeSeat.y + 0.2 }));
			}
		}
		return boxes.filter(Boolean);
	}

	drawBrackets(ctx, box) {
		const grow = Math.floor(this.time * 3) % 2;
		const [left, top] = [box.from.x + box.inset - grow, box.from.y + box.inset - grow];
		const [right, bottom] = [box.to.x - box.inset + grow, box.to.y - box.inset + grow];
		const arm = 5;

		for (const [x, y, across, down] of [
			[left, top, 1, 1],
			[right, top, -1, 1],
			[left, bottom, 1, -1],
			[right, bottom, -1, -1],
		]) {
			rect(ctx, across > 0 ? x : x - arm + 1, y, arm, 1, PALETTE.t);
			rect(ctx, x, down > 0 ? y : y - arm + 1, 1, arm, PALETTE.t);
		}
	}

	// Each project's section as its hull shows it: where it runs, its color, and whether it's at work, asking, or idle
	sectionsOfHull() {
		return (this.layout.bays ?? []).map(room => {
			const bay = this.bays.find(({ name }) => name === room.name);
			const sessions = (bay?.sessions ?? []).map(key => this.workers.get(key)?.session).filter(Boolean);

			const housings = room.parts.map(part => ({ ...housingOf(part), top: part.hull.top, bottom: part.hull.bottom }));

			return {
				name: room.name,
				short: room.short,
				housings,
				from: room.x,
				to: room.x + room.w,
				side: (room.hull.top && 'top') || (room.hull.bottom && 'bottom') || 'inner',
				hue: bay?.hue ?? null,
				idle: !sessions.length,
				working: sessions.some(({ status }) => status === 'working'),
				asking: sessions.some(session => this.needs(session) === 'asking'),
			};
		});
	}

	// A project's section is no room: the dark of the ship's insides around its machine, girders at its ends, ribs of
	// the hull across its back
	drawBayOfMachine(ctx, bay) {
		for (const part of bay.parts) {
			const [from, to] = [this.art(part), this.art({ x: part.x + part.w, y: part.y + part.d })];

			rect(ctx, from.x, from.y, to.x - from.x, to.y - from.y, '#080b11');
			for (let x = from.x + 6; x < to.x - 2; x += 10) rect(ctx, x, from.y, 1, to.y - from.y, '#0e121a');
			for (let y = from.y + 7; y < to.y; y += 14) rect(ctx, from.x, y, to.x - from.x, 1, '#0e121a');
		}

		const [top, bottom] = [this.art({ x: 0, y: bay.y }).y, this.art({ x: 0, y: bay.y + bay.d }).y];

		for (const x of [this.art({ x: bay.x, y: 0 }).x, this.art({ x: bay.x + bay.w, y: 0 }).x - 3]) {
			rect(ctx, x, top, 3, bottom - top, PALETTE.k);
			rect(ctx, x + 1, top, 1, bottom - top, PALETTE.m);
			for (let y = top + 4; y < bottom; y += 8) rect(ctx, x, y, 3, 1, PALETTE.d);
		}
	}

	// A project's machine on its deck, sockets lit where its workers are jacked in; how it runs from how its sessions
	// are doing
	machineParts(ctx, bay) {
		const sessions = bay.sessions.map(key => this.workers.get(key)?.session).filter(Boolean);
		const state =
			(sessions.some(({ status }) => status === 'working') && 'working') || (sessions.length ? 'ready' : 'idle');
		const asking = sessions.some(session => this.needs(session) === 'asking');
		const form = FORMS[cksum(`form|${bay.name}`) % FORMS.length];
		const tested = Ship.worstVerdict(sessions);
		const verdict = VERDICT_COLORS[tested];
		const checkouts = this.cargo.filter(({ project }) => project === bay.name);
		const pressure = checkouts.reduce((sum, { unpushed = 0 }) => sum + unpushed, 0);
		const changed = checkouts.reduce((sum, { changed: count = 0 }) => sum + count, 0);
		const pullRequest = checkouts.find(({ pullRequest: pr }) => pr?.state === 'OPEN')?.pullRequest;
		const character = this.bays.find(({ name }) => name === bay.name)?.character ?? bay.character ?? {};
		// A socket for each of its sessions, alternately down its left and its right, lit while that one's grey is at
		// its terminal on the bridge, wired in
		const count = bay.sessions.length;
		const decks = bay.parts.map(part => {
			const housing = housingOf(part);
			const sockets = {
				left: Array(Math.max(1, Math.ceil(count / 2))).fill(false),
				right: Array(Math.max(1, Math.floor(count / 2))).fill(false),
			};

			bay.sessions.forEach((key, index) => {
				if (this.wired(this.workers.get(key))) (index % 2 ? sockets.right : sockets.left)[Math.floor(index / 2)] = true;
			});

			return { part, housing, sockets, upper: part.hull.top };
		});

		// Where its sockets are, kept from the last frame for the cables drawn before it
		bay.built ??= [];

		return [
			...decks.map(({ part, housing, sockets, upper }, deck) => ({
				y: housing.floor - 0.3,
				draw: () => {
					if (deck === 0)
						this.labels.push({
							text: bay.name,
							at: this.art({ x: housing.middle, y: part.y + 0.3 }),
							color: bay.hue === null ? PALETTE.w : `hsl(${bay.hue} 60% 74%)`,
							align: 'center',
							size: 1,
							lift: 4,
							width: housing.w * UNIT.x + 8,
						});
					bay.built[deck] = drawHousing(ctx, point => this.art(point), housing, {
						top: this.art({ x: 0, y: part.y + 0.3 }).y,
						form,
						hue: bay.hue,
						state,
						asking,
						time: this.time,
						seed: seeded(bay.name),
						upper,
						folders: character.folders,
						history: character,
						changed,
						pullRequest,
						sockets,
						verdict,
						tested,
						pressure,
						fed: this.fed?.get(bay.name) ?? [],
					});
					// On more than one engine, a light in each one's color by its name
					if (deck === 0 && bay.engines.length > 1) {
						const top = this.art({ x: housing.middle, y: part.y + 0.3 });

						bay.engines.forEach(({ hue }, index) => {
							const x = Math.round(top.x - bay.engines.length * 3.5 + index * 7);

							rect(ctx, x, top.y + 1, 6, 5, PALETTE.k);
							rect(ctx, x + 1, top.y + 2, 4, 3, `hsl(${hue ?? 215} 75% 66%)`);
						});
					}
				},
			})),
		];
	}

	// A grey at its terminal on the bridge, so wired into its project's machine
	wired(worker) {
		return Boolean(worker?.seat && worker.room === this.bridge && !worker.lounging && !this.walking(worker));
	}

	// Where each project's conduit runs, in art pixels: from its islands on the bridge out through the bridge's aft wall,
	// along its own lane under the spine to its machine, thicker the more of its sessions are wired in; lanes far enough
	// apart that the heaviest don't touch, each with its own riser up the bridge's aft wall, so no two run over each
	// other
	conduitsOf() {
		const conduits = new Map();

		if (!this.layout.halls.length || !this.bridge) return conduits;

		const wall = this.art({ x: this.bridge.x, y: 0 }).x;
		const wired = this.bays
			.map(bay => ({
				bay,
				machine: bay.built?.[0],
				workers: bay.sessions.map(key => this.workers.get(key)).filter(worker => this.wired(worker)),
			}))
			.filter(({ machine, workers }) => machine && workers.length);
		// The same as last frame's while the layout, the machines' places and who's wired in stand
		const key = wired
			.map(({ bay, machine: { from, to, top, floor, socket }, workers }) =>
				[bay.name, from, to, top, floor, socket(1, 0).y, ...workers.map(({ session }) => session.key)].join(':'),
			)
			.join('|');

		if (this.conduits?.layout === this.layout && this.conduits.key === key) return this.conduits.map;
		// Each its own lane along its level's spine, nearer the machines the nearer its machine is to the bridge: those
		// over the spine from the top lane down, those under it from the bottom up, so no conduit's drop into its
		// machine crosses a longer one running on past it
		const lanes = new Map();

		for (const hall of new Set(wired.map(({ bay }) => bay.lane))) {
			const spine = this.art({ x: 0, y: hall }).y;
			const inHall = wired.filter(({ bay }) => bay.lane === hall).sort((a, b) => b.machine.to - a.machine.to);
			const over = inHall.filter(({ machine }) => machine.floor <= spine);
			const under = inHall.filter(({ machine }) => machine.floor > spine);

			over.forEach(({ bay }, index) => lanes.set(bay.name, index));
			under.forEach(({ bay }, index) => lanes.set(bay.name, inHall.length - 1 - index));
		}

		const routes = wired.map(({ bay, machine, workers }) => {
			const lane = lanes.get(bay.name);
			const tray = this.art({ x: 0, y: bay.lane }).y - 9 + lane * 8;
			// Into its sides at the end nearer the spine: by its foot when the spine runs under it, by its top socket
			// when over it, so nothing climbs the machine's whole height to reach it
			const height = tray > (machine.top + machine.floor) / 2 ? machine.floor - 3 : machine.socket(1, 0).y;
			const exit = { x: machine.to, y: height };

			return {
				bay,
				color: bay.hue === null || bay.hue === undefined ? PALETTE.l : `hsl(${bay.hue} 60% 52%)`,
				working: workers.some(({ session }) => session.status === 'working'),
				weight: Math.min(5, 1 + workers.length),
				seed: seeded(bay.name) * TAU,
				tray,
				entry: { x: machine.from - 1, y: height },
				exit,
				out: { x: exit.x + 4 + (lane % 3) * 2, y: exit.y },
				plates: (this.bridge.islands ?? [])
					.filter(({ name }) => name === bay.name)
					.map(island => ({ island, at: this.art({ x: island.x + 0.15, y: island.y + 0.2 }) })),
			};
		});
		const order = this.riserOrder(routes, wall);

		for (const route of routes) conduits.set(route.bay.name, { ...route, riser: wall + 4 + order.indexOf(route) * 6 });
		this.conduits = { layout: this.layout, key, map: conduits };

		return conduits;
	}

	// The order of the conduits' risers along the bridge's aft wall that crosses fewest of their runs: every order tried
	// while there are few, worked out again only when the conduits or where they go change
	riserOrder(routes, wall) {
		const key = routes
			.map(({ bay, tray, out, plates }) =>
				[bay.name, tray, out.x, out.y, ...plates.map(({ at }) => `${at.x},${at.y}`)].join(':'),
			)
			.join('|');

		if (this.risers?.key === key)
			return this.risers.names.map(name => routes.find(({ bay }) => bay.name === name)).filter(Boolean);

		const runs = (route, x) => ({
			across: [
				...route.plates.map(({ at }) => ({ y: at.y, from: Math.min(x, at.x), to: Math.max(x, at.x) })),
				{ y: route.tray, from: Math.min(x, route.out.x), to: Math.max(x, route.out.x) },
			],
			down: [
				...route.plates.map(({ at }) => ({ x, from: Math.min(at.y, route.tray), to: Math.max(at.y, route.tray) })),
				{ x: route.out.x, from: Math.min(route.tray, route.exit.y), to: Math.max(route.tray, route.exit.y) },
			],
		});
		const crossings = ordered => {
			const laid = ordered.map((route, index) => runs(route, wall + 4 + index * 6));
			let count = 0;

			for (const [one, a] of laid.entries())
				for (const [other, b] of laid.entries())
					if (one !== other)
						for (const flat of a.across)
							for (const upright of b.down)
								if (flat.y > upright.from && flat.y < upright.to && upright.x > flat.from && upright.x < flat.to)
									count++;

			return count;
		};
		const permutations = list =>
			list.length <= 1
				? [list]
				: list.flatMap((first, index) =>
						permutations([...list.slice(0, index), ...list.slice(index + 1)]).map(rest => [first, ...rest]),
					);
		// Too many to try every order: the trays nearest the bridge's rows first
		const best =
			routes.length <= 6
				? permutations(routes).reduce(
						(found, ordered) => {
							const count = crossings(ordered);

							return count < found.count ? { ordered, count } : found;
						},
						{ ordered: routes, count: Infinity },
					).ordered
				: [...routes].sort((a, b) => a.tray - b.tray);

		this.risers = { key, names: best.map(({ bay }) => bay.name) };

		return best;
	}

	// The projects' conduits, a pulse riding each while any of its sessions works: drawn under everything, as they run
	// along the floor and behind the hull's frames; and again (`trays`) their runs over the bridge's wall and the spine's
	// catwalk, laid over what's there
	drawTerminalCables(ctx, { trays } = {}) {
		for (const { bay, color, weight, working, seed, tray, riser, exit, out, plates } of this.cables.values()) {
			const style = { color, weight, working, seed };

			if (trays !== undefined) {
				if (bay.lane === trays)
					this.drawWire(
						ctx,
						[
							{ x: riser, y: tray },
							{ x: out.x, y: tray },
						],
						style,
					);
				continue;
			}
			for (const { at } of plates)
				this.drawWire(
					ctx,
					this.clearOfLounge([at, { x: riser, y: at.y }, { x: riser, y: tray }], this.besideOf(riser)),
					style,
				);
			this.drawWire(ctx, [{ x: riser, y: tray }, { x: out.x, y: tray }, out, exit], style);
		}
	}

	// A wire along axis-aligned points, a pulse running it from the first to the last while `working`
	drawWire(ctx, points, { color, working, seed, weight = 1 }) {
		let length = 0;
		const half = Math.floor(weight / 2);

		for (const [shade, grow] of [
			[PALETTE.k, 1],
			[color, 0],
		])
			for (let at = 1; at < points.length; at++) {
				const [from, to] = [points[at - 1], points[at]];
				const [x, y] = [
					Math.round(Math.min(from.x, to.x)) - half - grow,
					Math.round(Math.min(from.y, to.y)) - half - grow,
				];

				rect(
					ctx,
					x,
					y,
					Math.round(Math.abs(to.x - from.x)) + weight + grow * 2,
					Math.round(Math.abs(to.y - from.y)) + weight + grow * 2,
					shade,
				);
			}
		for (let at = 1; at < points.length; at++)
			length += Math.abs(points[at].x - points[at - 1].x) + Math.abs(points[at].y - points[at - 1].y);
		if (!working) return;

		let left = (((this.time * 60 + seed * 40) % length) + length) % length;

		for (let at = 1; at < points.length; at++) {
			const [from, to] = [points[at - 1], points[at]];
			const span = Math.abs(to.x - from.x) + Math.abs(to.y - from.y);

			if (left <= span) {
				const t = span ? left / span : 0;

				rect(
					ctx,
					Math.round(from.x + (to.x - from.x) * t) - half,
					Math.round(from.y + (to.y - from.y) * t) - half,
					Math.max(2, weight),
					Math.max(2, weight),
					PALETTE.W,
				);
				return;
			}
			left -= span;
		}
	}

	bayHits(bay) {
		const middle = this.screen({ x: bay.x + bay.w / 2, y: bay.y + bay.d / 2 });

		this.hits.push({ ...middle, area: this.area(bay), kind: 'bay', bay });
	}

	// The worker at its seat, the console's front hiding its legs
	workerParts(ctx, worker) {
		const { session, seat } = worker;
		const facility = facilityOf(session.tool);
		const working = session.status === 'working';
		const screen = screenOf(session);

		const walker = this.walking(worker) ? [{ y: worker.y, draw: () => this.drawWorker(ctx, worker) }] : [];

		if (worker.lounging)
			return [...(walker.length ? walker : this.loungerParts(ctx, worker)), ...this.homeSeatParts(ctx, worker)];
		const engineColor = `hsl(${session.engine.hue ?? 215} 45% 50%)`;
		const at = this.art({ x: seat.x, y: seat.y + 0.2 });
		const checkout = this.checkoutOf(session);
		const branch = checkout && !checkout.trunk ? checkout.branch && branchHue(checkout.branch) : undefined;
		// Its terminal says what it's at, or what needs you, in place of a badge over its head: news while there's
		// something new it hasn't been looked at for
		const status = !working && this.needs(session) === 'unread' ? { ...screen, kind: 'news' } : screen;

		this.hits.push({
			...this.toScreen({ x: at.x - 7, y: at.y - 21 }),
			r: 8 * this.camera.zoom,
			kind: 'monitor',
			worker,
		});

		return [
			...(walker.length ? walker : [{ y: seat.y - 0.12, draw: () => this.drawWorker(ctx, worker) }]),
			...this.smallGreyParts(ctx, worker),
			{ y: seat.y - 0.35, draw: () => this.drawProcesses(ctx, worker) },
			...(keepingOf(session) && !walker.length
				? [{ y: seat.y + 0.2, draw: () => this.drawPick(ctx, worker, at) }]
				: []),
			{
				y: seat.y + 0.16,
				draw: () => {
					const pins = Math.min(4, session.talk?.open ?? 0);

					for (let pin = 0; pin < pins; pin++) {
						rect(ctx, at.x - 15 + pin * 3, at.y - 30, 2, 2, PALETTE.r);
						rect(ctx, at.x - 15 + pin * 3, at.y - 28, 1, 1, PALETTE.w);
					}
					if (this.spoke(session, 'Claude'))
						this.drawSpeech(
							ctx,
							{ x: worker.headX ?? at.x, y: (worker.top ?? at.y) - 2 },
							session,
							this.needs(session) ? -1 : 1,
						);
				},
			},
			{
				y: seat.y + 0.14,
				draw: () => {
					drawSeat(ctx, at, {
						screen: status,
						engineColor,
						time: this.time,
						seed: worker.seed,
						branch,
						todos: session.todos,
						frost: session.status === 'ready' && session.context?.warm === false,
					});
					if (working && session.tool && worker.opacity >= 1) this.drawActivity(ctx, worker, facility, at);
					if (worker.opacity >= 1) this.drawInstruments(ctx, worker, at);
				},
			},
		];
	}

	// The bridge: each project's island, its console striped in the project's color and pressable as the project; the
	// shipping bay's log and the materializer pressable
	bridgeParts(ctx, art, label) {
		const bridge = this.bridge;
		const islands = (bridge.islands ?? []).map(island => ({
			y: island.y + 0.139,
			draw: () => {
				const from = this.art({ x: island.x, y: island.y + 0.2 });
				const to = this.art({ x: island.x + island.w, y: 0 });
				const color = island.hue === null || island.hue === undefined ? PALETTE.l : `hsl(${island.hue} 55% 50%)`;

				drawIsland(ctx, { from: from.x, to: to.x, y: from.y }, { color });

				const bay = this.bays.find(({ name }) => name === island.name);

				// Beneath anything on it, over the bridge itself
				if (bay)
					this.hits.push({
						area: this.area({ x: island.x, y: island.y - 0.8, w: island.w, d: 1 }),
						r: ISLAND_HIT,
						kind: 'bay',
						bay,
					});
			},
		}));

		if (this.layout.materializer) {
			const cloner = this.art(clonerAt(this.layout.materializer));

			this.hits.push({ ...this.toScreen({ x: cloner.x, y: cloner.y - 14 }), r: 12 * this.camera.zoom, kind: 'cloner' });
			if (this.camera.zoom >= 4) label('new session', cloner, { color: PALETTE.t, align: 'center', size: 1, gap: 6 });
		}

		const log = this.layout.hangar?.log;

		if (log) this.hits.push({ ...this.toScreen(log), r: 8 * this.camera.zoom, kind: 'journey', journey: this.journey });

		return [
			...islands,
			...drawBridge(ctx, art, label, bridge, {
				time: this.time,
				plans: Boolean(this.systems.get('tower')?.active),
			}),
		];
	}

	// Where an engine's thruster sits on the stern, in art pixels down: the engines spread evenly down the hull and
	// centered on it, a lone one at its middle, wherever their reactors stand inside
	thrusterAt(index) {
		const { top, bottom } = this.layout.building;

		return this.art({ x: 0, y: top + ((bottom - top) * (index + 0.5)) / Math.max(1, this.engines.length) }).y;
	}

	// The system in a system's room, as its own engine has it
	systemOf(room) {
		return this.engineSystems.get(`${room.engine}/${room.key}`);
	}

	// Each shared system in use lights a pathway from its room to each grey using it, packets running in the system's
	// color, laid over everything so it can be followed end to end: from the engine bay through the project's machine and
	// conduit to the grey's island; the web from the bridge's dish, plans from the nav table, other tools from the hold.
	drawPathways(ctx) {
		const sourceOf = (key, engine) =>
			({ tower: this.bridge, outpost: this.layout.hold })[key] ?? this.layout.systems[`${engine}/${key}`];
		const lanes = STREAM_LANES;

		if (this.layout.halls[0]?.lane === undefined) return;

		const paths = [];

		for (const worker of this.workers.values()) {
			const { seat } = worker;
			const stream = this.streamOf(worker);

			if (!seat || !stream) continue;

			const { facility, fade } = stream;
			const key = facility.startsWith('mcp:') ? 'dish' : facility;
			const room = sourceOf(key, worker.session.engine.key);

			if (!room) continue;

			const hue = accentOf(facility);
			// Each system's packets a set step from the others', so streams sharing a conduit take turns along it rather
			// than landing on each other
			const phase = Math.round((lanes.indexOf(key) * PACKET_GAP) / lanes.length);
			const style = { dim: `hsl(${hue} 30% 22%)`, bright: `hsl(${hue} 70% 62%)`, phase };

			const conduit = room.within?.kind === 'engineering' && this.cables?.get(this.bayOf(worker)?.name);
			// Routed again only when where it runs from or to moves
			const inputs = [this.layout, seat, worker.room, key, conduit];
			const last = this.streamPaths.get(worker);
			const routed = last?.inputs.every((input, index) => input === inputs[index])
				? last.routed
				: this.streamRoute(worker, room, lanes, key, conduit);

			this.streamPaths.set(worker, { inputs, routed });
			for (const { track, ports } of routed) paths.push({ track, style, fade, ports });
		}
		// Every stream's line before any of their packets, so where several share a conduit, one's line doesn't hide
		// another's packets and all their colors run along it together
		for (const part of ['line', 'packets'])
			for (const { track, style, fade } of paths) {
				ctx.globalAlpha = fade;
				this.drawPath(ctx, track, style, part);
			}
		for (const { ports, style, fade } of paths)
			for (const port of ports) {
				ctx.globalAlpha = fade;
				rect(ctx, port.x - 1, port.y - 1, 3, 3, PALETTE.k);
				rect(ctx, port.x, port.y, 1, 1, style.bright);
			}
		ctx.globalAlpha = 1;
	}

	// A worker's stream from its system, in art pixels: by way of its project's machine when `conduit`, its two halves
	streamRoute(worker, room, sources, key, conduit) {
		const tech = room.kind === 'system' ? this.throughSystem(room) : null;
		const fed = tech ? [{ track: trackOf(tech.feed), ports: [tech.feed.at(-1)] }] : [];

		if (conduit) {
			const [into, out] = this.throughProject(worker, room, conduit, sources.indexOf(key), tech?.outlet);

			// Into the machine at its intake, and out of its outlet: through it, it lights up rather than being drawn over
			return [
				...fed,
				{ track: trackOf(this.clearOfLounge(into)), ports: [...(tech ? [tech.outlet] : []), into.at(-1)] },
				{ track: trackOf(this.clearOfLounge(out, this.besideOf(conduit.riser))), ports: [out[0]] },
			];
		}

		const lane = this.layout.halls[0].lane;
		const start = key === 'tower' ? navAt(room) : { x: room.door.x, y: room.door.y };
		const end = { x: worker.seat.x - 0.4, y: worker.seat.y - 0.1 };
		const offset = (sources.indexOf(key) - (sources.length - 1) / 2) * 0.09;
		const points = this.clearOfLounge(
			[start, ...this.route(start, room, end, worker.room, lane + offset)].map(point => this.art(point)),
		);

		if (tech)
			return [
				...fed,
				{ track: trackOf([tech.outlet, { x: points[0].x, y: tech.outlet.y }, ...points]), ports: [tech.outlet] },
			];

		return [{ track: trackOf(points), ports: [] }];
	}

	// The system a worker's stream runs from, and how strongly: while it uses one and for a few seconds after, fading, so
	// the gaps between one tool and the next don't blink it off and on
	streamOf(worker) {
		const { session } = worker;

		if (worker.lounging || worker.leaving || this.walking(worker)) return null;
		if (session.status === 'working' && session.tool) {
			worker.stream = { facility: facilityOf(session.tool), at: this.time };

			return { facility: worker.stream.facility, fade: 1 };
		}

		const since = this.time - (worker.stream?.at ?? -Infinity);

		return since < STREAM_LINGER ? { facility: worker.stream.facility, fade: 1 - since / STREAM_LINGER } : null;
	}

	bayOf(worker) {
		return this.bays.find(bay => bay.sessions.includes(worker.session.key));
	}

	// From an engine-bay system to a worker, in art pixels, by way of its project's machine and conduit (`conduit`), the
	// system's own riser up the engine bay's wall (the `nth` system): into the machine, and out of it
	// A stream's way through its engine's tech, in art pixels: from the reactor's side out along its bus, up or down the bus
	// to the system's main, along it and down its drop into the unit (`feed`), and out at the unit's foot (`outlet`),
	// which lights up between
	throughSystem(room) {
		const engine = this.engines.find(({ key }) => key === room.engine);
		const at = this.art(systemFootOf(room));
		const main = this.art({ x: 0, y: room.y }).y + 7;
		const across = this.art({ x: room.feed ?? room.x, y: 0 }).x;
		const reactor = engine ? this.art(engine.reactor) : null;
		const core = reactor ? reactor.y - 11 : main;

		return {
			feed: [
				...(reactor ? [{ x: reactor.x + REACTOR_SIDE, y: core }] : []),
				{ x: across, y: core },
				{ x: across, y: main },
				{ x: at.x, y: main },
				{ x: at.x, y: at.y - systemTallOf(room) },
			],
			outlet: { x: at.x, y: at.y + 2 },
		};
	}

	throughProject(worker, room, conduit, nth, outlet) {
		const door = this.art({ x: room.door.x, y: room.door.side === 'bottom' ? room.y + room.d : room.y + FACE });
		const wall = this.art({ x: room.within.x + room.within.w, y: 0 }).x - 3 - nth * 3;
		const { tray, entry, exit, out, riser, plates } = conduit;
		const into = { x: entry.x - 4, y: entry.y };
		const seat = this.art({ x: worker.seat.x - 0.4, y: worker.seat.y - 0.1 });
		// The island it's at: the one of its project's whose plate is nearest
		const plate = plates
			.map(({ at }) => at)
			.sort((a, b) => Math.hypot(a.x - seat.x, a.y - seat.y) - Math.hypot(b.x - seat.x, b.y - seat.y))[0];

		return [
			[
				...(outlet ? [outlet, { x: door.x, y: outlet.y }] : []),
				door,
				{ x: wall, y: door.y },
				{ x: wall, y: tray },
				{ x: into.x, y: tray },
				into,
				entry,
			],
			[
				exit,
				out,
				{ x: out.x, y: tray },
				{ x: riser, y: tray },
				...(plate ? [{ x: riser, y: plate.y }, plate, { x: seat.x, y: plate.y }, seat] : []),
			],
		];
	}

	// How far out from the lounge a conduit bends round it, by its riser's place along the bridge's aft wall, so each
	// runs its own line as its riser does, and a stream along it with it
	besideOf(riser) {
		return riser - this.art({ x: this.bridge.x, y: 0 }).x - 4;
	}

	// A stream's or a conduit's points, in art pixels, bent round the lounge wherever a straight run of it would cross it
	// end to end: out to the lounge's nearer edge (its far one when it stands against the hull), along it, and back,
	// rather than under its couches; `apart` more pixels out, so several bent round it run side by side, not on one line
	clearOfLounge(points, apart = 0) {
		const { lounge } = this;

		if (!lounge?.count) return points;

		const from = this.art({ x: lounge.x, y: lounge.y });
		const past = this.art({ x: lounge.x + lounge.w, y: lounge.y + lounge.d });
		const box = { left: from.x - 2, right: past.x + 2, top: from.y - 2, bottom: past.y + 2 };
		// Against the hull, its near side has no room to run along: round by its far side then
		const walled = lounge.y + lounge.d >= this.layout.building.bottom - 0.05;
		const bent = [points[0]];

		for (const [index, to] of points.slice(1).entries()) {
			const at = points[index];
			const across = at.y === to.y && at.y > box.top && at.y < box.bottom;
			const down = at.x === to.x && at.x > box.left && at.x < box.right;

			if (across && Math.min(at.x, to.x) < box.left && Math.max(at.x, to.x) > box.right) {
				const edge = walled || at.y - box.top < box.bottom - at.y ? box.top - apart : box.bottom + apart;
				const [enter, leave] = to.x > at.x ? [box.left - 1, box.right + 1] : [box.right + 1, box.left - 1];

				bent.push({ x: enter, y: at.y }, { x: enter, y: edge }, { x: leave, y: edge }, { x: leave, y: at.y });
			} else if (down && Math.min(at.y, to.y) < box.top && Math.max(at.y, to.y) > box.bottom) {
				const edge = at.x - box.left < box.right - at.x ? box.left - apart : box.right + apart;
				const [enter, leave] = to.y > at.y ? [box.top - 1, box.bottom + 1] : [box.bottom + 1, box.top - 1];

				bent.push({ x: at.x, y: enter }, { x: edge, y: enter }, { x: edge, y: leave }, { x: at.x, y: leave });
			}
			bent.push(to);
		}

		return bent;
	}

	// The colors of the systems' data running through each project's machine, by project: those its sessions at their
	// terminals are using in the engine bay
	feedsOf() {
		const fed = new Map();

		for (const worker of this.workers.values()) {
			const stream = this.wired(worker) && this.streamOf(worker);

			if (!stream) continue;

			const facility = stream.facility.startsWith('mcp:') ? 'dish' : stream.facility;

			if (!this.layout.systems[`${worker.session.engine.key}/${facility}`]?.within) continue;

			const name = this.bayOf(worker)?.name;
			const color = `hsl(${accentOf(facility)} 85% 68%)`;

			if (name && !fed.get(name)?.includes(color)) fed.set(name, [...(fed.get(name) ?? []), color]);
		}

		return fed;
	}

	// A line along `track` (art pixels), and packets running along it from its start
	drawPath(ctx, { runs, legs }, { dim, bright, phase }, part) {
		if (part === 'line') {
			ctx.fillStyle = dim;
			for (const [x, y, w, h] of runs) ctx.fillRect(x, y, w, h);

			return;
		}

		const shift = (Math.floor(this.time * 30) + phase) % PACKET_GAP;

		// A pixel's packet now and then along a dark line, enough to read which way it runs without crowding the ship
		ctx.fillStyle = bright;
		for (const { from, to, length, first } of legs)
			for (let step = (((shift - first) % PACKET_GAP) + PACKET_GAP) % PACKET_GAP; step < length; step += PACKET_GAP)
				ctx.fillRect(
					Math.round(from.x + ((to.x - from.x) * step) / length),
					Math.round(from.y + ((to.y - from.y) * step) / length),
					1,
					1,
				);
	}

	// A small grey for each subagent its grey has out: one budded when a subagent starts, gone in a puff when it ends.
	// When calm (or first seen) they're simply there.
	tendSmallGreys(worker, calm) {
		// No more than are ever drawn (and the one past them that's counted): a count from another paude is its word
		const out = worker.lounging ? 0 : Math.min(MOST.smallGreys + 1, Math.max(0, Number(worker.session.agents) || 0));
		const smalls = (worker.smalls ??= []);
		const present = smalls.filter(({ goneAt }) => goneAt === undefined);

		for (let more = present.length; more < out; more++) smalls.push({ bornAt: calm ? -Infinity : this.time });
		present.slice(out).forEach(small => (small.goneAt = calm ? -Infinity : this.time));
		worker.smalls = smalls.filter(({ goneAt }) => goneAt === undefined || this.time - goneAt < SMALL_GREY_SECONDS);
	}

	// Where a grey's i-th small grey sits: at its own small terminal along the island beside its grey's seat
	smallGreyAt(worker, index) {
		return { x: worker.seat.x + 1.3 + index * 0.8, y: worker.seat.y };
	}

	// The small greys at their terminals beside their grey's seat, budding in a spark and going in a puff; those past
	// what fits are counted
	smallGreyParts(ctx, worker) {
		const { session } = worker;
		const colors = { c: `hsl(${session.hue ?? 200} 55% 55%)` };
		const shown = (worker.smalls ?? []).slice(0, MOST.smallGreys);
		const parts = shown.map((small, index) => {
			const spot = this.smallGreyAt(worker, index);

			const terminal = {
				y: worker.seat.y + 0.15,
				draw: () => {
					const at = this.art({ x: spot.x, y: worker.seat.y + 0.2 });
					const lit = Math.floor(this.time * 4 + index) % 2;

					rect(ctx, at.x - 14, at.y - 22, 10, 8, PALETTE.k);
					rect(ctx, at.x - 13, at.y - 21, 8, 6, PALETTE.d);
					for (let line = 0; line < 3; line++)
						rect(
							ctx,
							at.x - 12,
							at.y - 20 + line * 2,
							3 + ((line + index + lit) % 3) * 2,
							1,
							`hsl(${session.hue ?? 200} 55% ${lit ? 62 : 48}%)`,
						);
					rect(ctx, at.x - 10, at.y - 14, 2, 2, PALETTE.d);
				},
			};

			return [
				terminal,
				{
					y: spot.y,
					draw: () => {
						// Seated at its terminal, raised over the island's console as its grey is
						const at = this.art(spot);

						at.y -= 9;

						const born = Math.min(1, (this.time - small.bornAt) / SMALL_GREY_SECONDS);
						const gone = small.goneAt === undefined ? 0 : (this.time - small.goneAt) / SMALL_GREY_SECONDS;

						if (gone > 0) {
							ctx.fillStyle = `rgba(220, 225, 235, ${(0.6 * (1 - gone)).toFixed(2)})`;
							for (let puff = 0; puff < 4; puff++)
								ctx.fillRect(Math.round(at.x - 4 + puff * 2), Math.round(at.y - 6 - gone * 8 - (puff % 2) * 2), 2, 2);

							return;
						}
						if (born < 1) {
							ctx.save();
							ctx.beginPath();
							ctx.rect(at.x - 6, at.y - Math.round(11 * born), 12, Math.round(11 * born) + 1);
							ctx.clip();
						}

						const working = Math.floor(this.time * 4 + index) % 2;

						drawSprite(ctx, working ? 'smallGreyWork' : 'smallGrey', at.x, at.y - (working ? 1 : 0), { colors });
						if (working) rect(ctx, at.x - 2, at.y - 6, 5, 2, `hsl(${ACCENTS.hatchery} 80% 72%)`);
						if (born < 1) {
							ctx.restore();
							rect(ctx, at.x - 4, at.y - Math.round(11 * born), 9, 1, PALETTE.W);
						}
						this.hits.push({
							...this.toScreen({ x: at.x, y: at.y - 5 }),
							r: 4 * this.camera.zoom,
							kind: 'subagent',
							session,
							task: session.subagents?.[index],
						});
					},
				},
			];
		});

		const extra = (session.agents ?? 0) - MOST.smallGreys;

		if (extra > 0 && this.camera.zoom >= 4) {
			const end = this.art(this.smallGreyAt(worker, MOST.smallGreys));

			this.labels.push({ text: `+${extra}`, at: { x: end.x, y: end.y - 4 }, color: PALETTE.w, size: 1 });
		}

		return parts.flat();
	}

	// The verdict that matters most of several sessions' (whether what each changed was tested since), or null
	static worstVerdict(sessions) {
		return VERDICTS.find(state => sessions.some(({ tested }) => tested?.state === state)) ?? null;
	}

	// Each deck's QA bench: a gantry lit by the deck's worst verdict, its beam sweeping while anything there is still to
	// test; pressable for each session's verdict
	inspectionParts(ctx) {
		// A project's machine shows its own verdict on a gauge; only a project still in a room has the bench
		return this.bays
			.filter(bay => !this.layout.bays?.find(({ name }) => name === bay.name)?.parts)
			.map(bay => {
				const sessions = bay.sessions.map(key => this.workers.get(key)?.session).filter(Boolean);
				const verdict = Ship.worstVerdict(sessions);
				const spot = { x: bay.x + 0.6, y: bay.y + bay.d - 0.3 };

				return {
					y: spot.y,
					draw: () => {
						const at = this.art(spot);
						const color = VERDICT_COLORS[verdict] ?? PALETTE.d;

						rect(ctx, at.x - 8, at.y - 16, 2, 16, PALETTE.k);
						rect(ctx, at.x + 7, at.y - 16, 2, 16, PALETTE.k);
						rect(ctx, at.x - 7, at.y - 15, 1, 15, PALETTE.l);
						rect(ctx, at.x + 8, at.y - 15, 1, 15, PALETTE.l);
						rect(ctx, at.x - 8, at.y - 18, 17, 3, PALETTE.k);
						rect(ctx, at.x - 6, at.y - 17, 13, 1, color);
						if (verdict && verdict !== 'current') {
							const sweep = Math.floor(this.time * 10) % 14;

							rect(ctx, at.x - 6, at.y - 15 + sweep, 13, 1, `${color}66`);
						}
						rect(ctx, at.x - 9, at.y - 1, 19, 2, PALETTE.m);
						if (verdict === 'current') rect(ctx, at.x - 1, at.y - 8, 3, 3, color);
						this.hits.push({
							...this.toScreen({ x: at.x, y: at.y - 9 }),
							r: 8 * this.camera.zoom,
							kind: 'inspection',
							bay,
							sessions,
						});
					},
				};
			});
	}

	// How many empties a lounger has on its pile: one each half hour since its session's prompt cache went cold (since it
	// stopped, where that isn't known)
	cansOf(worker) {
		const { session } = worker;
		const now = Math.min(
			MOST.cans,
			Math.floor((session.coldAgo ?? session.context?.cache?.ago ?? session.stoppedAgo ?? 0) / CAN_MS),
		);

		if (worker.cans !== undefined && now > worker.cans) worker.tossedAt = this.time;
		worker.cans = now;

		return this.time - (worker.tossedAt ?? -Infinity) < TOSS_SECONDS ? now - 1 : now;
	}

	// The seat it left at its island while it rests: its chair empty, its terminal frosted over gone cold or switched off
	// stopped, pressed as ever to open it
	homeSeatParts(ctx, worker) {
		const { session, homeSeat } = worker;

		if (!homeSeat) return [];

		const at = this.art({ x: homeSeat.x, y: homeSeat.y + 0.2 });

		this.hits.push({
			...this.toScreen({ x: at.x - 7, y: at.y - 21 }),
			r: 8 * this.camera.zoom,
			kind: 'monitor',
			worker,
		});

		return [
			{
				y: homeSeat.y + 0.14,
				draw: () =>
					drawSeat(ctx, at, {
						screen: { ...screenOf(session), kind: session.status === 'stopped' ? 'off' : 'idle' },
						engineColor: `hsl(${session.engine.hue ?? 215} 45% 50%)`,
						time: this.time,
						seed: worker.seed,
						frost: session.status !== 'stopped',
					}),
			},
		];
	}

	// A stopped session lounging on a couch, eyes shut
	loungerParts(ctx, worker) {
		const { seat } = worker;
		const cans = this.cansOf(worker);

		return [
			{ y: seat.y + 0.3, draw: () => this.drawCans(ctx, worker, Math.min(cans, CANS_DROPPED), 0) },
			// Behind the couch's back, so the heap shows over it rather than lying on its front
			{ y: seat.y - 0.3, draw: () => this.drawCans(ctx, worker, cans, CANS_DROPPED) },
			{
				y: seat.y + 0.2,
				draw: () => {
					const at = this.art(this.placeOf(worker));
					const swing = Math.floor(this.time * 1.5 + worker.seed) % 2;

					for (const side of [-2, 1]) {
						rect(ctx, at.x + side - 1, at.y - 6, 3, 4, PALETTE.k);
						rect(ctx, at.x + side, at.y - 6, 1, 3, PALETTE.a);
						rect(ctx, at.x + side - 1 + (side > 0 ? swing : 0), at.y - 3, 3, 2, PALETTE.k);
					}
				},
			},
			{
				y: seat.y - 0.1,
				draw: () => this.drawWorker(ctx, worker),
			},
		];
	}

	// A lounger's empties: crushed on the floor where they were dropped, and the rest heaped on the backrest
	drawCans(ctx, worker, count, from) {
		const color = `hsl(${worker.session.hue ?? 0} 65% 55%)`;

		for (let can = from; can < count; can++) {
			const { x, y } = this.canAt(worker, can);

			if (can < CANS_DROPPED) {
				const flip = seeded(`${worker.session.key}|crush${can}`) < 0.5 ? 1 : -1;

				rect(ctx, x - 2, y - 1, 4, 2, PALETTE.k);
				rect(ctx, x - (flip > 0 ? 1 : 2), y - 2, 2, 1, PALETTE.k);
				rect(ctx, x - 1, y - 1, 2, 1, color);
				rect(ctx, x + (flip > 0 ? 1 : -2), y - 1, 1, 1, PALETTE.g);
			} else {
				const lie = seeded(`${worker.session.key}|lie${can}`);

				if (lie < 0.45) {
					rect(ctx, x - 1, y - 4, 3, 5, PALETTE.k);
					rect(ctx, x, y - 3, 1, 3, color);
					rect(ctx, x, y - 3, 1, 1, PALETTE.g);
				} else if (lie < 0.8) {
					rect(ctx, x - 2, y - 2, 5, 3, PALETTE.k);
					rect(ctx, x - 1, y - 1, 3, 1, color);
					rect(ctx, lie < 0.62 ? x + 1 : x - 1, y - 1, 1, 1, PALETTE.g);
				} else {
					rect(ctx, x - 2, y - 1, 4, 2, PALETTE.k);
					rect(ctx, x - 1, y - 2, 2, 1, PALETTE.k);
					rect(ctx, x - 1, y - 1, 2, 1, color);
				}
			}
		}
	}

	// Where a lounger's nth empty goes, in art pixels: the first few crushed by the couch's nearer end, the rest heaped
	// on the backrest
	canAt(worker, can) {
		const seat = this.art({ x: worker.seat.x, y: worker.seat.y + 0.15 });
		// Behind the backrest, its bottom row tucked under the backrest's top edge
		const back = this.art(worker.seat).y - 20;
		const key = worker.session.key;

		if (can < CANS_DROPPED) {
			const { side, seat: end } = couchEndOf(this.lounge, this.lounge.sessions.indexOf(key));
			const at = this.art(end);
			const spread = seeded(`${key}|can${can}`) - 0.5;
			const down = seeded(`${key}|canDown${can}`);

			return {
				x: Math.round(at.x + side * (COUCH_SEAT * UNIT.x * 0.5 + 10 + down * 6) + spread * 10),
				y: Math.round(at.y - 2 + down * 8),
			};
		}

		const index = can - CANS_DROPPED;
		const along = seeded(`${key}|heap${index}`);
		const up = index < 3 ? 0 : Math.round(seeded(`${key}|heapUp${index}`) * 2 + (index - 2) * 1.5);

		return { x: Math.round(seat.x - 17 + along * 13), y: back - up + Math.round(seeded(`${key}|heapSag${index}`) * 2) };
	}

	// What the worker's tool is doing, at its seat: reading turns pages over the monitor, the shell throws sparks, the
	// web sends out waves, a plan ticks itself off
	drawActivity(ctx, worker, facility, seat) {
		const time = this.time + worker.seed;
		const color = `hsl(${accentOf(facility)} 70% 66%)`;
		const monitor = { x: seat.x - 8, y: seat.y - 27 };

		if (facility === 'library') {
			const along = (time / 0.8) % 1;

			rect(ctx, monitor.x - 2 + Math.round(along * 4), monitor.y - Math.round(along * 8), 3, 4, PALETTE.w);
			rect(ctx, monitor.x - 1 + Math.round(along * 4), monitor.y + 1 - Math.round(along * 8), 1, 1, PALETTE.l);
		}
		if (facility === 'reactor')
			for (let spark = 0; spark < 3; spark++) {
				const along = (time * 3 + spark / 3) % 1;

				rect(
					ctx,
					monitor.x + Math.round((seeded(`${spark}|${Math.floor(time * 3)}`) - 0.5) * 12),
					monitor.y - Math.round(along * 6),
					1,
					1,
					along < 0.5 ? PALETTE.y : PALETTE.o,
				);
			}
		if (facility === 'dish')
			for (const offset of [0, 0.5]) {
				const reach = 3 + ((time * 1.5 + offset) % 1) * 9;

				ctx.fillStyle = color;
				for (let step = 0; step <= 8; step++) {
					const angle = Math.PI + (step / 8) * Math.PI;

					ctx.fillRect(
						Math.round(monitor.x + Math.cos(angle) * reach),
						Math.round(monitor.y - 2 + Math.sin(angle) * reach * 0.6),
						1,
						1,
					);
				}
			}
		if (facility === 'tower') {
			const ticked = Math.floor(time * 1.5) % 4;

			for (let row = 0; row < 3; row++) {
				rect(ctx, monitor.x - 6, monitor.y - 9 + row * 3, 2, 2, row < ticked ? color : PALETTE.l);
				rect(ctx, monitor.x - 3, monitor.y - 9 + row * 3, 6 + ((row * 3) % 4), 1, PALETTE.l);
			}
		}
	}

	// What the session's hooks say, as instruments about its seat: sparks and then smoke from a tool that failed, its
	// permission mode (a beacon turning when nothing is asked first, a blueprint while it plans, a green lamp while edits
	// go ahead), steam from a turn running long, and a cube of its context going out once compacted
	drawInstruments(ctx, worker, seat) {
		const { session } = worker;
		const time = this.time + worker.seed;
		const monitor = { x: seat.x - 8, y: seat.y - 27 };

		const sinceFault = worker.faultAt === null || worker.faultAt === undefined ? Infinity : this.time - worker.faultAt;

		if (sinceFault < SPARK_SECONDS)
			for (let spark = 0; spark < 6; spark++) {
				const along = (sinceFault * 2 + spark / 6) % 1;
				const angle = Math.PI * (1.1 + seeded(`${worker.session.key}|spark${spark}`) * 0.8);

				rect(
					ctx,
					monitor.x + 4 + Math.cos(angle) * along * 14,
					monitor.y + 6 + Math.sin(angle) * along * 10 + along * along * 8,
					1,
					1,
					along < 0.4 ? PALETTE.W : PALETTE.y,
				);
			}
		if (sinceFault < SMOKE_SECONDS) {
			const thick = 1 - sinceFault / SMOKE_SECONDS;

			for (let puff = 0; puff < Math.min(4, session.faults || 1); puff++) {
				const rise = (time * 0.35 + puff / 4) % 1;
				const size = 1 + Math.round(rise * 3);

				ctx.fillStyle = `rgba(150, 150, 160, ${(0.55 * thick * (1 - rise)).toFixed(2)})`;
				ctx.fillRect(
					Math.round(monitor.x - 4 + Math.sin(time + puff) * 3 - size / 2),
					Math.round(monitor.y + 2 - rise * 20),
					size,
					size,
				);
			}
		}

		if (session.mode === 'bypassPermissions') {
			const sweep = Math.floor(time * 4) % 4;

			rect(ctx, monitor.x - 1, monitor.y - 2, 3, 2, PALETTE.k);
			rect(ctx, monitor.x, monitor.y - 3, 1, 1, sweep % 2 ? PALETTE.r : PALETTE.y);
			ctx.fillStyle = 'rgba(240, 180, 60, 0.18)';
			ctx.fillRect(monitor.x + (sweep < 2 ? 1 : -9), monitor.y - 4, 8, 3);
		}
		if (session.mode === 'acceptEdits') {
			rect(ctx, monitor.x - 1, monitor.y - 2, 3, 2, PALETTE.k);
			rect(ctx, monitor.x, monitor.y - 2, 1, 1, PALETTE.t);
		}
		if (session.mode === 'plan') {
			// Up and out to the monitor's side, between seats, clear of the row behind
			const sheet = { x: seat.x - 28, y: seat.y - 36, w: 12, h: 6 };

			ctx.fillStyle = 'rgba(80, 160, 255, 0.12)';
			ctx.beginPath();
			ctx.moveTo(monitor.x - 7, monitor.y + 1);
			ctx.lineTo(sheet.x, sheet.y + sheet.h);
			ctx.lineTo(sheet.x + sheet.w, sheet.y + sheet.h);
			ctx.lineTo(monitor.x - 4, monitor.y + 1);
			ctx.closePath();
			ctx.fill();
			ctx.fillStyle = 'rgba(120, 190, 255, 0.6)';
			for (let x = 0; x <= sheet.w; x += 4) ctx.fillRect(sheet.x + x, sheet.y, 1, sheet.h + 1);
			for (let y = 0; y <= sheet.h; y += 3) ctx.fillRect(sheet.x, sheet.y + y, sheet.w + 1, 1);
			rect(
				ctx,
				sheet.x + 1 + (Math.floor(time * 3) % 3) * 4,
				sheet.y + 1 + (Math.floor(time * 2) % 2) * 3,
				3,
				2,
				PALETTE.W,
			);
		}

		const turn = worker.turnAt === null || worker.turnAt === undefined ? 0 : this.time - worker.turnAt;

		if (session.status === 'working' && turn > STEAM_SECONDS)
			for (let wisp = 0; wisp < (turn > HOT_SECONDS ? 4 : 2); wisp++) {
				const rise = (time * 0.6 + wisp / 4) % 1;

				ctx.fillStyle = `rgba(220, 225, 235, ${(0.4 * (1 - rise)).toFixed(2)})`;
				ctx.fillRect(
					Math.round(seat.x + 6 + wisp * 3 + Math.sin(time * 2 + wisp) * 2),
					Math.round(seat.y - 14 - rise * 14),
					1,
					2,
				);
			}
		if (session.status === 'working' && turn > HOT_SECONDS && Math.floor(time * 2) % 2)
			rect(ctx, seat.x - 13, seat.y - 5, 26, 1, PALETTE.r);

		const compacted = this.time - (worker.compactedAt ?? -Infinity);

		if (compacted < COMPACT_SECONDS) this.drawCube(ctx, worker, seat, compacted / COMPACT_SECONDS);
	}

	// The head a session's grey wears: as big as its context is full, throbbing past the biggest when it's about to
	// compact itself; given its grey, while it's compacting, squeezed down from the size it was through those between
	headOf(session, worker) {
		const left = session.untilCompact ?? Infinity;
		const now =
			left <= BURSTING && Math.floor(this.time * 2 * this.throbOf(session)) % 2 === 0
				? 'bursting'
				: headFor(session.context?.fill ?? 0);
		const along = (this.time - (worker?.compactedAt ?? -Infinity)) / COMPACT_SECONDS;

		if (!worker?.compactedFrom || along >= SQUEEZED) return now;

		const from = HEAD_SIZES.indexOf(worker.compactedFrom);
		const to = HEAD_SIZES.indexOf(now);

		return HEAD_SIZES[Math.min(to, from + Math.floor((to - from + 1) * (along / SQUEEZED) ** 2))];
	}

	// How fast a grey about to compact itself throbs, a beat a second at the start and faster the closer it gets (0 for
	// one that isn't)
	throbOf(session) {
		const left = session.untilCompact ?? Infinity;

		return left <= BURSTING ? 1 + (BURSTING - left) * 0.5 : 0;
	}

	// Compacted context: squeezed out of its grey's skull, a cube pops onto the floor and is carted to the recycler in
	// engineering, along the spine
	drawCube(ctx, worker, seat, along) {
		if (along < SQUEEZED) return;

		const floor = { x: worker.seat.x - 0.5, y: worker.seat.y + 0.15 };
		const points = [
			floor,
			...this.route(floor, worker.room, recyclerAt(this.layout.engineering), this.layout.engineering),
		].map(point => this.art(point));
		const lengths = points
			.slice(1)
			.map((point, index) => Math.hypot(point.x - points[index].x, point.y - points[index].y));
		const total = lengths.reduce((sum, length) => sum + length, 0);
		const crown = worker.crown ?? { x: seat.x - 10, y: seat.y - 16 };
		const popped = Math.min(1, (along - SQUEEZED) / (POPPED - SQUEEZED));
		let at = {
			x: crown.x + (points[0].x - crown.x) * popped,
			y: crown.y + (points[0].y - crown.y) * popped - Math.sin(popped * Math.PI) * 12,
		};

		if (popped < 1) {
			ctx.globalAlpha = 1 - popped;
			for (const [dx, dy] of [
				[-3, -1],
				[3, -2],
				[0, -4],
			])
				rect(ctx, crown.x + dx, crown.y + dy - popped * 4, 2, 1, PALETTE.W);
			ctx.globalAlpha = 1;
		}
		if (along >= POPPED) {
			let left = ((along - POPPED) / (1 - POPPED)) * total;
			let index = 0;

			while (index < lengths.length - 1 && left > lengths[index]) left -= lengths[index++];

			const [from, to] = [points[index], points[index + 1] ?? points[index]];
			const part = lengths[index] ? left / lengths[index] : 1;

			at = { x: from.x + (to.x - from.x) * part, y: from.y + (to.y - from.y) * part };
		}
		rect(ctx, at.x - 3, at.y - 5, 6, 5, PALETTE.k);
		rect(ctx, at.x - 2, at.y - 4, 4, 3, PALETTE.l);
		rect(ctx, at.x - 2, at.y - 3, 4, 1, PALETTE.w);
	}

	// Power from each engine's reactor along the hall to the bays where its sessions are at work, pulses running from its
	// door to theirs
	drawConduits(ctx, hall) {
		const lines = this.engines
			.map(engine => ({
				engine,
				bays: this.bays.filter(bay =>
					bay.sessions.some(key => {
						const session = this.workers.get(key)?.session;

						return session?.engine.key === engine.key && session.status === 'working';
					}),
				),
			}))
			.filter(({ bays }) => bays.length);

		lines.forEach(({ engine, bays }, index) => {
			const lane = this.art({ x: 0, y: hall.lane }).y + 3 + index * 2;
			const from = this.art(engine.door);
			const hue = engine.hue ?? 215;

			for (const bay of bays) {
				const to = this.art(bay.door);
				const step = Math.sign(to.x - from.x) || 1;

				rect(ctx, Math.min(from.x, to.x), lane, Math.abs(to.x - from.x) + 1, 1, `hsl(${hue} 30% 24%)`);
				for (const [x, y] of [
					[from.x, from.y],
					[to.x, to.y],
				])
					rect(ctx, x, Math.min(y, lane), 1, Math.abs(lane - y) + 1, `hsl(${hue} 30% 24%)`);
				for (let x = from.x + step * (Math.floor(this.time * 30) % 8); (to.x - x) * step > 0; x += step * 8)
					rect(ctx, x, lane, 2, 1, `hsl(${hue} 75% 66%)`);
			}
		});
	}

	// At each answer: when its cache's countdown was read, to run it down smoothly between answers, and when the latest
	// ping or nudge was typed into it, for the drink it takes
	noteKeeping(worker, session) {
		if (session.context?.cache) worker.cacheAt = this.time;

		const boost = session.boost;

		if (!boost) return;

		const at = this.time - boost.ago / 1000;

		if (worker.boostAt === undefined || Math.abs(at - worker.boostAt) > 2) worker.boostAt = at;
	}

	// How far a grey waiting at its seat has nodded off, 0 to 1: how much of its cache's life has run out. Asking, at
	// work, or not known, it's wide awake.
	drowseOf(worker) {
		const { session } = worker;
		const cache = session.context?.cache;

		if (session.status !== 'ready' || !cache?.life || this.drinking(worker)) return 0;

		const left = cache.left - (this.time - (worker.cacheAt ?? this.time)) * 1000;

		return Math.max(0, Math.min(1, 1 - left / cache.life));
	}

	// Taking a drink: for a few seconds after a ping or a nudge was typed into it
	drinking(worker) {
		return this.time - (worker.boostAt ?? -Infinity) < DRINK_SECONDS;
	}

	drawSip(ctx, worker, at, neck) {
		const body = keepingOf(worker.session) === 'warm' ? '#e8e2d6' : '#3ad07a';
		const spot = { x: at.x + 2, y: neck - 1 };

		for (let step = 0; step < 3; step++) rect(ctx, spot.x + step, spot.y - step, 3, 3, step === 1 ? body : PALETTE.k);
		rect(ctx, spot.x + 1, spot.y - 1, 1, 1, keepingOf(worker.session) === 'warm' ? body : '#ffe14a');
		rect(ctx, spot.x + 3, spot.y + 2, 1, 3, PALETTE.a);
	}

	// What keeps it going on the console beside it, `at` the console's front (art pixels): a mug of coffee kept warm, a
	// tall energy drink kept going. Off the console while it's drinking.
	drawPick(ctx, worker, at) {
		if (this.drinking(worker)) return;

		const spot = { x: at.x + 12, y: at.y - 7 };

		if (keepingOf(worker.session) === 'warm') {
			rect(ctx, spot.x - 3, spot.y - 6, 7, 7, PALETTE.k);
			rect(ctx, spot.x - 2, spot.y - 5, 5, 5, '#e8e2d6');
			rect(ctx, spot.x - 2, spot.y - 5, 5, 1, '#5a3a22');
			rect(ctx, spot.x + 4, spot.y - 4, 2, 3, PALETTE.k);
			rect(ctx, spot.x + 4, spot.y - 3, 1, 1, '#e8e2d6');

			const rise = (this.time * 0.9 + worker.seed) % 1;

			ctx.globalAlpha = 0.7 * (1 - rise);
			rect(ctx, spot.x + (Math.floor(rise * 3) % 2), spot.y - 8 - Math.round(rise * 6), 1, 2, PALETTE.W);
			ctx.globalAlpha = 1;
		} else {
			rect(ctx, spot.x - 3, spot.y - 11, 7, 12, PALETTE.k);
			rect(ctx, spot.x - 2, spot.y - 10, 5, 10, '#3ad07a');
			rect(ctx, spot.x - 2, spot.y - 10, 5, 1, PALETTE.g);
			for (const [dx, dy] of ZAP) rect(ctx, spot.x - 1 + dx, spot.y - 8 + dy, 1, 1, '#ffe14a');
		}
	}

	// The worker: its body, and over it a head sized by its context. Its state shows in how it carries on: typing at
	// work, a thought bubble between tools, waving when asking, blinking when idle, dozing when stopped or waiting out a
	// usage limit; on its feet walking somewhere.
	drawWorker(ctx, worker) {
		const { session } = worker;
		const walking = this.walking(worker);
		const at = this.art(walking ? worker : this.placeOf(worker));

		if (!walking && !worker.seat?.housing) at.y -= worker.lounging ? 4 : 10;
		worker.headX = at.x;

		const making = (this.time - (worker.madeAt ?? -Infinity)) / MAKE_SECONDS;

		if (worker.leaving) this.drawBeam(ctx, at, 1 - worker.opacity);
		if (worker.leaving && worker.opacity < 0.5) return;
		if (making < 1) {
			this.drawBeam(ctx, at, 1 - making / 2);
			ctx.save();
			ctx.beginPath();
			ctx.rect(at.x - 20, at.y - Math.round(34 * making), 40, Math.round(34 * making) + 1);
			ctx.clip();
		}

		const typing = session.status === 'working' && session.tool;
		const thinking = session.status === 'working' && !session.tool;
		const bob = typing && Math.floor(this.time * 5 + worker.seed) % 2 ? 1 : 0;
		const waving = session.status === 'waiting' && Math.floor(this.time * 3) % 2;
		// Waiting at its seat as its cache runs down it nods off, and once its cache is gone, sleeps; a drink when it's
		// pinged or nudged wakes it again
		const drowse = !walking && !worker.lounging ? this.drowseOf(worker) : 0;
		const asleep = drowse >= 1;
		const blinking =
			session.status === 'ready' &&
			(drowse >= 0.85 || (this.time + worker.seed) % 4 < 0.15 + Math.max(0, drowse - 0.5) * 3);
		const fill = session.context?.fill ?? 0;
		// On the lounge's couch it faces the viewer as at its seat, watching the TV on the near wall, a beer in hand
		const watching = worker.lounging && !walking;
		const dozing =
			!watching && (asleep || session.status === 'stopped' || (session.limit && session.status !== 'working'));
		const shut = dozing || blinking;
		const size = this.headOf(session, worker);
		const squeezing = size !== this.headOf(session);
		const head = `head-${size}${shut ? '-shut' : ''}`;
		const colors = { c: `hsl(${session.hue ?? 200} 55% 55%)`, s: rankOf(session.context?.model) };
		const sag =
			(drowse >= 0.85 && 2) || (drowse >= 0.6 && Math.floor((this.time + worker.seed) * 0.8) % 3 === 0 ? 1 : 0);
		const neck = at.y - bob - 5 + sag;

		// Walking: standing, a step, standing, the other step
		const stride = walking && making >= 1 ? STEPS[Math.floor(worker.step) % STEPS.length] : '';

		drawSprite(ctx, (waving && 'bodyWave') || `body${stride}`, at.x, at.y - bob, {
			colors,
			flip: (walking && worker.facing < 0) || (!walking && worker.seat?.side < 0),
		});
		const throb = this.throbOf(session);

		if (throb) {
			const { h: tall } = spriteSize(head);
			const beat = 0.5 + 0.5 * Math.sin(this.time * throb * 2 * Math.PI);
			const glow = ctx.createRadialGradient(at.x, neck - tall / 2, 2, at.x, neck - tall / 2, 14 + beat * 8);

			glow.addColorStop(0, `rgba(255, 70, 50, ${0.35 + beat * 0.45})`);
			glow.addColorStop(1, 'rgba(255, 70, 50, 0)');
			ctx.fillStyle = glow;
			ctx.fillRect(at.x - 20, neck - tall / 2 - 20, 40, 40);
		}
		if (fill >= 0.9 && Math.floor(this.time * 4) % 2) ctx.globalAlpha = 0.85;
		drawSprite(ctx, head, at.x + (squeezing ? (Math.floor(this.time * 20) % 2) * 2 - 1 : 0), neck, {
			colors: size === 'bursting' ? { ...colors, r: '#ff4a3a' } : colors,
		});
		ctx.globalAlpha = 1;
		if (making < 1) ctx.restore();

		const { w, h } = spriteSize(head);
		const top = neck - h;

		if (watching) {
			// A sip now and then, the can up at its mouth; otherwise resting on the couch's arm; and each half hour, the can
			// done, a toss onto its pile before it opens another
			const beer = `hsl(${worker.session.hue ?? 0} 65% 55%)`;
			const sipping = (this.time + worker.seed * 3) % 6 < 1.6;
			const toss = this.time - (worker.tossedAt ?? -Infinity);
			const can = sipping ? { x: at.x, y: neck - 2 } : { x: at.x + 6, y: at.y - 6 };

			if (toss < TOSS_SECONDS) {
				const t = toss / TOSS_SECONDS;
				const pile = this.canAt(worker, worker.cans - 1);
				const flying = {
					x: Math.round(at.x + 6 + (pile.x - at.x - 6) * t),
					y: Math.round(at.y - 6 + (pile.y - 4 - (at.y - 6)) * t - Math.sin(t * Math.PI) * 12),
				};

				rect(ctx, flying.x - 1, flying.y - 1, Math.floor(t * 6) % 2 ? 5 : 3, Math.floor(t * 6) % 2 ? 3 : 5, PALETTE.k);
				rect(ctx, flying.x, flying.y, 1, 1, beer);
			} else if (sipping) {
				for (let step = 0; step < 3; step++) rect(ctx, can.x + step, can.y - step, 2, 2, step === 1 ? beer : '#d4dae4');
				rect(ctx, can.x + 3, can.y - 2, 1, 1, PALETTE.W);
				rect(ctx, can.x + 3, can.y + 1, 1, 3, PALETTE.a);
			} else {
				rect(ctx, can.x - 1, can.y - 1, 3, 5, PALETTE.k);
				rect(ctx, can.x, can.y, 1, 3, beer);
				rect(ctx, can.x, can.y, 1, 1, PALETTE.g);
			}
		}
		if (!watching && !walking && worker.seat && keepingOf(session) && this.drinking(worker))
			this.drawSip(ctx, worker, at, neck);
		if (thinking) this.drawThought(ctx, at.x + w / 2 + 1, top + 2);
		if (dozing) {
			const rise = (this.time * 0.8 + worker.seed) % 1;

			pixelText(ctx, 'z', at.x + w / 2 + 1 + Math.round(rise * 3), top + 4 - Math.round(rise * 8), {
				color: session.status === 'stopped' ? PALETTE.l : PALETTE.r,
			});
		}
		if (this.time - (worker.finishedAt ?? -Infinity) < SPARKLE_SECONDS)
			this.drawSparkle(ctx, at.x, top + h / 2, (this.time - worker.finishedAt) / SPARKLE_SECONDS);

		worker.top = top;
		worker.crown = { x: at.x, y: top };
		worker.screen = this.toScreen({ x: at.x, y: neck - h / 2 });
		this.hits.push({
			...this.toScreen({ x: at.x, y: neck - 2 }),
			r: (h / 2 + 3) * this.camera.zoom,
			kind: 'worker',
			worker,
		});
	}

	// A column of light, every other pixel lit so the worker shows through it, fading as `strength` goes to nothing
	drawBeam(ctx, at, strength) {
		const height = 34;
		const width = 9;

		ctx.fillStyle = PALETTE.t;
		for (let row = 0; row < Math.round(height * strength); row++)
			for (let column = row % 2; column < width; column += 2)
				ctx.fillRect(at.x - Math.floor(width / 2) + column, at.y - row, 1, 1);
	}

	drawThought(ctx, x, y) {
		drawSprite(ctx, 'thought', x + 5, y + 2);
		for (let dot = 0; dot < 1 + (Math.floor(this.time * 3) % 3); dot++)
			rect(ctx, x + 2 + dot * 2, y - 3, 1, 1, PALETTE.k);
	}

	// Eight points flying out and fading, `time` from 0 to 1
	drawSparkle(ctx, x, y, time) {
		const reach = 3 + Math.round(time * 9);

		ctx.fillStyle = time < 0.5 ? PALETTE.W : PALETTE.y;
		for (let point = 0; point < 8; point++) {
			const angle = (point / 8) * TAU;

			ctx.fillRect(Math.round(x + Math.cos(angle) * reach), Math.round(y + Math.sin(angle) * reach * 0.7), 1, 1);
		}
	}

	// What a session runs beside Claude, as units humming behind its seat, one for each process, their lights as busy as
	// its CPU has been; a shared port puts an antenna on them, its beacon lit
	drawProcesses(ctx, worker) {
		const { processes = [], services = [] } = worker.session;

		if (worker.lounging || (!processes.length && !services.length)) return;

		const outward = -1;
		const at = this.art(
			worker.seat.housing
				? { x: worker.seat.x + outward * 0.5, y: worker.seat.y - 0.05 }
				: { x: worker.seat.x - 0.95, y: worker.seat.y - 0.35 },
		);
		const count = Math.max(1, Math.min(3, processes.length));

		for (let unit = 0; unit < count; unit++) {
			const x = at.x + outward * unit * 7;
			const busy = (processes[unit]?.cpuSeconds ?? 0) > 1;

			rect(ctx, x - 3, at.y - 8, 7, 8, PALETTE.k);
			rect(ctx, x - 2, at.y - 7, 5, 6, PALETTE.m);
			rect(ctx, x - 1, at.y - 6, 1, 1, busy && Math.floor(this.time * 6 + unit) % 2 ? PALETTE.t : PALETTE.T);
			rect(ctx, x + 1, at.y - 6, 1, 1, Math.floor(this.time * 2 + unit) % 3 ? PALETTE.y : PALETTE.Y);
			rect(ctx, x - 1, at.y - 3, 3, 1, PALETTE.d);
		}
		if (services.length) {
			rect(ctx, at.x, at.y - 15, 1, 7, PALETTE.l);
			rect(ctx, at.x - 1, at.y - 17, 3, 2, Math.floor(this.time * 2) % 2 ? PALETTE.t : PALETTE.W);
		}
		this.hits.push({
			...this.toScreen({ x: at.x + outward * (count - 1) * 3.5, y: at.y - 5 }),
			r: 6 * this.camera.zoom,
			kind: 'processes',
			worker,
		});
	}

	// Each open pull request waits in the hangar as a delivery pod for sign-off, its number over it, lit by its checks:
	// green all passing, red one failing, amber still running, gray a draft
	deliveryParts(ctx) {
		const hangar = this.layout.hangar;

		if (!hangar) return [];

		return this.cargo
			.filter(({ pullRequest }) => pullRequest?.state === 'OPEN')
			.slice(0, 3)
			.map((checkout, index) => {
				const spot = { x: hangar.x + 0.55 + index * 0.6, y: hangar.y + hangar.d - 0.35 };
				const { checks, draft } = checkout.pullRequest;

				return {
					y: spot.y,
					draw: () => {
						const at = this.art(spot);
						const light =
							(draft && PALETTE.l) ||
							(checks.failing && PALETTE.r) ||
							(checks.pending && (Math.floor(this.time * 2) % 2 ? PALETTE.y : PALETTE.Y)) ||
							PALETTE.t;

						rect(ctx, at.x - 5, at.y - 10, 11, 10, PALETTE.k);
						rect(ctx, at.x - 4, at.y - 9, 9, 8, PALETTE.l);
						rect(ctx, at.x - 4, at.y - 6, 9, 1, PALETTE.m);
						rect(ctx, at.x - 1, at.y - 12, 3, 2, light);
						rect(ctx, at.x - 6, at.y, 13, 1, PALETTE.Y);
						if (this.camera.zoom >= 4)
							this.labels.push({
								text: `#${checkout.pullRequest.number}`,
								at: { x: at.x, y: at.y - 12 },
								color: light,
								align: 'center',
								size: 1,
								gap: -6,
							});
						this.hits.push({
							...this.toScreen({ x: at.x, y: at.y - 5 }),
							r: 6 * this.camera.zoom,
							kind: 'delivery',
							checkout,
						});
					},
				};
			});
	}

	// Where each of paude's own jobs is done: a tour told and what's asked aside answered on the bridge, a prompt placed
	// at the materializer, commits and decisions filed in the hold, a pull request drafted in the hangar, a session kept
	// warm in the lounge
	placeOfJob(job) {
		const { materializer, hold, hangar } = this.layout;
		const bridge = this.bridge;
		const lounge = this.lounge;
		const place = {
			'telling a tour': bridge && { room: bridge, at: { x: navAt(bridge).x - 0.9, y: navAt(bridge).y + 0.3 } },
			'describing what came up': bridge && {
				room: bridge,
				at: { x: navAt(bridge).x + 0.9, y: navAt(bridge).y + 0.3 },
			},
			'finding what to open': bridge && { room: bridge, at: { x: navAt(bridge).x, y: navAt(bridge).y + 0.6 } },
			'placing a prompt': materializer && {
				room: materializer,
				at: { x: clonerAt(materializer).x + 0.9, y: clonerAt(materializer).y + 0.2 },
			},
			'filing decisions': hold && { room: hold, at: { x: hold.x + hold.w - 0.5, y: hold.y + hold.d - 0.5 } },
			'writing a commit message': hold && {
				room: hold,
				at: { x: hold.x + hold.w - 0.9, y: hold.y + hold.d - 0.4 },
			},
			'drafting a pull request': hangar && {
				room: hangar,
				at: { x: padAt(hangar).x - 0.9, y: padAt(hangar).y + 0.5 },
			},
			'deciding to keep going': bridge && {
				room: bridge,
				at: { x: navAt(bridge).x - 0.6, y: navAt(bridge).y + 0.9 },
			},
			'keeping a session going': bridge && {
				room: bridge,
				at: { x: navAt(bridge).x + 0.6, y: navAt(bridge).y + 0.9 },
			},
			'keeping a session warm': lounge && {
				room: lounge,
				at: { x: lounge.x + 0.6, y: lounge.y + lounge.d - 0.5 },
			},
		}[job];

		return place || null;
	}

	// Where a bot of the service crew waits in engineering
	berthOf(index) {
		const engineering = this.layout.engineering;

		return { x: engineering.x + engineering.w - 0.7 - index * 0.4, y: engineering.door.y + 2.7 };
	}

	// A bot sets off from engineering for each job that starts, works where the job is done while it runs, and walks
	// back when it's over, however short it was
	tendCrew(seconds) {
		const engineering = this.layout.engineering;

		if (!engineering) return;

		const busy = this.crew?.busy ?? [];

		for (const job of new Set(busy)) {
			if (this.bots.has(job) || this.bots.size >= MOST.bots) continue;

			const index = [...Array(MOST.bots).keys()].find(slot => ![...this.bots.values()].some(bot => bot.index === slot));
			const home = this.berthOf(index);
			const place = this.placeOfJob(job);

			this.bots.set(job, {
				job,
				index,
				...home,
				path: place ? this.route(home, engineering, place.at, place.room) : [],
				room: place?.room ?? engineering,
			});
		}
		for (const [job, bot] of this.bots) {
			if (!busy.includes(job) && !bot.back) {
				const home = this.berthOf(bot.index);
				const room = this.roomAt(bot) ?? bot.room;

				Object.assign(bot, {
					back: true,
					path: room === engineering ? [home] : this.route(bot, room, home, engineering),
				});
			}
			let left = seconds * BOT_SPEED;

			while (left > 0 && bot.path.length) {
				const [goal] = bot.path;
				const away = Math.hypot(goal.x - bot.x, goal.y - bot.y);

				if (away <= left) {
					Object.assign(bot, { x: goal.x, y: goal.y });
					bot.path.shift();
					left -= away;
				} else {
					bot.x += ((goal.x - bot.x) / away) * left;
					bot.y += ((goal.y - bot.y) / away) * left;
					left = 0;
				}
			}
			if (bot.back && !bot.path.length) this.bots.delete(job);
		}
	}

	roomAt({ x, y }) {
		return this.layout.rooms?.find(room => x >= room.x && x <= room.x + room.w && y >= room.y && y <= room.y + room.d);
	}

	// paude's own helpers, a little service crew: a bot for each job running, out where the job is done, and one docked
	// in engineering when there's none
	crewParts(ctx) {
		const engineering = this.layout.engineering;
		const crew = this.crew ?? { busy: [], lately: {} };

		if (!engineering) return [];

		const bots = this.bots.size ? [...this.bots.values()] : [{ ...this.berthOf(0), index: 0, docked: true, path: [] }];

		return bots.map(bot => ({
			y: bot.y,
			draw: () => {
				const at = this.art(bot);
				const working = !bot.docked && !bot.back && !bot.path.length;
				const walking = bot.path.length > 0;
				const bob = (working || walking) && Math.floor(this.time * (walking ? 8 : 4) + bot.index) % 2;
				const lit = !bot.docked;

				rect(ctx, at.x, at.y - 9 - bob, 1, 2, PALETTE.l);
				rect(ctx, at.x - 2, at.y - 7 - bob, 5, 4, PALETTE.k);
				rect(ctx, at.x - 1, at.y - 6 - bob, 3, 2, lit ? PALETTE.o : PALETTE.O);
				rect(ctx, at.x, at.y - 6 - bob, 1, 1, lit ? PALETTE.W : PALETTE.d);
				rect(ctx, at.x - 2, at.y - 3, 5, 3, PALETTE.k);
				rect(ctx, at.x - 1, at.y - 3, 3, 2, PALETTE.m);
				if (working && Math.floor(this.time * 3 + bot.index) % 2) rect(ctx, at.x + 3, at.y - 5, 1, 1, PALETTE.y);
				this.hits.push({
					...this.toScreen({ x: at.x, y: at.y - 4 }),
					r: 5 * this.camera.zoom,
					kind: 'crew',
					crew,
				});
			},
		}));
	}

	// A rug in its branch's hue under each seat working in a worktree of its own, those in the same one joined into one
	// rug; and hazard tape round a seat whose session asks nothing before it acts
	drawMats(ctx) {
		for (const { seat, session, lounging } of this.workers.values()) {
			if (!seat || lounging || seat.housing || session.mode !== 'bypassPermissions') continue;

			const from = this.art({ x: seat.x - DESK_PITCH / 2 + 0.1, y: seat.y - DESK_ROW + 0.6 });
			const to = this.art({ x: seat.x + DESK_PITCH / 2 - 0.1, y: seat.y + 0.45 });

			ctx.drawImage(tapeOf(from, to), from.x, from.y);
		}

		const mats = [...this.workers.values()]
			.filter(({ seat, session }) => seat && !seat.housing && this.checkoutOf(session)?.worktree)
			.map(({ seat, session }) => ({
				x: seat.x - DESK_PITCH / 2,
				y: seat.y - DESK_ROW + 0.5,
				checkout: session.checkout,
				hue: branchHue(this.checkoutOf(session).branch ?? session.checkout),
			}));
		const beside = (mat, across, down) =>
			mats.some(
				other =>
					other.checkout === mat.checkout &&
					Math.abs(other.x - mat.x - across * DESK_PITCH) < 0.01 &&
					Math.abs(other.y - mat.y - down * DESK_ROW) < 0.01,
			);

		for (const mat of mats) {
			const from = this.art(mat);
			const to = this.art({ x: mat.x + DESK_PITCH, y: mat.y + DESK_ROW });
			const [left, right, top, bottom] = [
				!beside(mat, -1, 0),
				!beside(mat, 1, 0),
				!beside(mat, 0, -1),
				!beside(mat, 0, 1),
			];
			const inset = { left: from.x + (left ? 2 : 0), top: from.y + (top ? 2 : 0) };

			rect(ctx, from.x, from.y, to.x - from.x, to.y - from.y, `hsl(${mat.hue} 35% 32%)`);
			rect(
				ctx,
				inset.left,
				inset.top,
				to.x - (right ? 2 : 0) - inset.left,
				to.y - (bottom ? 2 : 0) - inset.top,
				`hsl(${mat.hue} 30% 21%)`,
			);
		}
	}

	// The hold's cargo: for each checkout a stack of sheets for its changed files, and beside it the crates of its
	// commits waiting to go
	cargoParts(ctx) {
		const hold = this.layout.hold;

		if (!hold) return [];

		return this.cargo.map((checkout, index) => {
			const spot = holdSpotAt(hold, index);
			const bay = this.bays.find(({ name }) => name === checkout.project);

			return {
				y: spot.y,
				draw: () => {
					const at = this.art(spot);

					this.drawPod(ctx, at, { hue: bay?.hue, crates: checkout.unpushed, sheets: checkout.changed });
					for (let crate = 0; crate < Math.min(MOST.crates, checkout.unpushed); crate++) {
						const commit = checkout.commits?.[crate];

						if (commit)
							this.hits.push({
								...this.toScreen({ x: at.x + 5 + (crate % 2) * 7, y: at.y - 6 - Math.floor(crate / 2) * 5 }),
								r: 4 * this.camera.zoom,
								kind: 'commit',
								commit,
								checkout,
							});
					}
					const stamp =
						VERDICT_COLORS[
							Ship.worstVerdict(
								this.sessions.filter(({ checkout: root, engine }) => `${engine.key}:${root}` === checkout.key),
							)
						];

					if (stamp && (checkout.changed || checkout.unpushed)) {
						rect(ctx, at.x - 9, at.y + 1, 5, 4, PALETTE.k);
						rect(ctx, at.x - 8, at.y + 2, 3, 2, stamp);
					}
					// Off the trunk, the stack flies its branch's pennant and, close enough, its name
					if (!checkout.trunk && (checkout.changed || checkout.unpushed)) {
						const hue = checkout.branch ? branchHue(checkout.branch) : null;
						const pole = 16 + (index % 2) * 9;

						drawPennant(ctx, { x: at.x - 9, y: at.y - pole, pole }, hue);
						if (this.camera.zoom >= 4)
							this.labels.push({
								text: checkout.branch ?? 'detached',
								at: { x: at.x - 9, y: at.y - pole },
								color: hue === null ? PALETTE.l : `hsl(${hue} 60% 74%)`,
								lift: 0,
								gap: -16,
								width: 2.4 * UNIT.x,
							});
					}
					this.hits.push({
						...this.toScreen({ x: at.x + 4, y: at.y - 4 }),
						r: 10 * this.camera.zoom,
						kind: 'cargo',
						bay,
						checkout,
					});
				},
			};
		});
	}

	// A push leaving: its checkout's pod lets go of the dock and drops out through the doors in the belly under it with
	// its crates aboard
	drawHauler(ctx, { crates, time, pod, project }) {
		const hold = this.layout.hold;

		if (!hold) return;

		const from = holdSpotAt(hold, pod ?? 0);
		const floor = this.layout.gondola ? this.layout.gondola.y + this.layout.gondola.d : this.layout.building.bottom;
		const at = this.art({ x: from.x, y: from.y + (floor + 3 - from.y) * time * time });
		const hue = this.bays.find(({ name }) => name === project)?.hue;

		this.drawPod(ctx, at, { hue, crates, sheets: 0 });
	}

	// A checkout's pod, `at` its foot: a capsule in its project's color with a window down its side, its crates of
	// commits to push and sheets of changes inside
	drawPod(ctx, at, { hue, crates, sheets }) {
		const color = hue === null || hue === undefined ? PALETTE.l : `hsl(${hue} 50% 50%)`;

		rect(ctx, at.x - 12, at.y - 20, 30, 20, PALETTE.k);
		rect(ctx, at.x - 11, at.y - 19, 28, 18, PALETTE.d);
		rect(ctx, at.x - 11, at.y - 19, 28, 2, color);
		rect(ctx, at.x - 13, at.y - 15, 1, 10, PALETTE.k);
		rect(ctx, at.x + 18, at.y - 15, 1, 10, PALETTE.k);
		rect(ctx, at.x - 9, at.y - 15, 24, 12, '#0d1118');
		for (let crate = 0; crate < Math.min(MOST.crates, crates); crate++)
			drawSprite(ctx, 'crate', at.x + 5 + (crate % 2) * 7, at.y - 3 - Math.floor(crate / 2) * 5);
		for (let sheet = 0; sheet < Math.min(4, sheets); sheet++)
			rect(ctx, at.x - 7, at.y - 5 - sheet * 2, 7, 1, PALETTE.W);
	}

	// Whether `who` said something in a session's chat in the last minute and a half ('Claude' for its answers there)
	spoke(session, who) {
		const latest = session.talk?.lately?.at(-1);

		return Boolean(latest && latest.ago < SPOKE_MS && (who === 'Claude' ? latest.fromClaude : latest.author === who));
	}

	// A speech bubble over someone's head, pressable for what was said
	drawSpeech(ctx, { x, y }, session, side = 1) {
		const left = side > 0 ? x + 2 : x - 13;
		const tail = side > 0 ? x + 3 : x - 5;

		rect(ctx, left, y - 9, 11, 7, PALETTE.k);
		rect(ctx, left + 1, y - 8, 9, 5, PALETTE.w);
		rect(ctx, left + 2, y - 6, 2 + (Math.floor(this.time * 3) % 3) * 2, 1, PALETTE.m);
		rect(ctx, tail, y - 2, 2, 2, PALETTE.k);
		rect(ctx, tail + (side > 0 ? 0 : 1), y - 3, 1, 1, PALETTE.w);
		this.hits.push({ ...this.toScreen({ x: left + 5, y: y - 6 }), r: 5 * this.camera.zoom, kind: 'talk', session });
	}

	// A reply, a capsule glowing in its grey's color with a trail; a part, a sheet riding a little float
	// The parcel tube: its station on the bridge, the glass run along the near wall and down into the hold, and its
	// hopper there; drawn in front of all but what's in the tube, as it runs along the nearest wall
	tubeParts(ctx) {
		const { tube } = this.layout;

		if (!tube) return [];

		const points = tube.points.map(point => this.art({ ...point, z: TUBE_Z }));
		const busy = this.parcels.some(parcel => parcel.tube);

		return [
			{
				y: TUBE_FRONT - 0.001,
				draw: () => {
					for (const [index, from] of points.slice(0, -1).entries()) {
						const to = points[index + 1];
						const [x, y] = [Math.min(from.x, to.x), Math.min(from.y, to.y)];
						const [w, h] = [Math.abs(to.x - from.x), Math.abs(to.y - from.y)];
						const across = w >= h;

						rect(ctx, x - (across ? 0 : 2), y - (across ? 2 : 0), w + (across ? 1 : 5), h + (across ? 5 : 1), PALETTE.k);
						rect(ctx, x - (across ? 0 : 1), y - (across ? 1 : 0), w + (across ? 1 : 3), h + (across ? 3 : 1), '#1c2a36');
						if (across) rect(ctx, x, y - 1, w + 1, 1, 'rgba(200, 235, 255, 0.35)');
						else rect(ctx, x - 1, y, 1, h + 1, 'rgba(200, 235, 255, 0.35)');
						// Its clamps every so often
						for (let along = 6; along < Math.max(w, h); along += 14)
							if (across) rect(ctx, x + along, y - 2, 2, 5, PALETTE.m);
							else rect(ctx, x - 2, y + along, 5, 2, PALETTE.m);
					}
					// The station: a column with its hatch, lit while something's on its way
					const station = points[0];

					box(ctx, station.x - 4, station.y - 14, 9, 15, PALETTE.l);
					rect(ctx, station.x - 2, station.y - 11, 5, 4, '#1c2a36');
					rect(ctx, station.x - 2, station.y - 11, 5, 1, 'rgba(200, 235, 255, 0.35)');
					rect(ctx, station.x, station.y - 16, 1, 2, busy && Math.floor(this.time * 6) % 2 ? PALETTE.y : PALETTE.d);
					// The hopper over the stacks, where it comes out
					const hopper = points.at(-1);

					rect(ctx, hopper.x - 4, hopper.y, 9, 4, PALETTE.k);
					rect(ctx, hopper.x - 3, hopper.y, 7, 3, PALETTE.l);
					rect(ctx, hopper.x - 2, hopper.y + 3, 5, 1, PALETTE.m);
				},
			},
		];
	}

	drawParcel(ctx, parcel) {
		const color = `hsl(${parcel.hue ?? 200} 75% 66%)`;

		// A capsule shooting through the tube, its band in its session's color
		if (parcel.tube) {
			const at = this.art({ ...parcel, z: TUBE_Z });

			rect(ctx, at.x - 2, at.y - 1, 5, 3, '#d8e2ee');
			rect(ctx, at.x, at.y - 1, 1, 3, color);

			return;
		}

		const at = this.art({ ...parcel, z: 0.5 });

		rect(ctx, at.x - 2, Math.round(at.y + 0.5 * UNIT.z) - 1, 5, 1, 'rgba(0, 0, 0, 0.3)');
		if (parcel.kind === 'reply') {
			rect(ctx, at.x - 3, at.y - 2, 7, 4, PALETTE.k);
			rect(ctx, at.x - 2, at.y - 1, 5, 2, color);
			rect(ctx, at.x - 1, at.y - 1, 1, 1, PALETTE.W);
			rect(ctx, at.x - 5 * (parcel.facing ?? 1), at.y, 2, 1, color);
		} else drawSprite(ctx, 'paper', at.x, at.y + 2);
	}

	// Walking, seen from the front; at their place by their pose
	drawWalker(ctx, walker) {
		const at = this.art(walker);
		const key = walker.person?.key;
		const { departing, arriving } = this;
		// Beaming out on the transporter's pad, or just beamed in on it: fading inside a column of light
		const out =
			key && departing?.key === key && departing.beamAt !== undefined
				? (this.time - departing.beamAt) / BEAM_SECONDS
				: null;
		const into = key && arriving?.key === key ? (this.time - arriving.at) / BEAM_SECONDS : null;
		const beam = out ?? (into !== null && into < 1 ? 1 - into : null);

		if (beam !== null) ctx.globalAlpha = Math.max(0, 1 - beam);
		const stride = walker.path.length ? STEPS[Math.floor(walker.step) % STEPS.length] : '';
		const colors = { c: `hsl(${walker.person.hue} 45% 45%)`, s: `hsl(${walker.person.hue} 45% 45%)` };
		const there = !walker.path.length && !walker.leaving && walker.spot;

		if (there && walker.pose === 'copilot') {
			rect(ctx, at.x - 3, at.y - 4, 7, 2, PALETTE.m);
			rect(ctx, at.x - 1, at.y - 2, 3, 3, PALETTE.k);
			drawSprite(ctx, 'suit', at.x, at.y - 4, { colors });
		} else if (there && walker.pose === 'overseer') {
			drawSprite(ctx, 'suit', at.x, at.y, { colors, flip: walker.stand < 0 });
			if ((this.time + seeded(walker.name) * 5) % 5 < 1.2)
				rect(ctx, at.x + walker.stand * 3, at.y - 8, 2, 2, PALETTE.t);
		} else if (there && walker.pose === 'tourist') {
			drawSprite(ctx, 'suitBack', at.x, at.y, { colors });
			if ((this.time + seeded(walker.name) * 7) % 7 < 0.12) {
				rect(ctx, at.x - 6, at.y - 18, 3, 3, PALETTE.W);
				rect(ctx, at.x - 7, at.y - 17, 5, 1, PALETTE.W);
			}
		} else {
			rect(ctx, at.x - 3, at.y, 7, 1, PALETTE.k);
			drawSprite(ctx, `suit${stride}`, at.x, at.y, { colors, flip: walker.facing < 0 });
		}
		ctx.globalAlpha = 1;
		if (beam !== null) this.drawBeam(ctx, at, Math.min(1, 0.4 + beam));
		this.hits.push({
			...this.toScreen({ x: at.x, y: at.y - 7 }),
			r: 7 * this.camera.zoom,
			kind: 'person',
			person: walker.person,
		});
		const talking = walker.person.sessions
			.map(key => this.workers.get(key)?.session)
			.find(session => session && this.spoke(session, walker.name));

		if (talking && there) this.drawSpeech(ctx, { x: at.x, y: at.y - 16 }, talking);
	}

	// What needs you shows on a grey's terminal; only one in the lounge, with no terminal, has it over its head: amber
	// with a bang when it's asking, blue when there's news. At the farthest zooms it's drawn bigger, so what needs you
	// reads however far out the view is.
	drawMarker(ctx, worker) {
		const need = this.needs(worker.session);

		if (!need || !worker.lounging) return;

		// One watching the lounge's TV has it beside its head, clear of the picture
		const beside = worker.lounging && !worker.path?.length ? 10 : 0;
		const head = { x: (worker.headX ?? 0) + beside, y: (worker.top ?? 0) + 14 + beside };
		const grow = this.camera.zoom <= 2 ? 2 : 1;
		const bob = need === 'asking' && Math.floor(this.time * 3) % 2 ? 1 : 0;
		const { h } = spriteSize('news');

		ctx.save();
		ctx.translate(head.x, head.y - 16 - bob);
		ctx.scale(grow, grow);
		if (need === 'asking') drawSprite(ctx, 'asking', 0, 0);
		else {
			rect(ctx, -4, -h + 2, 9, 6, PALETTE.k);
			rect(ctx, -3, -h + 3, 7, 4, PALETTE.b);
			for (let step = 0; step < 3; step++) {
				rect(ctx, -3 + step, -h + 3 + step, 1, 1, PALETTE.W);
				rect(ctx, 3 - step, -h + 3 + step, 1, 1, PALETTE.W);
			}
		}
		ctx.restore();
		worker.marker = this.toScreen({ x: head.x, y: head.y - 16 - (h * grow) / 2 });
		this.hits.push({ ...worker.marker, r: 6 * grow * this.camera.zoom, kind: 'worker', worker });
	}

	// Every word in the scene, last and on top, at the same size on the screen whatever the zoom: `at` in art pixels,
	// `lift` art pixels up from it, then `gap` screen pixels more; each with a dark shadow to read over anything. Words
	// too long for their `width` take their `short` word if it fits, then drop to the smallest size, before they're cut
	// short.
	drawLabels(ctx, ratio) {
		const sizing = label => {
			const { size: wanted = TEXT, width = Infinity, text, short } = label;
			const key = `${wanted}|${width}|${this.camera.zoom}|${text}|${short}`;
			const held = this.fitted.get(key);

			if (held) return held;
			if (this.fitted.size > 400) this.fitted.clear();

			const found = sized(label);

			this.fitted.set(key, found);

			return found;
		};
		const sized = label => {
			const { size: wanted = TEXT, width = Infinity, text, short } = label;
			const room = width * this.camera.zoom;
			const fits = (words, size) => textWidth(String(words), size) <= room;

			// Too long for its place: its short word at its size, else the smallest size, and past that its head and tail
			// with the middle left out, since cutting off its end can leave another name (product-worktree-rescue read as
			// product)
			if (fits(text, wanted)) return { text, size: wanted };
			if (short && fits(short, wanted)) return { text: short, size: wanted };

			const small = short && !fits(text, 1) ? short : text;

			if (fits(small, 1)) return { text: small, size: 1 };
			for (let keep = small.length - 3; keep >= 2; keep--) {
				const elided = `${small.slice(0, Math.ceil(keep / 2))}..${small.slice(small.length - Math.floor(keep / 2))}`;

				if (fits(elided, 1)) return { text: elided, size: 1 };
			}

			return { text: small, size: 1 };
		};
		// The rooms' signs all at one size, the size the tightest needs, so none stands out beside its neighbors
		const signs = this.labels.filter(({ sign }) => sign);
		const signSize = Math.min(...signs.map(label => sizing(label).size));

		for (const label of this.labels) {
			const { at, color, align, lift = 0, gap = 0, size: wanted = TEXT, width = Infinity } = label;
			const { text, size } = sizing(label.sign && signSize < wanted ? { ...label, size: signSize } : label);
			const point = this.toScreen({ x: at.x, y: at.y - lift });
			const [x, y] = [point.x / size, (point.y + (gap * size) / wanted) / size];
			const fit = (width * this.camera.zoom) / size;

			ctx.setTransform(ratio * size, 0, 0, ratio * size, 0, 0);
			pixelText(ctx, text, x + 1, y + 1, { color: PALETTE.k, align, max: fit });
			pixelText(ctx, text, x, y, { color, align, max: fit });
		}
	}

	// A room's floor on the screen, for what's hit there
	area({ x, y, w, d }) {
		const [from, to] = [this.screen({ x, y }), this.screen({ x: x + w, y: y + d })];

		return { left: from.x, top: from.y, right: to.x, bottom: to.y };
	}

	// The smallest thing under the point, a room only when nothing in it is; figures drawn later sit on top of those
	// before them
	hit(x, y) {
		const inside = ({ left, top, right, bottom }) => x >= left && x <= right && y >= top && y <= bottom;

		return this.hits
			.map((target, order) => ({ ...target, order, distance: Math.hypot(target.x - x, target.y - y) }))
			.filter(({ distance, r, area }) => (area ? inside(area) : distance <= r))
			.sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || b.order - a.order)[0];
	}
}
