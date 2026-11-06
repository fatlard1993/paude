import { facilitiesFor, facilityOf } from '../../shared/facilities';
import { cksum } from '../../shared/hues';
import { PALETTE, drawSprite, spriteSize } from './art';
import { drawLighting, lightOf } from './lighting';
import { FORMS, drawCore, drawHousing } from './machine';
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
	drawHullCover,
	drawShuttle,
	drawTanker,
	drawTank,
	hullEdges,
	drawTug,
} from './hull';
import {
	standingOf,
	walkwayOf,
	airlockAt,
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
	COUCH_SEAT,
	drawIsland,
	drawLaptop,
	drawSeat,
	housingOf,
	drawHall,
	couchEndOf,
	loungeSeatAt,
	rect,
	noise,
	seeded,
	HALL_TRAY_IN,
	SCREEN_RISE,
	cableStep,
	cableWeight,
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
// A shuttle bringing someone aboard or taking them off: how long it takes to fly in, its tube to reach the hull, them
// to walk its length, its tube to draw back up, and it to fly off, in seconds; and how long one come to take someone
// off waits for them before going anyway
const SHUTTLE = { fly: 1.6, tube: 0.6, walk: 1.6, retract: 0.5 };
// The one opening the view comes aboard as the ship comes in: in warp, just their shuttle among the streaking stars,
// close up (`warp`); the ship pulling in under it as the view draws back to all of it (the ship's own coming in,
// ENTER_SECONDS); its plating shimmering as the shuttle settles on it (`settle`); then its tube and their walk. How
// much closer than the whole ship the view starts, in zoom.
const JOIN = { warp: 1.2, settle: 1.2, closer: 3, tubeCloser: 2, opened: 2.6, stepped: 1.7 };
// How long the view watches the one looking walk out from the airlock before what's to be focused on opening is, in
// seconds: long enough to see them clear it, not the whole way to where they belong
const WALK_IN_MOST = 1.4;
// How long someone just come aboard stands in the airlock's doorway as its door opens before stepping out, in seconds
const DOORWAY_SECONDS = 0.6;
// How fast the view's zoom eases to where it's going, as a rate
const ZOOM_EASE = 2.6;
const SHUTTLE_WAITS = 20;
// How long a can's toss onto its pile takes, and a drink of a grey's coffee or energy drink
const TOSS_SECONDS = 0.7;
// How far apart the crew's bots wait in line below engineering's door, and the first of them below it
const BERTH_GAP = 0.55;
// The most sleds a project's rack of processes shows
const RACK_SLEDS = 4;
// How fast an island rises out of the floor, and then its terminals out of it, as a part of each a second; how tall
// its console stands, in art pixels
const ISLAND_RISE_RATE = 1.8;
const CONSOLE_TALL = 14;
// A top deck's machine's name, inside the hull under its ceiling: how far down it's drawn, and how far down the machine
// starts to clear it, in art pixels
const NAME_INSIDE = 9;
const NAME_ROOM = 12;
// How far aft of the transporter's pad the viewer waits while looking at it, in world units
const BESIDE_PAD = 1.1;
// A grey on its feet, half its width and its height, in art pixels, for what it passes behind
const GREY_SIZE = { half: 6, tall: 26 };
// How long a commit's press takes over its pod, and how much of a push the pod spends lifting off its cradle before it
// drops
const PACK_SECONDS = 1.4;
// How fast the hold's crane wanders its rail when it has nothing to press, as a rate
const CRANE_WANDER = 0.3;
// How far under the hopper a part hangs on the crane's hook as it's carried, in world units
const HOOK_HANG = 0.6;
const HAUL_LIFT = 0.08;
// How far a jettisoned pod falls away under the ship and is left aft of it by the end of its push, in world units, and
// how much smaller it's gone with the distance
const JETTISON = { down: 14, aft: 10, shrink: 0.7 };
// The tug's flight seeing a push off, as parts of it: lifting off its pad, down out through the hangar's belly doors,
// after the pod until both are gone from sight, away, and back up onto its pad from under the ship
const TUG_FLIGHT = { lifted: 0.08, below: 0.28, escorting: 0.45, gone: 0.76, home: 1 };
// How far the tug hovers over its pad lifting off, and under the ship it waits for the pod, in world units
const TUG_HOVER = 0.7;
const TUG_UNDER = 1.6;
const DRINK_SECONDS = 6;
// How long the tube's nozzle takes to bring a grey its coffee or its giant cup, or take them away: down from the ceiling, a
// moment at the desk, and back up
const SERVE_SECONDS = 1.6;
// Thinking: how long a grey's skull takes to brighten and dim again, in seconds, and how far up from its chin its eyes
// are, in art pixels, the same on every size of head
const THINK_BREATH = 2.2;
const EYES_UP = 6;
// The part of a drink spent lifting the cup to its mouth, and again setting it back
const DRINK_LIFT = 0.15;
// How long a beam off a transporter, or onto one, lasts
export const BEAM_SECONDS = 0.9;
// How long the ship takes coming in out of warp, opened no sooner however fast what's aboard comes in
const ENTER_SECONDS = 3.5;
// How quickly islands and seats glide to where a changed layout puts them: the share of the way left gone each second,
// as a rate (about a third of a second to get most of the way)
const LAYOUT_EASE = 7;
// How long a conduit laid anew takes to fade from where it ran to where it runs now
const CABLE_FADE_SECONDS = 0.5;
// How long the conduits last drawn stay while a changed layout has none yet, at most
const CABLE_HOLD_SECONDS = 0.25;
// How long the stars' streaks are at the start of it, in screen pixels for the nearest
const WARP_STREAK = 160;
// How long the outer plating takes to fade once what's aboard has come in
const OPEN_SECONDS = 0.8;
// Between the sessions' keys of a group picked together, in its selection's key: a session's key holds ':' and '/'
export const GROUP_SEPARATOR = '|';
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
// How far in from the bridge's aft wall those walking along it go: clear of the ends of its islands' consoles
const BRIDGE_WALL = 0.4;
// How long after another the next bot sent out sets off
const BOT_GAP = 0.45;
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
const HAUL_SECONDS = 6;
// How fast the bay doors in the belly slide, as a part of their way a second
const BAY_DOOR_RATE = 2.5;
// How long a refuel ship's visit takes, and how much fuller a tank must read than it did to have been refuelled (a
// usage limit's window rolling over)
const REFUEL_SECONDS = 9;
const REFUELLED = 0.04;
// How far forward of its tank a refuel ship settles, clear of the stern's fin, in art pixels
const REFUEL_FORWARD = 16;
// How far above the last a tank stands on the rack over the reactors, in art pixels
const TANK_RACK = 17;
// Something said in a session's chat shows over its speaker this long
const SPOKE_MS = 90_000;
// How fast what the work made travels the ship
const PARCEL_SPEED = 4;
// How fast a part shoots through the tube, in art pixels a second; how high its run along the floor is; and where in
// the drawing order the tube stands, in front of everything in the rooms it runs over
const TUBE_PX = 90;
// How long a nozzle takes to come down from the ceiling, draw a part up and go back; how far above its seat's foot the
// pipe over a row of islands runs, in art pixels
const POP_SECONDS = 1;
// The other ships' terminals: how far in from the bridge's near wall and its forward end they stand, and how far apart
const FLEET_FROM_WALL = 0.45;
const FLEET_NOSE = 1.0;
const FLEET_PITCH = 1.8;
// How far up from its foot a terminal reaches, in world units, for keeping clear of islands near the wall
const FLEET_TALL = 2.6;
const TUBE_GLASS = { body: '#34506a', shine: 'rgba(210, 240, 255, 0.6)' };
// How far down a tube coming out of the ceiling fades in, in art pixels
const FADE_IN = 8;
const CEILING = 36;
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
// How long a deleted session takes to crumble to dust, and how long its heap stays after
const VAPOR_SECONDS = 1.6;
// A heap of ash where a deleted session crumbled: how long it lies before the tube's nozzle comes down for it, takes
// coming down, takes sucking it up, and takes going back up, in seconds
const ASH = { lies: 2.5, down: 0.6, sucks: 1.4, up: 0.6 };
const DUST_SECONDS = ASH.lies + ASH.down + ASH.sucks + ASH.up;
// A couch dropped into the lounge by the tube: how long its nozzle takes to come down, the couch to fall out of it and
// settle, and the nozzle to go back up; and one no longer needed, phasered by the last to get up from it: how long they
// aim and fire, and it takes to crumble to ash, in seconds; how lately they must have got up to be the one
const COUCH_DROP = { down: 0.5, fall: 0.45, settle: 0.25, up: 0.5 };
const COUCH_BLAST = { aim: 1, crumble: 0.6, lately: 6 };
const DUST = { light: '#a7adb6', dark: '#6f7680' };

// The giant cup's colors, its zap the dot on its band
const CUP = {
	red: '#d63a3a',
	lit: '#ef7a6a',
	shade: '#9e2626',
	white: '#f2eee6',
	whiteShade: '#c4bdb0',
	zap: '#ffe14a',
	lid: '#b8c4d4',
	straw: '#ff8a1c',
	strawLit: '#ffc27a',
};
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
// One deleted once its cache lets go, sitting on the floor with a laptop rather than at its console
const briefOf = worker => worker.session.lifetime === 'brief' && !worker.lounging && !worker.seat?.housing;
// How far before its console's foot such a one sits
const ON_FLOOR = 0.75;

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
// What's left of a limit, 0 to 1; one not told of has all of it left
const leftOf = limit => Math.max(0, Math.min(1, 1 - (limit?.percent ?? 0) / 100));

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
		// The account's own limits, as the machine that asked them latest heard
		if (engine.fuel.usage && (!tank.usage || engine.fuel.usage.ago < tank.usage.ago)) tank.usage = engine.fuel.usage;
		tanks.set(key, tank);
	}

	return [...tanks.values()].map(tank => {
		// What's left of each limit, 0 to 1; the tank as full as the one nearest running out
		const gauges = tank.usage && {
			session: leftOf(tank.usage.session),
			week: leftOf(tank.usage.week),
		};
		const estimate = tank.capacity ? Math.max(0, Math.min(1, 1 - tank.burned / tank.capacity)) : null;

		return {
			...tank,
			empty: tank.engines.some(({ limit }) => limit),
			gauges,
			level: gauges ? Math.min(gauges.session, gauges.week) : estimate,
			flow: flowOf(tank.rate),
		};
	});
};

// Hazard tape from `from` to `to` (art pixels), painted once for its size and where its stripes fall
const tapes = new Map();
const tapeOf = (from, to) => {
	const [w, h] = [to.x - from.x, to.y - from.y];
	const phase = (((from.x + from.y) % 4) + 4) % 4;
	const key = `${w},${h},${phase}`;

	if (tapes.has(key)) return tapes.get(key);
	if (tapes.size > 60) tapes.clear();

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

// How far behind an island's console someone walks to or from its seats, and how far past its end they go round it,
// in world units
const BEHIND_CONSOLE = 0.15;
const ROUND_ISLAND = 0.25;

// The island on the bridge whose seat `point` is at, behind its console
const islandAt = (bridge, point) =>
	bridge.islands?.find(({ x, y, w }) => point.x >= x && point.x <= x + w && Math.abs(point.y - y) <= 0.3);

// From `point` on the bridge out to its row's walkway: from a seat, behind its island's console, past the others sat
// there, to its aft end and round it; from anywhere else, straight down to it
const toWalkway = (bridge, point) => {
	const walkway = walkwayOf(bridge, point.y);
	const island = islandAt(bridge, point);

	if (!island) return [{ x: point.x, y: walkway }];

	const [back, end] = [island.y - BEHIND_CONSOLE, island.x - ROUND_ISLAND];

	return [
		{ x: point.x, y: back },
		{ x: end, y: back },
		{ x: end, y: walkway },
	];
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
		const inside = room.aisle ?? door.x + (door.side === 'left' ? 0.6 : -0.6);
		const outside = door.x + (door.side === 'left' ? -0.4 : 0.4);

		// Off the bridge down its row's walkway, then along its aft wall, never through an island nor over the screens of
		// the row before it
		if (room.kind === 'bridge') {
			const out = toWalkway(room, from);
			const wall = door.x + (door.side === 'left' ? BRIDGE_WALL : -BRIDGE_WALL);

			return [
				...out,
				{ x: wall, y: out.at(-1).y },
				{ x: wall, y: lane },
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

// Axis-aligned points bent round `box` ({ left, right, top, bottom }) wherever a straight run of them would cross it end
// to end: out to its nearer edge (its far one, the top, when it's `walled` at the bottom; `over` in place of its top
// when the way over it runs elsewhere), along it, and back, `apart` further out and `step` clear of its sides; then without the back-and-forth that leaves where the run before or after
// already heads that way
export const bendAround = (points, box, { walled = false, apart = 0, step = 1, over } = {}) => {
	const bent = [points[0]];

	for (const [index, to] of points.slice(1).entries()) {
		const at = points[index];
		const across = at.y === to.y && at.y > box.top && at.y < box.bottom;
		const down = at.x === to.x && at.x > box.left && at.x < box.right;

		if (across && Math.min(at.x, to.x) < box.left && Math.max(at.x, to.x) > box.right) {
			const edge = walled || at.y - box.top < box.bottom - at.y ? (over ?? box.top) - apart : box.bottom + apart;
			const [near, far] = [box.left - step - apart, box.right + step + apart];
			const [enter, leave] = to.x > at.x ? [near, far] : [far, near];

			bent.push({ x: enter, y: at.y }, { x: enter, y: edge }, { x: leave, y: edge }, { x: leave, y: at.y });
		} else if (down && Math.min(at.y, to.y) < box.top && Math.max(at.y, to.y) > box.bottom) {
			const edge = at.x - box.left < box.right - at.x ? box.left - apart : box.right + apart;
			const [near, far] = [box.top - step - apart, box.bottom + step + apart];
			const [enter, leave] = to.y > at.y ? [near, far] : [far, near];

			bent.push({ x: at.x, y: enter }, { x: edge, y: enter }, { x: edge, y: leave }, { x: at.x, y: leave });
		}
		bent.push(to);
	}

	return bent.length === points.length ? points : withoutDoublingBack(bent, box);
};

const within = (value, a, b) => value >= Math.min(a, b) && value <= Math.max(a, b);
// The most a step across can be and still be a jog to straighten, in art pixels
const JOG = 6;

// Whether an axis-aligned run from `a` to `b` passes through the inside of `box`
const through = (a, b, box) =>
	Math.max(a.x, b.x) > box.left &&
	Math.min(a.x, b.x) < box.right &&
	Math.max(a.y, b.y) > box.top &&
	Math.min(a.y, b.y) < box.bottom;

// Axis-aligned points without a U or a jog: a run out, across, and straight back toward where it came from is cut short
// at the turn it needed, and one that steps across on its way goes across first, so long as the shorter way stays out
// of `box`
const withoutDoublingBack = (points, box) => {
	const out = [...points];

	for (let index = 0; index + 3 < out.length; index++) {
		const [a, b, c, d] = out.slice(index, index + 4);

		for (const [main, cross] of [
			['y', 'x'],
			['x', 'y'],
		]) {
			if (a[cross] !== b[cross] || b[main] !== c[main] || c[cross] !== d[cross]) continue;

			// Out, across and back: cut short at the turn it needed. Out and on the same way, a jog across between: across
			// at the start instead
			const turn =
				(b[main] - a[main]) * (d[main] - c[main]) < 0
					? (within(d[main], a[main], b[main]) && { [cross]: a[cross], [main]: d[main] }) ||
						(within(a[main], c[main], d[main]) && { [cross]: c[cross], [main]: a[main] })
					: Math.abs(c[cross] - b[cross]) <= JOG && { [cross]: c[cross], [main]: a[main] };

			if (turn && !through(a, turn, box) && !through(turn, d, box)) {
				out.splice(index + 1, 2, turn);
				index = Math.max(-1, index - 2);
				break;
			}
		}
	}

	return out;
};

const pathLength = points =>
	points
		.slice(1)
		.reduce((sum, point, index) => sum + Math.hypot(point.x - points[index].x, point.y - points[index].y), 0);

// The point `along` pixels down a path
const pointAlong = (points, along) => {
	let left = along;

	for (const [index, to] of points.slice(1).entries()) {
		const from = points[index];
		const length = Math.hypot(to.x - from.x, to.y - from.y);

		if (left <= length)
			return {
				x: Math.round(from.x + ((to.x - from.x) * left) / (length || 1)),
				y: Math.round(from.y + ((to.y - from.y) * left) / (length || 1)),
			};
		left -= length;
	}

	return points.at(-1);
};

// Where risers as thick as `weights` stand along the bridge's aft wall at `wall`, in art pixels across, the first 4 in:
// side by side with a clear gap between each (their outlines included), as wide as RISER_GAP, narrower where that
// would bring the last within a few pixels of the lounge's stern edge at `lounge` (null for none)
export const risersFor = (wall, lounge, weights) => {
	const thick = weights.reduce((sum, weight) => sum + weight + 2, 0);
	const room = lounge === null ? Infinity : lounge - 5 - (wall + 4);
	const gap =
		weights.length < 2
			? RISER_GAP
			: Math.max(0, Math.min(RISER_GAP, Math.floor((room - thick) / (weights.length - 1))));
	let x = wall + 4;

	return weights.map(weight => {
		const at = x + 1 + Math.floor(weight / 2);

		x += weight + 2 + gap;

		return at;
	});
};
// The height each island's cable runs along its row at, in art pixels, for cables as thick as their `weight` ending at
// `x`, `y` (an island's console's foot): islands sharing a row each at their own, the nearest the wall along the foot
// and each further one a cable's width below the last, in the aisle under the row, their outlines meeting; so none lies
// on another or over a nearer island, and each comes up into its own
export const runsFor = ends => {
	const runs = [];
	const rows = new Map();

	ends.forEach((end, index) => rows.set(end.y, [...(rows.get(end.y) ?? []), { ...end, index }]));
	for (const row of rows.values()) {
		let below = 0;
		let above = null;

		for (const { y, weight, index } of row.sort((a, b) => a.x - b.x)) {
			if (above !== null) below += cableStep(above, weight);
			runs[index] = y + below;
			above = weight;
		}
	}

	return runs;
};

// The clear gap between neighbouring risers, outlines apart, when there's room
const RISER_GAP = 2;
// How far into the lounge, from its back wall, its couches start, in world units: a droid by the wall is clear of them
const LOUNGE_FURNISHED = 0.6;
// How many times the risers of a bridge with too many to try every order are gone over, pairs swapped
const SWAP_PASSES = 4;

// A project's conduit: in its color while any of its sessions is at an island, dark with all of them away
const wireColor = (hue, manned) => {
	if (!manned) return hue === null || hue === undefined ? PALETTE.d : `hsl(${hue} 25% 24%)`;

	return hue === null || hue === undefined ? PALETTE.l : `hsl(${hue} 60% 52%)`;
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
	refuels = [];
	// The shuttles on their way to or from the airlock: [{ key, hue, kind: 'in' | 'out', at, climbAt }]; `at` not yet
	// set for one that waits for the ship to come in out of warp
	shuttles = [];
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
	// Heaps of dust where deleted sessions crumbled: { x, y, depth, at }
	dust = [];
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
	// When each checkout last had its changes pressed into a commit's crate, by its key
	packings = new Map();
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
		if (this.looking === 'free') return this.flyingTo ?? null;

		const joining = this.joinGoal();

		if (joining) return joining;

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

	// Coming aboard as the ship comes in, the view tells it: on the shuttle close up in warp, drawn back step by step to
	// the whole ship as it pulls in and shimmers, drawn in on the airlock as its tube comes down and they walk it, and
	// back out to the whole ship as it opens and they step out; null once that's done, or for anyone not coming aboard
	joinGoal() {
		if (this.joinAt === undefined || !this.layout?.building || !this.airlock) return null;

		const since = this.time - this.joinAt;
		const shuttle = this.shuttles.find(({ join }) => join);
		const boarded = (shuttle ? this.approachOf(shuttle) : 0) + SHUTTLE.tube + SHUTTLE.walk;

		if (since >= boarded + JOIN.opened) return null;

		this.joinAt = undefined;
		const whole = this.goal();

		this.joinAt = this.time - since;

		const dock = { x: this.art(this.airlock).x, y: hullEdges(this.layout.building).top };
		const pulled = JOIN.warp + ENTER_SECONDS;

		// Over its tube while they walk it, and on through the airlock as its door opens on them, the plating fading
		// round them and they step out; then the whole ship again
		if (since >= pulled + JOIN.settle)
			return since < boarded + JOIN.stepped
				? { x: dock.x, y: dock.y + 8, zoom: Math.min(ZOOMS.most, whole.zoom + JOIN.tubeCloser) }
				: whole;
		if (since >= pulled) return whole;

		const away = shuttle ? 1 - 0.65 * Math.max(0, Math.min(1, (since - JOIN.warp) / ENTER_SECONDS)) : 0;
		const near = { x: dock.x + away * 240, y: dock.y - 14 - away * 90 };
		const back = Math.max(0, Math.min(1, (since - JOIN.warp) / ENTER_SECONDS));

		return {
			x: near.x + (whole.x - near.x) * back,
			y: near.y + (whole.y - near.y) * back,
			// Drawn back smoothly rather than a step at a time, ending on the whole ship's own zoom
			zoom: Math.min(ZOOMS.most, whole.zoom + JOIN.closer * (1 - back) ** 2),
		};
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
		this.flyingTo = null;
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
	// Flown to, the view gliding there and drawing in rather than jumping; free to roam once there
	lookAt(point) {
		const at = this.art(point);

		this.looking = 'free';
		this.flyingTo = { x: at.x, y: at.y - 10, zoom: Math.max(Math.round(this.camera.zoom), 4) };
	}

	pan(across, down) {
		this.looking = 'free';
		this.flyingTo = null;
		this.camera.x -= across / this.camera.zoom;
		this.camera.y -= down / this.camera.zoom;
	}

	// A step in or out, keeping what's under the pointer there
	zoom(factor, { x, y }) {
		const before = this.camera.zoom;
		const zoom = Math.max(ZOOMS.least, Math.min(ZOOMS.most, before + (factor > 1 ? 1 : -1)));

		if (zoom === before) return;
		this.looking = 'free';
		this.flyingTo = null;
		this.camera.x += (x - this.width / 2) * (1 / before - 1 / zoom);
		this.camera.y += (y - this.height / 2) * (1 / before - 1 / zoom);
		this.camera.zoom = zoom;
	}

	// answers: [{ key, name, hue, remote, error, projects, sessions, people }], what each engine last answered
	update(answers) {
		// Its own paude's, for its name and color on its hull
		this.own = answers[0];

		const sessions = answers.flatMap(answer =>
			(answer.sessions ?? []).map(session => ({
				...session,
				key: sessionKey(answer.key, session.id),
				engine: { key: answer.key, name: answer.name, hue: answer.hue, remote: answer.remote },
			})),
		);
		const keys = new Set(sessions.map(({ key }) => key));

		for (const worker of this.workers.values())
			worker.leaving = !keys.has(worker.session.key) || worker.vaporizedAt !== undefined;
		for (const session of sessions) {
			const worker = this.workers.get(session.key);

			if (worker && (session.reply?.turn ?? 0) > (worker.session.reply?.turn ?? 0)) {
				worker.finishedAt = this.time;
				this.outgoing.push({ kind: 'reply', key: session.key });
			}
			const lounging = resting(session);

			// Its empties go with it from the lounge, so a pile is only ever since its cache last went cold
			if (worker && !lounging) worker.cans = undefined;
			// The last to get up from the lounge, to phaser a couch no longer needed
			if (worker?.lounging && !lounging) this.lastUp = { key: session.key, at: this.time };
			if (worker?.seat && worker.lounging !== lounging)
				worker.trip = {
					from: { x: worker.x ?? this.placeOf(worker).x, y: worker.y ?? this.placeOf(worker).y },
					room: worker.room ?? worker.bay,
				};
			if (worker && (worker.session.context?.fill ?? 0) - (session.context?.fill ?? 1) >= COMPACTED) {
				worker.compactedAt = this.time;
				worker.compactedFrom = this.headOf(worker.session);
			}
			// Its coffee or giant cup given or taken: the tube brings it, or takes it away
			if (worker && keepingOf(worker.session) !== keepingOf(session))
				worker.serving = { at: this.time, give: keepingOf(session), take: keepingOf(worker.session) };
			if (worker) Object.assign(worker, { session, lounging, leaving: worker.vaporizedAt !== undefined });
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

		const onCouches = [...this.workers]
			.filter(([, worker]) => worker.lounging && (!worker.leaving || worker.opacity > 0))
			.map(([key]) => key);
		// Each keeps its couch while it stays, and one deleted there keeps its place until its dust has gone, so the couches
		// aren't moved from under its heap; newcomers after them
		const held = new Set(this.dust.map(({ key }) => key).filter(Boolean));
		const kept = (this.lounging ?? []).filter(key => onCouches.includes(key) || held.has(key));
		const lounging = [...kept, ...onCouches.filter(key => !kept.includes(key))];

		this.lounging = lounging;

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
			// Each island in the row it stood in last time
			kept:
				this.bridge?.islands && Object.fromEntries(this.bridge.islands.map(({ key, row, at }) => [key, { row, at }])),
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
		this.tanks = this.refuelled(tanksOf(this.engines));
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
		this.tendCouches();

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
		// A place held for one gone from it (its dust still there) seats nobody
		this.lounge?.sessions.forEach((key, index) =>
			Object.assign(this.workers.get(key) ?? {}, {
				seat: loungeSeatAt(this.lounge, index),
				bay: this.lounge,
				room: this.lounge,
			}),
		);
		// Islands that had to move: those sat at them get up and walk to where they've gone, rather than gliding there
		const stood = this.islandSpots ?? new Map();

		this.islandSpots = new Map((this.bridge?.islands ?? []).map(island => [island.key, `${island.row}@${island.at}`]));

		const relocated = new Set(
			[...this.islandSpots].filter(([key, spot]) => stood.has(key) && stood.get(key) !== spot).map(([key]) => key),
		);

		for (const worker of this.workers.values()) this.easeSeats(worker, relocated);
		this.send();
		this.board();
		this.launch();
		for (const answer of answers) if (answer.sessions) this.answered.add(answer.key);
	}

	placeOf(worker) {
		const { seat } = worker;

		if (worker.lounging) return { x: seat.x, y: seat.y };

		// A short-lived one sits on the floor before its console, working from a laptop
		return briefOf(worker) ? { x: seat.x + 0.3, y: seat.y + ON_FLOOR } : { x: seat.x + 0.3, y: seat.y + 0.2 };
	}

	// From a point in one room to one in another: to its door, out to the spine (along `lane`, the spine's middle unless
	// given), along it, and in; from nowhere (`room` null) it starts on the spine
	route(from, room, to, toRoom, lane = this.layout.halls[0]?.lane) {
		// Within one room, or between rooms on the bridge, straight there
		const home = place => place?.within ?? place;

		if (lane === undefined || home(room) === home(toRoom))
			return home(room) === this.bridge ? this.acrossBridge(from, to) : [to];

		const out = room ? exitOf(room, from, lane) : [{ x: from.x, y: lane }];

		// Round the lounge on the way, whoever's walking
		return this.walkAround(from, [...out, ...exitOf(toRoom, to, lane).reverse(), to]);
	}

	// From one place on the bridge to another down the rows' walkways and up or down its aft wall, round the islands
	// rather than through them, where nobody walks over a screen
	acrossBridge(from, to) {
		const wall = this.bridge.x + BRIDGE_WALL;
		const [out, back] = [toWalkway(this.bridge, from), toWalkway(this.bridge, to).reverse()];
		const [leave, reach] = [out.at(-1).y, back[0].y];
		const along =
			leave === reach
				? []
				: [
						{ x: wall, y: leave },
						{ x: wall, y: reach },
					];

		return this.walkAround(from, [...out, ...along, ...back, to]);
	}

	// From where a walker is to a new spot: across the ship by the spine; within the bridge along its aisles; within
	// any other room straight there
	walkTo(walker, spot, room) {
		if (room !== walker.room) return this.route(walker, walker.room, spot, room);

		return room?.kind === 'bridge' ? this.acrossBridge(walker, spot) : [spot];
	}

	// A walk's path from `from`, bent round the lounge rather than over its couches
	walkAround(from, path) {
		const { lounge } = this;

		if (!lounge?.count) return path;

		const box = {
			left: lounge.x - 0.1,
			right: lounge.x + lounge.w + 0.2,
			top: lounge.y + 0.2,
			bottom: lounge.y + lounge.d,
		};
		return bendAround([from, ...path], box, { walled: this.loungeWalled(), step: 0.1, over: this.loungeOver() }).slice(
			1,
		);
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
			if (this.moved && worker.trip && !worker.trip.fromSeat) worker.trip = this.tripAfterMoving(worker.trip);
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
				// Committed: its changes pressed into a crate of their own
				if (before !== undefined && checkout.unpushed > before) this.packings.set(key, this.time);
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
				// The ship's own works: the project the paude showing it runs from (not another engine's own)
				bay.own ||= Boolean(project.own) && !answer.remote;
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

		// A project is a section of the hull while one of its sessions is aboard or it's watched; the rest stay off the
		// ship. Each keeps its place along the ship as long as the view is open, so the floor plan changes as little as
		// it can: those first aboard by name, each later one after them, and one that leaves and comes back where it was.
		const rank = bay => {
			if (bay.sessions.length || bay.active) return 0;

			return bay.watching ? 1 : 2;
		};
		const aboard = [...bays.values()].filter(bay => rank(bay) < 2);
		const known = this.bayOrder ?? [];
		const newcomers = aboard
			.map(({ name }) => name)
			.filter(name => !known.includes(name))
			.sort((a, b) => a.localeCompare(b));

		this.bayOrder = [...known, ...newcomers];

		const ranked = aboard.sort((a, b) => this.bayOrder.indexOf(a.name) - this.bayOrder.indexOf(b.name));

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
				// Off to another ship: onto the middle of the transporter's pad, only once beaming there is chosen
				if (this.departing?.key === name && this.layout.transporter)
					return [name, { pose: 'traveler', spot: clonerAt(this.layout.transporter), room: this.layout.transporter }];

				// The viewer goes to whatever they've looked at closely: the transporter's side, by its pad but not on it,
				// or the room's floor, just in from its front; the bridge, or the whole ship, as a pilot does
				const focus =
					this.viewer === name && this.looking !== 'all' && this.looking !== BRIDGE && this.roomOf(this.looking);

				if (focus && focus !== this.bridge) {
					const pad = focus.kind === 'transporter' && clonerAt(focus);

					return [
						name,
						{
							pose: 'overseer',
							spot: pad
								? { x: pad.x - BESIDE_PAD, y: pad.y + 0.1 }
								: { x: focus.x + focus.w / 2, y: focus.y + focus.d - 0.35 },
							room: focus,
						},
					];
				}

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

	// The airlock in the bridge's far wall, where those who come aboard come in and go out
	get airlock() {
		return this.bridge && airlockAt(this.bridge);
	}

	// Each person comes aboard by the airlock and walks to where they belong, and walks back out when they go; one
	// whose place moved walks there. Whoever was aboard when the ship was first seen, or when the rooms moved round,
	// is put straight in place.
	board() {
		const { airlock } = this;
		const spots = this.spotsOfPeople();

		for (const [name, walker] of this.walkers) {
			if (spots.has(name) || walker.leaving) continue;
			if (!airlock || walker.x === undefined) this.walkers.delete(name);
			else {
				Object.assign(walker, { leaving: true, path: this.route(walker, walker.room, airlock, this.bridge) });
				// A shuttle comes for them while they walk to the airlock
				this.shuttles.push({ key: name, hue: walker.person?.hue, kind: 'out', at: this.time });
			}
		}

		for (const [name, { pose, spot, room, facing }] of spots) {
			const walker = this.walkers.get(name) ?? { name: this.people.get(name).name, path: [], step: 0, facing: 1 };
			const moved = walker.spot && (walker.spot.x !== spot.x || walker.spot.y !== spot.y);

			walker.person = this.people.get(name);
			walker.leaving = false;
			this.walkers.set(name, walker);

			// Whoever was aboard before anyone looked is found there; the one looking, opening it, comes aboard by shuttle
			// as it comes in, its plating held shut until they're in
			const joining = walker.x === undefined && airlock && name === this.viewer && this.sealed;
			const placed =
				walker.x === undefined && !joining && (!airlock || !this.answered.size || this.time < ABOARD_SECONDS);

			// Still coming aboard through the airlock when the rooms move round: kept at it, wherever it is now, and
			// walking out of it from there, rather than put in place
			const arriving =
				walker.shuttle?.kind === 'in' &&
				(this.boarding(walker) || this.inDoorway(walker) || (name === this.viewer && this.walkingIn()));

			if (this.moved && walker.spot && arriving && airlock) {
				const out = this.boarding(walker) || this.inDoorway(walker) ? airlock : walker;

				Object.assign(walker, out, { path: this.route(out, this.bridge, spot, room), room: this.bridge });
			} else if (placed || (this.moved && walker.spot)) Object.assign(walker, spot, { path: [] });
			else if (walker.x === undefined) {
				Object.assign(walker, airlock, { path: this.route(airlock, this.bridge, spot, room), room: this.bridge });
				// Brought by shuttle, held at the airlock till they've come down its tube
				walker.shuttle = { key: name, hue: walker.person?.hue, kind: 'in', at: joining ? undefined : this.time };
				this.shuttles.push(walker.shuttle);
			}
			// Beamed in on the transporter's pad: from there to where they belong
			else if (!walker.spot) walker.path = this.route(walker, walker.room, spot, room);
			// Along the console to a new seat as others come and go; across the ship to a new place
			else if (moved) walker.path = this.walkTo(walker, spot, room);
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
			const pad = clonerAt(transporter);
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
		this.tendLayoutEase(seconds);
		// Sealed, it comes in out of warp once there's a ship to show, and is opened only once it's arrived
		if (this.sealed && this.enteredAt === undefined && this.answered.size) {
			this.enteredAt = this.time;
			// The one looking comes in with it, on their shuttle, from the first
			const joining = this.shuttles.find(({ key, at }) => key === this.viewer && at === undefined);

			if (joining) Object.assign(joining, { at: this.time, join: true });
			this.joinAt = joining ? this.time : undefined;
		}
		if (this.openWanted && this.arrived() && !this.joining()) this.open();
		// The ship under way: space streams past astern, faster the more was delivered in the last hour
		const burning = flowOf(this.tanks.reduce((sum, { rate }) => sum + rate, 0));

		const pace = 1 + (STAR_PACE.most - 1) * burning ** 2;

		this.pace = calm ? pace : this.pace + (pace - this.pace) * Math.min(1, seconds * STAR_PACE.easing);
		if (!calm) this.drift += seconds * STAR_SPEED * this.pace;

		for (const [key, worker] of this.workers) {
			const fade = worker.vaporizedAt === undefined ? seconds * 1.5 : seconds / VAPOR_SECONDS;

			worker.opacity = worker.leaving ? worker.opacity - fade : Math.min(1, worker.opacity + seconds * 2);
			if (worker.opacity > 0 || !worker.leaving) continue;
			// Its dust stays a while where it was
			if (worker.vaporizedAt !== undefined && worker.dustAt)
				this.dust.push({
					...worker.dustAt,
					hue: worker.session.hue,
					at: this.time,
					...(worker.lounging && { key }),
				});
			this.workers.delete(key);
		}
		this.dust = this.dust.filter(({ at }) => this.time - at < DUST_SECONDS);

		for (const worker of this.workers.values()) this.tendSmallGreys(worker, calm);
		this.tendCrew(seconds);
		this.tendCrane(seconds);
		for (const [name, walker] of this.walkers)
			// People walk at their pace even asked for less motion: one small figure crossing the floor is no sweep of
			// the view, and their coming aboard through the airlock is what's to be seen
			if (!this.boarding(walker) && !this.inDoorway(walker))
				walk(
					walker,
					WALK_SPEED * seconds * (this.departing?.key === name || (this.readying && this.viewer === name) ? HURRY : 1),
					seconds,
				);
		this.tendTravel();
		for (const worker of this.workers.values())
			if (
				worker.path?.length &&
				(calm || this.time - (worker.madeAt ?? -Infinity) >= MAKE_SECONDS) &&
				!(worker.aimingUntil > this.time)
			)
				walk(worker, calm ? Infinity : WORKER_SPEED * seconds, seconds);
		this.tendShuttles();

		for (const parcel of this.parcels) {
			parcel.step += seconds * 9;
			if (parcel.step < 0) continue;
			if (parcel.tube) this.tendTube(parcel, calm ? Infinity : seconds);
			else walk(parcel, calm ? Infinity : PARCEL_SPEED * seconds, seconds);
			if (!parcel.tube && !parcel.path.length && parcel.legs?.length) Object.assign(parcel, parcel.legs.shift());
		}
		this.parcels = this.parcels.filter(({ path, tube }) => tube || path.length);
		for (const hauler of this.haulers) hauler.time += seconds / HAUL_SECONDS;
		this.tendBayDoors(calm ? Infinity : seconds);
		this.ashCouches();
		for (const refuel of this.refuels) refuel.time += seconds / REFUEL_SECONDS;
		this.refuels = this.refuels.filter(({ time }) => time < 1);
		this.haulers = this.haulers.filter(({ time }) => time < 1);

		const goal = this.goal();

		if (goal) {
			const ease = calm ? 1 : Math.min(1, seconds * EASE);

			// Its zoom eased there too, evenly however far (by its ratio), settling exactly on it once it's near
			const zooming = calm ? 1 : Math.min(1, seconds * ZOOM_EASE);
			const zoom = this.camera.zoom * (goal.zoom / this.camera.zoom) ** zooming;

			this.camera.zoom = Math.abs(zoom - goal.zoom) < 0.01 ? goal.zoom : zoom;
			for (const measure of ['x', 'y']) this.camera[measure] = mix(this.camera[measure], goal[measure], ease);
			// Flown there: free to roam from it
			if (
				goal === this.flyingTo &&
				this.camera.zoom === goal.zoom &&
				Math.hypot(this.camera.x - goal.x, this.camera.y - goal.y) < 0.5
			)
				this.flyingTo = null;
		}
	}

	// Deleted from here: it crumbles to dust rather than beaming away
	vaporize(key) {
		const worker = this.workers.get(key);

		if (!worker) return;

		const walking = this.walking(worker);
		const place = walking ? worker : this.placeOf(worker);
		const ground = this.art(place);
		// Where its dust lands: on the desk before it at its console, on the cushion on a couch, else on the floor
		const desk = !walking && !worker.lounging && !briefOf(worker) && !worker.seat?.housing;
		const lift = (desk && -13) || (worker.lounging && !walking && -2) || 1;

		Object.assign(worker, {
			vaporizedAt: this.time,
			leaving: true,
			dustAt: { x: ground.x, y: ground.y + lift, depth: place.y + 0.3 },
		});
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

			// A part from the bridge goes by the tube: drawn up into it from the desk, through the ceiling and down the walls
			// to the hold, and out of its hopper onto its stack
			const pipe = kind !== 'reply' && worker.room === this.bridge && this.pipeFrom(worker.seat);
			const { tube } = this.layout;

			for (let index = 0; index < count; index++)
				this.parcels.push({
					kind,
					hue: worker.session.hue,
					...from,
					...(pipe
						? {
								path: [],
								tube: { pipe, desk: this.art({ x: worker.seat.x + 0.55, y: worker.seat.y + 0.2 }), along: 0 },
								// Out of the hopper on the crane's hook, along the rail to over its pod, and let down onto it
								legs: [
									{
										x: tube.drop,
										y: tube.hopper,
										path: [{ x: tube.drop, y: tube.hopper + HOOK_HANG }, { x: to.x, y: tube.hopper + HOOK_HANG }, to],
										craned: true,
									},
								],
							}
						: { path: this.route(from, worker.room, to, kind === 'reply' ? consoleRoom : hold), legs: [] }),
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
		// Coming out of warp, the stars drawn out into streaks, shortening as it slows
		const warp = (1 - this.entering()) ** 2 * WARP_STREAK;

		for (const star of this.stars) {
			const on = Math.sin(this.time * 1.3 + star.phase) > -0.4;
			const x =
				Math.round(((((star.x - this.drift * star.depth) % this.width) + this.width) % this.width) / size) * size;
			const y = Math.round(star.y / size) * size;

			ctx.fillStyle = (!on && '#434d61') || (star.depth > 0.7 && '#c3cad6') || '#77829a';
			if (warp >= 1) {
				ctx.fillRect(x - Math.round(warp * star.depth), y, Math.round(warp * star.depth) + size, size);
				continue;
			}
			ctx.fillRect(x, y, size, size);
			if (star.big && on) {
				ctx.fillRect(x - size, y, size * 3, size);
				ctx.fillRect(x, y - size, size, size * 3);
			}
		}

		// Only stars until the first answer
		if (!this.answered.size) return;

		const { y } = this.offset;
		const x = this.offset.x + Math.round(this.entryShift());

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
			engines: this.engines.map((engine, index) => ({
				y: this.thrusterAt(index),
				hue: engine.hue ?? 215,
				// Full on, coming in
				thrust:
					this.entering() < 1
						? 1
						: Math.min(
								1,
								sessions.filter(session => session.engine.key === engine.key && session.status === 'working').length /
									3,
							),
				limited: Boolean(engine.limit),
			})),
			comms: {
				active: Boolean(this.systems.get('dish')?.active),
				hue: `hsl(${accentOf('dish')} 75% 64%)`,
				masts,
			},
			bayDoors: this.bayDoors,
			sections: this.sectionsOfHull(),
			// The plumes as long as the stars are fast
			pace: 1 + ((this.pace - 1) * 3) / (STAR_PACE.most - 1),
		});
		for (const mast of masts)
			if (mast.at) this.hits.push({ ...this.toScreen(mast.at), r: 6 * this.camera.zoom, kind: 'system', system: mast });
		this.tanks.forEach((tank, index) => {
			tank.at = { ...this.tankAt(index), y: this.tankAt(index).y - 10 };
			this.hits.push({ ...this.toScreen(tank.at), r: 9 * this.camera.zoom, kind: 'fuel', tank });
		});

		clipToShip(ctx, this.layout);
		// Whoever's on the way down a shuttle's tube isn't at the airlock yet: its door opens only as they reach it
		const movers = [
			...[...this.walkers.values()].filter(walker => !this.boarding(walker)),
			...[...this.workers.values()].filter(worker => this.walking(worker)),
		];

		this.airlockOpen = Boolean(
			this.airlock && movers.some(mover => Math.hypot(mover.x - this.airlock.x, mover.y - this.airlock.y) < 0.9),
		);
		for (const hall of this.layout.halls) {
			// Through the rooms, no walls
			const gaps = this.layout.rooms.map(room => ({
				from: art({ x: room.x, y: 0 }).x,
				to: art({ x: room.x + room.w, y: 0 }).x,
			}));

			standing.push(...drawHall(ctx, art, hall, { time: this.time, running, gaps }));
		}
		standing.push(
			// The streams' trunk in the bay's inner wall, behind its units
			{ y: this.layout.engineering.y + 0.001, draw: () => this.drawTrunk(ctx) },
			// Its account's tanks on their rack against the bay's back wall, over the reactors
			...this.tanks.map((tank, index) => ({
				y: this.tankSpot().y,
				draw: () =>
					drawTank(ctx, this.tankAt(index), this.tankShown(tank), {
						time: this.time,
						color: TANK_COLORS[index % TANK_COLORS.length],
					}),
			})),
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
										x: this.tankAt(tank).x,
										y: this.tankAt(tank).y - 1,
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
					journey: this.journey,
					launching: this.haulers.length > 0,
					tugAway: this.haulers.length > 0,
				}),
				...this.deliveryParts(ctx),
			);
		standing.push(...this.crewParts(ctx));
		standing.push(...this.rackParts(ctx));
		for (const bay of this.bays) {
			// Drawn where it's shown, gliding along its deck to where the layout puts it
			const shift = this.bayShift(bay);
			const shifted = draw => () => {
				ctx.save();
				ctx.translate(shift, 0);
				draw();
				ctx.restore();
			};

			shifted(() => this.drawBayOfMachine(ctx, bay))();
			standing.push(...this.machineParts(ctx, bay).map(part => (shift ? { ...part, draw: shifted(part.draw) } : part)));
			this.bayHits(bay);
		}
		if (this.bridge) standing.push(...this.bridgeParts(ctx, art, label));
		if (this.lounge)
			standing.push(
				...drawLounge(ctx, art, label, this.lounge, { time: this.time, lifted: this.couchesLifted() }),
				...this.couchParts(ctx),
			);
		for (const room of this.layout.rooms.filter(({ kind }) => kind))
			this.hits.push({
				...this.screen({ x: room.x + room.w / 2, y: room.y + room.d / 2 }),
				area: this.area(room),
				kind: room.kind === 'system' ? 'system' : room.kind,
				room,
				system: room.kind === 'system' ? this.systemOf(room) : undefined,
			});
		this.cables = this.conduitsOf();
		this.fed = this.feedsOf();
		// Each whole, machine to island, in one layer so none is broken where two would meet; on the floor, under all that
		// stands or walks on it
		standing.push({ y: -Infinity, draw: () => this.drawTerminalCables(ctx) });
		standing.push(...this.inspectionParts(ctx));
		this.drawMats(ctx);
		standing.push(...this.cargoParts(ctx));
		for (const worker of this.workers.values()) if (worker.seat) standing.push(...this.workerParts(ctx, worker));
		standing.push(...this.tubeParts(ctx));
		standing.push(...this.fleetParts(ctx));
		// The deleted crumbling, over what they sat at, and their dust after, fading out in its last seconds
		for (const worker of this.workers.values())
			if (worker.crumble && worker.vaporizedAt !== undefined)
				standing.push({ y: worker.dustAt.depth, draw: () => this.drawCrumbling(ctx, worker) });
		for (const heap of this.dust) standing.push({ y: heap.depth, draw: () => this.drawAshSucked(ctx, heap) });
		for (const parcel of this.parcels)
			standing.push({
				// On the crane's hook, over the pods it's carried above
				y:
					(parcel.tube && (parcel.tube.age ?? 0) >= POP_SECONDS && TUBE_FRONT) ||
					(parcel.craned && TUBE_FRONT - 0.0005) ||
					parcel.y + 0.5,
				draw: () => this.drawParcel(ctx, parcel),
			});

		for (const thing of standing.sort((a, b) => a.y - b.y)) thing.draw();
		this.light(ctx, working, running);
		this.drawCoreCharge(ctx);
		// Lit, so laid over the light
		this.drawPathways(ctx);
		// Whoever's aboard over everything, as a game draws its people over the scenery: the bridge's aisles are too narrow
		// to clear the consoles and screens about them
		for (const walker of this.walkers.values())
			if (walker.x !== undefined && !this.boarding(walker)) this.drawWalker(ctx, walker);

		const cover = this.coverOf();

		// Sealed in its plating until what's aboard has all come in, so nothing is seen moving into place; opened then
		drawHullCover(ctx, this.layout, cover, {
			time: this.time,
			name: this.own?.name ?? '',
			hue: this.own?.hue ?? 200,
		});
		// Sealed, only the shuttles flying up to it show over its plating, someone coming aboard as it opens
		// Opening: the one who just came aboard seen stepping out of the airlock over the fading plating
		const stepping = cover > 0 && cover < 1 && this.viewer && this.walkers.get(this.viewer);

		if (stepping?.x !== undefined && !this.boarding(stepping)) this.drawWalker(ctx, stepping);
		if (cover >= 1) {
			ctx.restore();
			for (const shuttle of this.shuttles) this.drawShuttleOf(ctx, shuttle);

			return;
		}
		this.drawSelection(ctx);
		ctx.restore();
		for (const hauler of this.haulers) this.drawHauler(ctx, hauler);
		for (const refuel of this.refuels) this.drawRefuel(ctx, refuel);
		for (const shuttle of this.shuttles) this.drawShuttleOf(ctx, shuttle);
		this.drawTugFlight(ctx);
		for (const worker of this.workers.values()) if (worker.seat) this.drawMarker(ctx, worker);
		this.drawLabels(ctx, ratio);
	}

	// A worker's seat and the console it left, moved by the layout, shown gliding there from where they were rather than
	// jumping: each kept as the layout's, its place where it was shown, eased toward the layout's own each step. On the
	// bridge only, and only from a place it was shown at; anywhere else, or new, it's there at once.
	easeSeats(worker, relocated = new Set()) {
		// Its island moved: up from where it sat, to walk to where its seat has gone
		const shownSeat = worker.seatShown;

		if (
			relocated.has(worker.seat?.island?.key) &&
			shownSeat?.bridge &&
			worker.room === this.bridge &&
			!worker.lounging &&
			!this.walking(worker)
		) {
			worker.trip = { from: { x: shownSeat.x + 0.3, y: shownSeat.y + 0.2 }, room: this.bridge, fromSeat: true };
			worker.seatGoal = null;

			return;
		}
		for (const [key, goalKey, shownKey] of [
			['seat', 'seatGoal', 'seatShown'],
			['homeSeat', 'homeGoal', 'homeShown'],
		]) {
			const goal = worker[key];
			const shown = worker[shownKey];
			// The console it left is always the bridge's; its seat only while it sits there, and sat there before
			const glides = key === 'homeSeat' || (worker.room === this.bridge && shown?.bridge);

			worker[goalKey] = goal && shown && glides ? goal : null;
			if (worker[goalKey]) worker[key] = { ...goal, x: shown.x, y: shown.y };
		}
	}

	// Each step: seats and islands a little nearer where the layout puts them
	tendLayoutEase(seconds) {
		const near = 1 - Math.exp(-seconds * LAYOUT_EASE);
		const toward = (from, to) => (Math.abs(to - from) < 0.002 ? to : from + (to - from) * near);

		for (const worker of this.workers.values())
			for (const [key, goalKey, shownKey] of [
				['seat', 'seatGoal', 'seatShown'],
				['homeSeat', 'homeGoal', 'homeShown'],
			]) {
				const goal = worker[goalKey];

				if (goal && worker[key])
					Object.assign(worker[key], { x: toward(worker[key].x, goal.x), y: toward(worker[key].y, goal.y) });
				worker[shownKey] = worker[key]
					? { x: worker[key].x, y: worker[key].y, bridge: worker.room === this.bridge }
					: null;
			}

		// Each project's machine along its deck, where it was shown; a new one is at its place at once
		if (this.bayGoalsFor !== this.layout) {
			this.bayGoalsFor = this.layout;
			this.bayGoals = new Map((this.layout?.bays ?? []).map(bay => [bay.name, bay.x]));
		}

		const placed = this.bayGoals;

		this.baysShown ??= new Map();
		for (const [name, x] of placed) this.baysShown.set(name, toward(this.baysShown.get(name) ?? x, x));
		for (const name of this.baysShown.keys()) if (!placed.has(name)) this.baysShown.delete(name);

		// Islands by their key: a new one rises out of the floor, its terminals then rising out of it; one that has to
		// move sinks into the floor and rises again where it's going; one gone sinks away. Where only the bridge moved
		// round, they glide with it. Looked up afresh only when the layout changes.
		if (this.islandGoalsFor !== this.layout) {
			this.islandGoalsFor = this.layout;
			this.islandGoals = new Map((this.bridge?.islands ?? []).map(island => [island.key, island]));
		}

		const goals = this.islandGoals;
		const first = !this.islandsShown;
		const rising = seconds * ISLAND_RISE_RATE;
		const along = island => island.x - (this.bridge?.x ?? 0);

		this.islandsShown ??= new Map();
		for (const [key, island] of goals) {
			const shown = this.islandsShown.get(key) ?? {
				x: island.x,
				y: island.y,
				w: island.w,
				at: along(island),
				row: island.row,
				rise: first ? 2 : 0,
			};
			// Moved to another row or along its own, not just with its row as the rows spread or close up
			const moving = Math.abs(shown.at - along(island)) > 0.05 || shown.row !== island.row;

			if (moving) {
				// Sinking where it was, then put where it's going to rise there
				shown.rise = Math.max(0, shown.rise - rising * 1.5);
				if (shown.rise === 0)
					Object.assign(shown, { x: island.x, y: island.y, w: island.w, at: along(island), row: island.row });
			} else {
				Object.assign(shown, {
					x: toward(shown.x, island.x),
					y: toward(shown.y, island.y),
					w: toward(shown.w, island.w),
					at: along(island),
					rise: Math.min(2, shown.rise + rising),
				});
			}
			shown.island = island;
			this.islandsShown.set(key, shown);
		}
		for (const [key, shown] of this.islandsShown) {
			if (goals.has(key)) continue;
			shown.rise = Math.max(0, shown.rise - rising * 1.5);
			if (shown.rise === 0) this.islandsShown.delete(key);
		}
	}

	// How far an island has risen out of the floor, by its key: 0 sunk, 1 its console up, 2 its terminals up too
	islandRise(key) {
		return this.islandsShown?.get(key)?.rise ?? 2;
	}

	// A seat at an island as far up as it's risen: its console's front with the console, its terminal rising out of the
	// console's top once that's up, and sunk with it below the floor
	drawRisingSeat(ctx, at, options, key) {
		const rise = key === undefined ? 2 : this.islandRise(key);

		if (rise >= 2) return drawSeat(ctx, at, options);

		const sunk = Math.round((1 - Math.min(1, rise)) * CONSOLE_TALL);
		const lowered = Math.round((1 - Math.max(0, Math.min(1, rise - 1))) * SCREEN_RISE);
		const top = at.y - CONSOLE_TALL + sunk;

		for (const [from, to, drop] of [
			[top, at.y + 4, sunk],
			[at.y - SCREEN_RISE - 8, top, sunk + lowered],
		]) {
			if (to <= from) continue;
			ctx.save();
			ctx.beginPath();
			ctx.rect(at.x - 30, from, 60, to - from);
			ctx.clip();
			drawSeat(ctx, { x: at.x, y: at.y + drop }, options);
			ctx.restore();
		}

		return undefined;
	}

	// How far, in art pixels across, a project's machine is drawn from where the layout puts it while it glides there
	bayShift(bay) {
		const shown = this.baysShown?.get(bay.name);

		return shown === undefined ? 0 : Math.round((shown - bay.x) * UNIT.x);
	}

	// How much of the ship its outer plating still covers: all of it while sealed, fading once opened
	coverOf() {
		if (this.sealed) return 1;

		return Math.max(0, 1 - (this.time - (this.openedAt ?? -Infinity)) / OPEN_SECONDS);
	}

	// Its plating opened, showing what's aboard; asked before it's arrived, once it has
	open() {
		if (!this.sealed) return;
		if (!this.arrived() || this.joining()) {
			this.openWanted = true;

			return;
		}
		this.sealed = false;
		this.openWanted = false;
		this.openedAt = this.time;
	}

	// How far through its coming in out of warp it is, 0 to 1; 1 for one that never came in
	entering() {
		if (this.enteredAt === undefined) return this.sealed ? 0 : 1;

		const held = this.joinAt === undefined ? 0 : JOIN.warp;

		return Math.max(0, Math.min(1, (this.time - this.enteredAt - held) / ENTER_SECONDS));
	}

	arrived() {
		return this.entering() >= 1;
	}

	// Where it is on its way in, in screen pixels left of its place: far off at first, slowing as it nears
	entryShift() {
		return -((1 - this.entering()) ** 3) * (this.width + 200);
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
		else if (kind === 'room')
			boxes.push(
				around(
					{ bridge: this.bridge, lounge: this.lounge?.count ? this.lounge : null }[name] ?? this.layout.materializer,
				),
			);
		else if (kind === 'worker' || kind === 'group') {
			// A group, picked together: each of them bracketed
			for (const key of kind === 'group' ? name.split(GROUP_SEPARATOR) : [name]) {
				const worker = this.workers.get(key);

				if (worker?.seat && !worker.lounging)
					boxes.push(atSeat(this.walking(worker) ? worker : { x: worker.seat.x, y: worker.seat.y + 0.2 }));
				else if (worker?.lounging) {
					const at = this.art(this.placeOf(worker));

					boxes.push({ from: { x: at.x - 9, y: at.y - 24 }, to: { x: at.x + 9, y: at.y + 2 }, inset: 0 });
					if (worker.homeSeat) boxes.push(atSeat({ x: worker.homeSeat.x, y: worker.homeSeat.y + 0.2 }));
				}
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
			const character = bay?.character ?? room.character ?? {};

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
				// What its machine is made of, for the machinery it shows outside
				folders: character.folders,
				form: FORMS[cksum(`form|${room.name}`) % FORMS.length],
				own: Boolean(bay?.own),
				history: character,
				seed: seeded(room.name),
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
		const own = this.bays.find(({ name }) => name === bay.name)?.own ?? bay.own;
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
					// Its name over it: on a top deck, inside the hull under its ceiling, the machine lowered to clear it
					const ceiling = this.art({ x: 0, y: part.y + 0.3 }).y;

					if (deck === 0)
						this.labels.push({
							text: own ? `${bay.name} core` : bay.name,
							at: { x: this.art({ x: housing.middle, y: 0 }).x, y: upper ? ceiling + NAME_INSIDE : ceiling },
							color: bay.hue === null ? PALETTE.w : `hsl(${bay.hue} 60% 74%)`,
							align: 'center',
							size: 1,
							lift: upper ? 0 : 4,
							width: housing.w * UNIT.x + 8,
						});
					// The ship's own works its core, unlike any project's machine
					bay.built[deck] = (own ? drawCore : drawHousing)(ctx, point => this.art(point), housing, {
						top: upper ? ceiling + NAME_ROOM : ceiling,
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

	// The ship's core alive through its whole frame: the hull's inner rim, back and belly, lit softly in its color,
	// breathing, brighter while it's worked on; and while it is, now and then a small crackle on the rim
	drawCoreCharge(ctx) {
		const bay = this.bays.find(({ own }) => own);
		const { building } = this.layout;

		if (!bay || !building) return;

		const sessions = bay.sessions.map(key => this.workers.get(key)?.session).filter(Boolean);
		const state =
			(sessions.some(({ status }) => status === 'working') && 'working') || (sessions.length ? 'ready' : 'idle');
		const hue = bay.hue ?? 200;
		const [left, right] = [this.art({ x: building.left, y: 0 }).x + 2, this.art({ x: building.right, y: 0 }).x - 2];
		const [top, bottom] = [this.art({ x: 0, y: building.top }).y + 1, this.art({ x: 0, y: building.bottom }).y - 1];
		const strength = { working: 0.22, ready: 0.13, idle: 0.07 }[state] * (0.8 + 0.2 * Math.sin(this.time * 1.4));

		// Its glow off the rim, fading inward
		for (let depth = 0; depth < 4; depth++) {
			ctx.globalAlpha = strength * (1 - depth / 4);
			rect(ctx, left, top + depth, right - left, 1, `hsl(${hue} 85% 60%)`);
			rect(ctx, left, bottom - depth, right - left, 1, `hsl(${hue} 85% 60%)`);
		}
		ctx.globalAlpha = 1;
		if (state !== 'working') return;

		// A crackle, now and then: a few pixels flickering either side of the rim, where picked from the moment
		const moment = Math.floor(this.time * 10);
		const pick = what => seeded(`crackle|${moment}|${what}`);

		if (pick('on') > 0.08) return;

		const x = left + Math.round(pick('x') * (right - left));
		const rim = pick('rim') < 0.5 ? top : bottom;
		const inward = rim === top ? 1 : -1;

		for (let step = 0; step < 4; step++) {
			const y = rim + inward * (step % 2 ? 2 : 0);

			ctx.globalAlpha = 0.45;
			rect(ctx, x + step * 2 - 1, y - 1, 3, 3, `hsl(${hue} 90% 62%)`);
			ctx.globalAlpha = 1;
			rect(ctx, x + step * 2, y, 1, 1, '#ffffff');
		}
	}

	// A grey at its terminal on the bridge, so wired into its project's machine
	wired(worker) {
		return Boolean(worker?.seat && worker.room === this.bridge && !worker.lounging && !this.walking(worker));
	}

	// Where each project's conduit runs, in art pixels: from its islands on the bridge out through the bridge's aft wall,
	// along its own lane under the spine to its machine, thicker the more of its sessions are at their desks (dark, and
	// as thin as it goes, with none); lanes far enough
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
			// Every island stays wired to its project's machine, whether anyone's at it now or not
			.filter(({ bay, machine }) => machine && (this.bridge.islands ?? []).some(({ name }) => name === bay.name));
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

		// Each lane's height along its hall, in art pixels: from the hall's top down, a cable's width apart by their
		// thicknesses, and pressed closer when there are more than the hall is tall for, never out into the rooms either
		// side of it
		const trays = new Map();

		for (const room of this.layout.halls ?? []) {
			const inHall = wired
				.filter(({ bay }) => Math.abs(bay.lane - room.lane) < 1e-6)
				.sort((a, b) => lanes.get(a.bay.name) - lanes.get(b.bay.name));
			const weights = inHall.map(({ workers }) => cableWeight(workers.length));
			const steps = weights.slice(1).map((weight, index) => cableStep(weights[index], weight));
			const [top, bottom] = [
				this.art({ x: 0, y: room.y }).y + HALL_TRAY_IN,
				this.art({ x: 0, y: room.y + room.d }).y - HALL_TRAY_IN,
			];
			const first = top + Math.ceil((weights[0] ?? 1) / 2);
			const fits = Math.max(0, bottom - Math.floor((weights.at(-1) ?? 1) / 2) - first);
			const total = steps.reduce((sum, step) => sum + step, 0);
			const squeeze = total > fits ? fits / total : 1;
			let at = first;

			inHall.forEach(({ bay }, index) => {
				if (index) at += steps[index - 1] * squeeze;
				trays.set(bay.name, Math.round(at));
			});
		}

		const routes = wired.map(({ bay, machine, workers }) => {
			const lane = lanes.get(bay.name);
			const tray = trays.get(bay.name) ?? this.art({ x: 0, y: bay.lane }).y - 9 + lane * 8;
			// Into its sides at the end nearer the spine: by its foot when the spine runs under it, by its top socket
			// when over it, so nothing climbs the machine's whole height to reach it
			const height = tray > (machine.top + machine.floor) / 2 ? machine.floor - 3 : machine.socket(1, 0).y;
			const exit = { x: machine.to, y: height };

			return {
				bay,
				color: wireColor(bay.hue, workers.length > 0),
				working: workers.some(({ session }) => session.status === 'working'),
				weight: cableWeight(workers.length),
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
		// Each island's run height first, which the risers' order is weighed with
		const plates = routes.flatMap(({ plates: own, weight }) => own.map(plate => ({ plate, weight })));
		const runs = runsFor(plates.map(({ plate, weight }) => ({ ...plate.at, weight })));

		plates.forEach(({ plate }, index) => (plate.run = runs[index]));

		const order = this.riserOrder(routes, wall);
		const { lounge } = this;
		const risers = risersFor(
			wall,
			lounge?.count ? this.art({ x: lounge.x, y: 0 }).x : null,
			order.map(({ weight }) => weight),
		);

		order.forEach((route, index) => conduits.set(route.bay.name, { ...route, riser: risers[index] }));
		this.conduits = { layout: this.layout, key, map: conduits };

		return conduits;
	}

	// The order of the conduits' risers along the bridge's aft wall that crosses fewest of their runs: every order tried
	// while there are few, worked out again only when the conduits or where they go change
	riserOrder(routes, wall) {
		const key = routes
			.map(({ bay, weight, tray, out, plates }) =>
				[bay.name, weight, tray, out.x, out.y, ...plates.map(({ at }) => `${at.x},${at.y}`)].join(':'),
			)
			.join('|');

		if (this.risers?.key === key)
			return this.risers.names.map(name => routes.find(({ bay }) => bay.name === name)).filter(Boolean);

		// Its stretches' bounds, as far out as any two can be and still touch, so two far apart are passed over at once
		const boxed = laid => {
			const xs = [...laid.across.flatMap(({ from, to }) => [from, to]), ...laid.down.map(({ x }) => x)];
			const ys = [...laid.across.map(({ y }) => y), ...laid.down.flatMap(({ from, to }) => [from, to])];
			const reach = laid.weight / 2 + RISER_GAP + 1 + 5 / 2;

			return {
				...laid,
				box: {
					left: Math.min(...xs) - reach,
					right: Math.max(...xs) + reach,
					top: Math.min(...ys) - reach,
					bottom: Math.max(...ys) + reach,
				},
			};
		};
		const runs = (route, x) =>
			boxed({
				weight: route.weight,
				across: [
					...route.plates.map(({ at, run = at.y }) => ({ y: run, from: Math.min(x, at.x), to: Math.max(x, at.x) })),
					{ y: route.tray, from: Math.min(x, route.out.x), to: Math.max(x, route.out.x) },
				],
				down: [
					...route.plates.map(({ at }) => ({ x, from: Math.min(at.y, route.tray), to: Math.max(at.y, route.tray) })),
					{ x: route.out.x, from: Math.min(route.tray, route.exit.y), to: Math.max(route.tray, route.exit.y) },
				],
			});
		// What two conduits laid at their risers cost: each crossing of one's run by the other's riser, and each stretch
		// the two lie along one line, or near enough that their outlines meet, as three (worse than a crossing: one hides
		// the other)
		const between = (a, b) => {
			if (a.box.right < b.box.left || b.box.right < a.box.left || a.box.bottom < b.box.top || b.box.bottom < a.box.top)
				return 0;

			let count = 0;

			for (const [flats, uprights] of [
				[a.across, b.down],
				[b.across, a.down],
			])
				for (const flat of flats)
					for (const upright of uprights)
						if (flat.y > upright.from && flat.y < upright.to && upright.x > flat.from && upright.x < flat.to) count++;
			for (const flat of a.across)
				for (const also of b.across)
					if (
						Math.abs(flat.y - also.y) < (a.weight + b.weight) / 2 + RISER_GAP + 1 &&
						Math.min(flat.to, also.to) > Math.max(flat.from, also.from) + 2
					)
						count += 3;

			return count;
		};
		const crossings = ordered => {
			const at = risersFor(
				wall,
				null,
				ordered.map(({ weight }) => weight),
			);
			const laid = ordered.map((route, index) => runs(route, at[index]));
			let count = 0;

			for (let one = 0; one < laid.length; one++)
				for (let other = one + 1; other < laid.length; other++) count += between(laid[one], laid[other]);

			return count;
		};
		const permutations = list =>
			list.length <= 1
				? [list]
				: list.flatMap((first, index) =>
						permutations([...list.slice(0, index), ...list.slice(index + 1)]).map(rest => [first, ...rest]),
					);
		// Too many to try every order: the trays nearest the bridge's rows first, then any two swapped while that does
		// better, a few passes at most
		// Each laid at the risers' places as the first order has them (near enough, their weights alike), so a swap only
		// changes what the two swapped cost with the rest
		const swapped = start => {
			const ordered = [...start];
			const at = risersFor(
				wall,
				null,
				ordered.map(({ weight }) => weight),
			);
			const laid = new Map(ordered.map(route => [route, at.map(x => runs(route, x))]));
			const cost = (route, slot, also, alsoSlot) => between(laid.get(route)[slot], laid.get(also)[alsoSlot]);

			for (let pass = 0, better = true; better && pass < SWAP_PASSES; pass++) {
				better = false;
				for (let one = 0; one < ordered.length - 1; one++)
					for (let other = one + 1; other < ordered.length; other++) {
						const [a, b] = [ordered[one], ordered[other]];
						let change = cost(b, one, a, other) - cost(a, one, b, other);

						for (const [slot, route] of ordered.entries())
							if (slot !== one && slot !== other)
								change +=
									cost(b, one, route, slot) +
									cost(a, other, route, slot) -
									cost(a, one, route, slot) -
									cost(b, other, route, slot);
						if (change < 0) {
							[ordered[one], ordered[other]] = [b, a];
							better = true;
						}
					}
			}

			return ordered;
		};
		const best =
			routes.length <= 6
				? permutations(routes).reduce(
						(found, ordered) => {
							const count = crossings(ordered);

							return count < found.count ? { ordered, count } : found;
						},
						{ ordered: routes, count: Infinity },
					).ordered
				: swapped([...routes].sort((a, b) => a.tray - b.tray));

		this.risers = { key, names: best.map(({ bay }) => bay.name) };

		return best;
	}

	// The projects' conduits, a pulse riding each while any of its sessions works: each drawn as one line from its
	// project's machine, along its lane, up its riser and along its row to its island, so its corners join and its color
	// holds the whole way
	drawTerminalCables(ctx) {
		// None for a frame while a changed layout's machines are first measured: the last drawn stay meanwhile, only that
		// long, so a ship left with none isn't left with conduits joined to nothing
		if (!this.cables.size && this.cablesDrawn?.size) {
			this.cablesGoneAt ??= this.time;
			if (this.time - this.cablesGoneAt < CABLE_HOLD_SECONDS) {
				for (const paths of this.cablesDrawn.values())
					for (const { points, style } of paths) this.drawWire(ctx, points, style);

				return;
			}
			this.cablesDrawn = new Map();
		}
		this.cablesGoneAt = null;

		const now = new Map();

		for (const [name, { color, weight, working, seed, tray, riser, exit, out, plates }] of this.cables) {
			const style = { color, weight, working, seed };
			const machine = [{ x: out.x, y: tray }, out, exit];

			// From the island, so its pulse runs toward the machine as it always has
			now.set(
				name,
				plates.map(({ at, run = at.y }) => ({
					style,
					points: [
						...this.clearOfLounge(
							[at, ...(run === at.y ? [] : [{ x: at.x, y: run }]), { x: riser, y: run }, { x: riser, y: tray }],
							this.besideOf(riser),
						),
						...machine,
					],
				})),
			);
		}

		// The layout changed: each conduit laid anew fades from where it ran to where it runs now, one gone fades out
		if (this.cablesDrawn && this.cablesDrawnFor !== this.cables) {
			this.cablesBefore = { drawn: this.cablesDrawn, at: this.time };
			this.cablesDrawnFor = this.cables;
		}
		this.cablesDrawnFor ??= this.cables;

		const fading = this.cablesBefore && (this.time - this.cablesBefore.at) / CABLE_FADE_SECONDS;
		const route = paths =>
			JSON.stringify(paths?.map(({ points }) => points.map(({ x, y }) => [Math.round(x), Math.round(y)])));
		const draw = (paths, alpha) => {
			ctx.globalAlpha = alpha;
			for (const { points, style } of paths) this.drawWire(ctx, points, style);
			ctx.globalAlpha = 1;
		};

		for (const [name, paths] of now) {
			const was = fading < 1 && this.cablesBefore.drawn.get(name);

			if (was && route(was) !== route(paths)) {
				draw(was, 1 - fading);
				draw(paths, fading);
			} else draw(paths, fading < 1 && !was ? fading : 1);
		}
		if (fading < 1) for (const [name, was] of this.cablesBefore.drawn) if (!now.has(name)) draw(was, 1 - fading);
		this.cablesDrawn = now;
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

		// Walking, over everything; but behind what stands in front of it, sorted in among that by depth so it hides it,
		// and behind a console it's on its way to or from a seat at, as those sat there are
		const walkingDepth = () => {
			const island = this.bridge && islandAt(this.bridge, worker);

			if (island) return island.y - BEHIND_CONSOLE;

			return this.behindFurniture(worker, this.furniture(), GREY_SIZE) ? worker.y : TUBE_FRONT - 0.0015;
		};
		const walker = this.walking(worker) ? [{ y: walkingDepth(), draw: () => this.drawWorker(ctx, worker) }] : [];

		if (worker.lounging)
			return [...(walker.length ? walker : this.loungerParts(ctx, worker)), ...this.homeSeatParts(ctx, worker)];
		const engineColor = `hsl(${session.engine.hue ?? 215} 45% 50%)`;
		const at = this.art({ x: seat.x, y: seat.y + 0.2 });
		const floor = briefOf(worker) && !walker.length && this.art(this.placeOf(worker));
		const laptop = floor && { x: floor.x + 12, y: floor.y + 2 };
		// Its terminal says what it's at, or what needs you, in place of a badge over its head: news while there's
		// something new it hasn't been looked at for
		const status = !working && this.needs(session) === 'unread' ? { ...screen, kind: 'news' } : screen;

		this.hits.push({
			...this.toScreen(laptop ? { x: laptop.x, y: laptop.y - 5 } : { x: at.x - 7, y: at.y - 21 }),
			r: (laptop ? 6 : 8) * this.camera.zoom,
			kind: 'monitor',
			worker,
		});

		return [
			...walker,
			...(!walker.length && !floor ? [{ y: seat.y - 0.12, draw: () => this.drawWorker(ctx, worker) }] : []),
			// Sat on the floor before its console, where the conduits run along the row's foot: over them, nothing standing
			// before it but the next row, well clear
			...(floor
				? [
						{
							y: TUBE_FRONT - 0.0015,
							draw: () => {
								// Its cable out of the laptop's back and up into the console's front
								rect(ctx, laptop.x + 6, laptop.y - 1, 2, 1, PALETTE.k);
								rect(ctx, laptop.x + 7, at.y - 2, 1, laptop.y - at.y + 1, PALETTE.k);
								rect(ctx, laptop.x + 5, at.y - 3, 3, 1, PALETTE.l);
								// Sat cross-legged on the floor: no more of it than shows above its knees
								ctx.save();
								ctx.beginPath();
								ctx.rect(floor.x - 20, floor.y - 60, 40, 57);
								ctx.clip();
								this.drawWorker(ctx, worker);
								ctx.restore();
								rect(ctx, floor.x - 6, floor.y - 4, 12, 3, PALETTE.k);
								rect(ctx, floor.x - 5, floor.y - 3, 4, 1, PALETTE.a);
								rect(ctx, floor.x + 1, floor.y - 3, 4, 1, PALETTE.a);
								drawLaptop(ctx, laptop, { screen: status, time: this.time, seed: worker.seed });
							},
						},
					]
				: []),
			...this.smallGreyParts(ctx, worker),
			...((keepingOf(session) || this.serving(worker)) && !walker.length
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
					this.drawRisingSeat(
						ctx,
						at,
						{
							screen: status,
							engineColor,
							time: this.time,
							seed: worker.seed,
							todos: session.todos,
							frost: session.status === 'ready' && session.context?.warm === false,
							bare: Boolean(floor),
						},
						seat.island?.key,
					);
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
		// As shown, gliding to where the layout puts them; before the first step, where it puts them
		const shownIslands = this.islandsShown?.size
			? [...this.islandsShown.values()].map(({ x, y, w, rise, island }) => ({ ...island, x, y, w, rise }))
			: (bridge.islands ?? []);
		const islands = shownIslands.map(island => ({
			y: island.y + 0.139,
			draw: () => {
				const from = this.art({ x: island.x, y: island.y + 0.2 });
				const to = this.art({ x: island.x + island.w, y: 0 });
				const color = island.hue === null || island.hue === undefined ? PALETTE.l : `hsl(${island.hue} 55% 50%)`;
				// Risen out of the floor as far as it has: sunk below it and cut off at it
				const sunk = Math.round((1 - Math.min(1, island.rise ?? 2)) * CONSOLE_TALL);

				if (sunk >= CONSOLE_TALL) return;
				ctx.save();
				ctx.beginPath();
				ctx.rect(from.x - 4, from.y - CONSOLE_TALL - 2, to.x - from.x + 8, CONSOLE_TALL + 6);
				ctx.clip();
				drawIsland(ctx, { from: from.x, to: to.x, y: from.y + sunk }, { color });
				ctx.restore();
				if (sunk > 0) return;

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
		// The airlock, where invites are made and revoked
		this.hits.push({
			...this.toScreen(this.art({ x: this.airlock.x, y: bridge.y + (bridge.face ?? FACE) / 2 })),
			r: 9 * this.camera.zoom,
			kind: 'airlock',
		});

		return [
			...islands,
			...drawBridge(ctx, art, label, bridge, {
				time: this.time,
				plans: Boolean(this.systems.get('tower')?.active),
				airlockOpen: this.airlockOpen,
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

	// Where the systems' streams leave the engine bay: a lane each up its inner wall (`nth` of STREAM_LANES), in art
	// pixels across
	trunkLane(nth) {
		const { gap, nths } = this.trunk();
		const rank = nths.indexOf(nth);

		return gap.left + 2 + Math.max(0, rank) * Math.max(1, Math.floor((gap.right - gap.left - 3) / nths.length));
	}

	// The gap between the bay's units and its inner wall the trunk runs in, in art pixels across, and the lanes in it:
	// the systems the bay has, in STREAM_LANES order
	trunk() {
		const { engineering, systems = {} } = this.layout;

		if (this.trunkOf?.layout === this.layout) return this.trunkOf;

		const rooms = Object.values(systems);
		const right = this.art({ x: engineering.x + engineering.w, y: 0 }).x;
		const left = rooms.length ? Math.max(...rooms.map(room => this.art({ x: room.x + room.w, y: 0 }).x)) : right - 8;
		const nths = [...new Set(rooms.map(({ key }) => STREAM_LANES.indexOf(key)).filter(nth => nth >= 0))].sort(
			(a, b) => a - b,
		);

		this.trunkOf = { layout: this.layout, gap: { left: Math.min(left, right - 6), right }, nths };

		return this.trunkOf;
	}

	// The channel those lanes run in, set into the engine bay's inner wall from its highest unit to the hall's conduits,
	// behind the units standing before it: always there, so a stream is seen to take it
	drawTrunk(ctx) {
		const systems = Object.values(this.layout.systems ?? {});

		if (!systems.length) return;

		const { gap } = this.trunk();
		const trays = [...(this.cables?.values() ?? [])].map(({ tray }) => tray);
		const top = Math.min(...systems.map(room => this.art(systemFootOf(room)).y)) - 2;
		const bottom = trays.length ? Math.max(...trays) + 2 : this.art({ x: 0, y: this.layout.halls[0].lane }).y;
		const [left, right] = [gap.left + 1, gap.right - 1];

		rect(ctx, left, top, right - left + 1, bottom - top, '#0a0e16');
		rect(ctx, left, top, 1, bottom - top, PALETTE.m);
		rect(ctx, right, top, 1, bottom - top, PALETTE.d);
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

		// From an engine-bay unit: straight across into its lane of the trunk, down it to the hall, and on from there
		if (tech && room.within?.kind === 'engineering') {
			const along = this.trunkLane(sources.indexOf(key));
			const hall = { x: along / UNIT.x, y: lane + offset };
			const onward = this.clearOfLounge(
				[hall, ...this.route(hall, null, end, worker.room, lane + offset)].map(point => this.art(point)),
			);

			return [
				...fed,
				{
					track: trackOf([
						tech.outlet,
						{ x: along, y: tech.outlet.y },
						{ x: along, y: onward[0].y },
						...onward.slice(1),
					]),
					ports: [tech.outlet],
				},
			];
		}
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
		const wall = this.trunkLane(nth);
		const { tray, entry, exit, out, riser, plates } = conduit;
		const into = { x: entry.x - 4, y: entry.y };
		const seat = this.art({ x: worker.seat.x - 0.4, y: worker.seat.y - 0.1 });
		// The island it's at, of its project's: the one seating it, else (on the floor, say) the one whose plate is nearest
		const seating = plates.find(({ island }) => island?.keys?.includes(worker.session.key));
		const plate = (seating ? [seating] : plates)
			.map(({ at, run = at.y }) => ({ ...at, run }))
			.sort((a, b) => Math.hypot(a.x - seat.x, a.y - seat.y) - Math.hypot(b.x - seat.x, b.y - seat.y))[0];

		return [
			[
				// From its unit's foot straight across into its lane of the trunk, or out of its room's door to it
				...(outlet ? [outlet, { x: wall, y: outlet.y }] : [door, { x: wall, y: door.y }]),
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
				...(plate
					? [
							{ x: riser, y: plate.run },
							...(plate.run === plate.y ? [] : [{ x: plate.x, y: plate.run }]),
							{ x: plate.x, y: plate.y },
							{ x: seat.x, y: plate.y },
							seat,
						]
					: []),
			],
		];
	}

	// How far out from the lounge a conduit bends round it, by its riser's place along the bridge's aft wall, so each
	// runs its own line as its riser does, and a stream along it with it
	besideOf(riser) {
		return riser - this.art({ x: this.bridge.x, y: 0 }).x - 4;
	}

	// A stream's or a conduit's points, in art pixels, bent round the lounge rather than under its couches; `apart` more
	// pixels out, so several bent round it run side by side, not on one line
	clearOfLounge(points, apart = 0) {
		const { lounge } = this;

		if (!lounge?.count) return points;

		const from = this.art({ x: lounge.x, y: lounge.y });
		const past = this.art({ x: lounge.x + lounge.w, y: lounge.y + lounge.d });

		return bendAround(
			points,
			{ left: from.x - 2, right: past.x + 2, top: from.y - 2, bottom: past.y + 2 },
			{
				walled: this.loungeWalled(),
				apart,
				step: 1,
				// Over it along the aisle before the islands above, clear of their consoles as of its couches
				over: this.art({ x: 0, y: this.loungeOver() }).y + 6,
			},
		);
	}

	// The way over the lounge: the aisle before the row of consoles above it, clear of its couches' backs
	loungeOver() {
		const { lounge, bridge } = this;
		const above = (bridge.islands ?? []).filter(({ y }) => y < lounge.y).map(({ y }) => y);

		return above.length ? standingOf(bridge, Math.max(...above)) : lounge.y - 0.15;
	}

	// Against the hull, the lounge's near side has no room to run along
	loungeWalled() {
		return this.lounge.y + this.lounge.d >= this.layout.building.bottom - 0.05;
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
					this.drawRisingSeat(
						ctx,
						at,
						{
							screen: { ...screenOf(session), kind: session.status === 'stopped' ? 'off' : 'idle' },
							engineColor: `hsl(${session.engine.hue ?? 215} 45% 50%)`,
							time: this.time,
							seed: worker.seed,
							frost: session.status !== 'stopped',
						},
						homeSeat.island?.key,
					),
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
					monitor.x + Math.round((noise(`${spark}|${Math.floor(time * 3)}`) - 0.5) * 12),
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
		const spot = { x: at.x + 2, y: neck - 1 };

		if (keepingOf(worker.session) === 'warm') {
			for (let step = 0; step < 3; step++)
				rect(ctx, spot.x + step, spot.y - step, 3, 3, step === 1 ? '#e8e2d6' : PALETTE.k);
			rect(ctx, spot.x + 3, spot.y + 2, 1, 3, PALETTE.a);

			return;
		}
		// The giant cup lifted off the desk to its mouth, its straw between its lips, a long pull on it, and set back
		const t = Math.min(1, (this.time - worker.boostAt) / DRINK_SECONDS);
		const lift = Math.min(1, t / DRINK_LIFT, (1 - t) / DRINK_LIFT);
		// Held beside its head, above the desk it sits behind, the straw bent across to its mouth
		const held = { x: at.x + 10, y: neck + 1 };
		const desk = { x: at.x + 13, y: at.y + 2 };
		const slurp = lift === 1 ? Math.floor(this.time * 3) % 2 : 0;
		const cup = {
			x: Math.round(desk.x + (held.x - desk.x) * lift),
			y: Math.round(desk.y + (held.y - desk.y) * lift) - slurp,
		};

		this.drawCup(ctx, cup, { straw: lift < 1 });
		if (lift < 1) return;
		// The straw straight out of its lid down to its lips; its hand round the cup
		const reach = cup.x - at.x - 4;

		for (let step = 0; step <= reach; step++)
			rect(ctx, cup.x - step, cup.y - 10 + Math.round((step * 6) / Math.max(1, reach)), 1, 1, CUP.straw);
		rect(ctx, cup.x - 4, cup.y - 5, 2, 3, PALETTE.a);
	}

	// A giant fountain cup of something caffeinated, `spot` its foot: wider at the rim, white at its top and its foot and
	// red between with a white and yellow mark on it, a domed lid and a straight orange straw
	drawCup(ctx, spot, { straw = true } = {}) {
		const { x, y } = spot;
		// Its body from the rim down, narrowing toward its foot
		const rows = [
			[-3, 7],
			[-3, 7],
			[-3, 7],
			[-3, 6],
			[-2, 5],
			[-2, 5],
			[-2, 5],
			[-2, 4],
		];

		rows.forEach(([from, w], row) => {
			const at = y - rows.length + 1 + row;
			const red = row >= 2 && row <= 5;

			rect(ctx, x + from - 1, at, w + 2, 1, PALETTE.k);
			rect(ctx, x + from, at, w, 1, red ? CUP.red : CUP.white);
			rect(ctx, x + from, at, 1, 1, red ? CUP.lit : CUP.white);
			rect(ctx, x + from + w - 1, at, 1, 1, red ? CUP.shade : CUP.whiteShade);
		});
		rect(ctx, x - 2, y + 1, 4, 1, PALETTE.k);
		// Its mark on the red: a yellow bolt with a white flash beside it
		rect(ctx, x, y - 5, 1, 1, CUP.zap);
		rect(ctx, x - 1, y - 4, 2, 1, CUP.zap);
		rect(ctx, x - 1, y - 3, 1, 1, CUP.zap);
		rect(ctx, x + 1, y - 5, 1, 2, CUP.white);
		rect(ctx, x - 2, y - 2, 1, 1, CUP.white);
		// The lid, clear plastic domed over the rim and wider than it, and the straw straight up out of it
		const lid = y - rows.length;

		rect(ctx, x - 5, lid - 1, 11, 2, PALETTE.k);
		rect(ctx, x - 4, lid, 9, 1, CUP.lid);
		rect(ctx, x - 3, lid - 2, 7, 1, PALETTE.k);
		rect(ctx, x - 2, lid - 1, 5, 1, CUP.lid);
		rect(ctx, x - 1, lid - 1, 1, 1, CUP.white);
		if (!straw) return;
		rect(ctx, x + 1, lid - 5, 1, 4, CUP.straw);
		rect(ctx, x + 1, lid - 5, 1, 1, CUP.strawLit);
	}

	// Its coffee or giant cup on its way down the tube to it, or back up, while that's going on
	serving(worker) {
		const { serving } = worker;

		return serving && this.time - serving.at < SERVE_SECONDS && this.pipeFrom(worker.seat) ? serving : null;
	}

	// What keeps it going on the console beside it, `at` the console's front (art pixels): a mug of coffee kept warm, a
	// giant cup of something caffeinated kept going. Off the console while it's drinking; brought down the tube by its
	// nozzle when it's given, and taken back up it when it's taken away.
	drawPick(ctx, worker, at) {
		if (this.drinking(worker)) return;

		const serving = this.serving(worker);
		const kind = serving ? (serving.give ?? serving.take) : keepingOf(worker.session);
		const spot = { x: at.x + 12, y: at.y - 7 };
		// The cup stands back on the desk's top, behind the mug's place at its front edge; each one's top, where the
		// nozzle holds it
		const drink = kind === 'warm' ? { x: spot.x, top: spot.y - 6 } : { x: spot.x + 3, top: spot.y - 16 };

		if (!serving) return this.drawDrink(ctx, worker, kind, spot, 0);

		const ceiling = this.pipeFrom(worker.seat)[0].y;
		const t = (this.time - serving.at) / SERVE_SECONDS;
		const down = (t < 0.3 && t / 0.3) || (t < 0.7 && 1) || Math.max(0, 1 - (t - 0.7) / 0.3);
		const mouth = Math.round(ceiling + (drink.top - 1 - ceiling) * down);
		const held = serving.give ? t < 0.5 : t >= 0.5;

		// Held in the nozzle, out of the ceiling and back into it
		ctx.save();
		ctx.beginPath();
		ctx.rect(drink.x - 20, ceiling, 40, at.y - ceiling + 4);
		ctx.clip();
		this.drawDrink(ctx, worker, kind, spot, held ? mouth + 1 - drink.top : 0);
		ctx.restore();
		this.drawNozzle(ctx, drink.x, ceiling, mouth);
	}

	// A mug of coffee, steaming while it sits on the desk, or a giant cup of something caffeinated, `spot` the mug's place at the
	// desk's front edge, `lift` art pixels up from it (negative)
	drawDrink(ctx, worker, kind, spot, lift) {
		const { x } = spot;
		const y = spot.y + lift;

		if (kind !== 'warm') return this.drawCup(ctx, { x: x + 3, y: y - 6 }, { straw: !lift });

		rect(ctx, x - 3, y - 6, 7, 7, PALETTE.k);
		rect(ctx, x - 2, y - 5, 5, 5, '#e8e2d6');
		rect(ctx, x - 2, y - 5, 5, 1, '#5a3a22');
		rect(ctx, x + 4, y - 4, 2, 3, PALETTE.k);
		rect(ctx, x + 4, y - 3, 1, 1, '#e8e2d6');
		if (lift) return;

		const rise = (this.time * 0.9 + worker.seed) % 1;

		ctx.globalAlpha = 0.7 * (1 - rise);
		rect(ctx, x + (Math.floor(rise * 3) % 2), y - 8 - Math.round(rise * 6), 1, 2, PALETTE.W);
		ctx.globalAlpha = 1;
	}

	// The worker: its body, and over it a head sized by its context. Its state shows in how it carries on: typing at
	// work, a thought bubble between tools, waving when asking, blinking when idle, dozing when stopped or waiting out a
	// usage limit; on its feet walking somewhere.
	drawWorker(ctx, worker) {
		const { session } = worker;
		const walking = this.walking(worker);
		const at = this.art(walking ? worker : this.placeOf(worker));

		if (!walking && !worker.seat?.housing) at.y -= (worker.lounging && 4) || (briefOf(worker) && -2) || 10;
		worker.headX = at.x;

		// Deleted: crumbling from the top down, its dust falling to a heap where it was
		if (worker.vaporizedAt !== undefined && !worker.crumbling) {
			const gone = Math.min(1, (this.time - worker.vaporizedAt) / VAPOR_SECONDS);

			worker.crumbling = true;
			const top = at.y - 26;

			worker.crumble = { x: at.x, line: Math.round(top + (worker.dustAt.y - top) * gone), gone };
			ctx.save();
			ctx.beginPath();
			ctx.rect(at.x - 24, worker.crumble.line, 48, 60);
			ctx.clip();
			this.drawWorker(ctx, worker);
			ctx.restore();
			worker.crumbling = false;

			return;
		}

		const making = (this.time - (worker.madeAt ?? -Infinity)) / MAKE_SECONDS;

		if (worker.leaving && worker.vaporizedAt === undefined) this.drawBeam(ctx, at, 1 - worker.opacity);
		if (worker.leaving && worker.vaporizedAt === undefined && worker.opacity < 0.5) return;
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
		if (thinking) this.drawConcentrating(ctx, { x: at.x, top, w, h, seed: worker.seed });
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

	// A deleted worker's dust as it crumbles, `gone` 0 to 1: specks breaking off at the line eating down it and falling,
	// and the heap they make growing on the floor
	drawCrumbling(ctx, worker) {
		const { x: middle, line, gone } = worker.crumble;
		const floor = worker.dustAt.y;

		for (let speck = 0; speck < 26; speck++) {
			const seed = seeded(`${worker.session.key}|dust${speck}`);
			const start = (speck / 26) * 0.9;
			const fall = (gone - start) / 0.35;

			if (fall <= 0 || fall >= 1) continue;

			const from = Math.min(line, floor - 2);
			const x = middle - 7 + Math.round(seed * 14) + Math.round(Math.sin(seed * 20 + fall * 3) * 2);
			const y = Math.round(from + (floor - from) * fall * fall);

			rect(ctx, x, y, 1, 1, speck % 3 ? DUST.light : DUST.dark);
		}
		this.drawDustHeap(ctx, worker.dustAt, gone);
	}

	// A heap of dust, `size` 0 to 1 of its full size
	// The lounge's couches come and go with those resting there: one more needed is dropped out of the tube onto its
	// place; one no longer needed is phasered to ash by the last to get up from it, if they got up lately, and its ash
	// sucked up by the tube as any is
	tendCouches() {
		const needed = this.lounge ? Math.ceil(Math.max(this.lounge.count, 1) / 2) : 0;
		const had = this.couches ?? needed;

		this.couchDrops ??= [];
		this.couchBlasts ??= [];
		for (let index = had; index < needed; index++) this.couchDrops.push({ index, at: this.time });
		for (let index = needed; index < had; index++) {
			const seat = this.lastLounge && loungeSeatAt(this.lastLounge, index * 2);
			const shooter =
				this.lastUp && this.time - this.lastUp.at < COUCH_BLAST.lately && this.workers.get(this.lastUp.key);

			if (!seat) continue;
			if (shooter) shooter.aimingUntil = this.time + COUCH_BLAST.aim;
			this.couchBlasts.push({ index, at: this.time, seat, shooter: shooter && this.lastUp.key });
		}
		this.couchDrops = this.couchDrops.filter(({ index }) => index < needed);
		this.couches = needed;
		this.lastLounge = this.lounge && { ...this.lounge };
	}

	// How high a couch hangs from the tube's nozzle before it drops, in art pixels: its top at the nozzle's mouth, let
	// down just under the lounge's ceiling
	couchHang(index) {
		const seat = loungeSeatAt(this.lounge, index * 2);
		const foot = this.art(seat).y;
		const ceiling = this.art({ x: 0, y: this.lounge.y }).y + 2;

		return Math.max(0, Math.min(40, foot - 19 - (ceiling + 10)));
	}

	// How far up each couch dropping out of the tube still is, in art pixels, by its index
	couchesLifted() {
		const lifted = [];
		const { down, fall, settle } = COUCH_DROP;

		for (const { index, at } of this.couchDrops ?? []) {
			const since = this.time - at;
			const hang = this.lounge ? this.couchHang(index) : 0;

			if (since < down) lifted[index] = hang;
			else if (since < down + fall) lifted[index] = hang * (1 - ((since - down) / fall) ** 2);
			else if (since < down + fall + settle)
				lifted[index] = Math.round(Math.sin(((since - down - fall) / settle) * Math.PI) * 2);
		}

		return lifted;
	}

	// The nozzle bringing a couch, and couches being phasered and crumbling to ash
	couchParts(ctx) {
		const { lounge } = this;

		if (!lounge) return [];

		const ceiling = this.art({ x: 0, y: lounge.y }).y + 2;
		const { down, fall, settle, up } = COUCH_DROP;

		this.couchDrops = (this.couchDrops ?? []).filter(({ at }) => this.time - at < down + fall + settle + up);
		this.couchBlasts = (this.couchBlasts ?? []).filter(
			({ at }) => this.time - at < COUCH_BLAST.aim + COUCH_BLAST.crumble,
		);

		return [
			...this.couchDrops.map(({ index, at }) => {
				const seat = loungeSeatAt(lounge, index * 2);
				const middle = this.art({ x: seat.x + COUCH_SEAT / 2, y: seat.y });
				const since = this.time - at;
				const over = middle.y - 19 - this.couchHang(index) - 1;
				const reach = (() => {
					if (since < down) return since / down;
					if (since < down + fall + settle) return 1;

					return Math.max(0, 1 - (since - down - fall - settle) / up);
				})();

				return {
					y: seat.y + 0.2,
					draw: () => this.drawNozzle(ctx, middle.x, ceiling, Math.round(ceiling + (over - ceiling) * reach)),
				};
			}),
			...this.couchBlasts.map(blast => ({ y: blast.seat.y + 0.2, draw: () => this.drawCouchBlast(ctx, blast) })),
		];
	}

	// A couch no longer needed: phasered by the last to get up from it, then crumbling, its ash left for the tube
	drawCouchBlast(ctx, blast) {
		const since = this.time - blast.at;
		const at = this.art(blast.seat);
		const width = Math.round(COUCH_SEAT * UNIT.x * 2);
		const left = at.x - Math.round(COUCH_SEAT * UNIT.x) / 2;
		const shooter = blast.shooter && this.workers.get(blast.shooter);
		const fabric =
			since < COUCH_BLAST.aim
				? 'hsl(14 38% 42%)'
				: `hsl(14 ${Math.round(38 * (1 - (since - COUCH_BLAST.aim) / COUCH_BLAST.crumble))}% 30%)`;
		const standing = since < COUCH_BLAST.aim ? 1 : Math.max(0, 1 - (since - COUCH_BLAST.aim) / COUCH_BLAST.crumble);
		const tall = Math.round(19 * standing);

		// The couch, its back, cushions and arms, crumbling away from its top once hit
		if (tall > 0) {
			ctx.save();
			ctx.beginPath();
			ctx.rect(left - 6, at.y - tall, width + 12, tall + 6);
			ctx.clip();
			rect(ctx, left - 3, at.y - 19, width + 6, 14, PALETTE.k);
			rect(ctx, left - 2, at.y - 18, width + 4, 12, fabric);
			rect(ctx, left + width / 2, at.y - 17, 1, 11, PALETTE.k);
			rect(ctx, left - 3, at.y - 6, width + 6, 9, PALETTE.k);
			rect(ctx, left - 2, at.y - 5, width + 4, 7, fabric);
			for (const arm of [left - 4, left + width]) {
				rect(ctx, arm, at.y - 9, 4, 12, PALETTE.k);
				rect(ctx, arm + 1, at.y - 8, 2, 10, fabric);
			}
			ctx.restore();
		}
		if (since >= COUCH_BLAST.aim)
			for (let fleck = 0; fleck < 6; fleck++) {
				const drift = (since - COUCH_BLAST.aim) * 14;

				rect(
					ctx,
					left + ((fleck * 7) % width),
					at.y - tall - 2 - Math.round(drift * (0.4 + (fleck % 3) * 0.3)),
					1,
					1,
					DUST.light,
				);
			}
		// The phaser's beam from the shooter's hand, crackling, while they fire
		if (shooter && since > 0.35 && since < COUCH_BLAST.aim + 0.15) {
			const hand = this.art({ x: shooter.x, y: shooter.y });
			const from = { x: hand.x + (at.x > hand.x ? 4 : -4), y: hand.y - 12 };
			const to = { x: left + width / 2, y: at.y - 9 };
			const steps = Math.max(1, Math.round(Math.hypot(to.x - from.x, to.y - from.y) / 2));

			rect(ctx, from.x - 1, from.y - 1, 3, 2, PALETTE.k);
			rect(ctx, from.x, from.y, 2, 1, '#9aa5bb');
			for (let step = 0; step <= steps; step++) {
				const x = Math.round(from.x + ((to.x - from.x) * step) / steps);
				const y = Math.round(from.y + ((to.y - from.y) * step) / steps + (Math.floor(this.time * 30 + step) % 3) - 1);

				rect(ctx, x, y, 1, 1, step % 2 ? '#ffd0ff' : '#ff6bf0');
			}
		}
	}

	// A phasered couch gone to ash: its heap left on the floor where it stood, for the tube to suck up
	ashCouches() {
		for (const blast of this.couchBlasts ?? []) {
			if (blast.ashed || this.time - blast.at < COUCH_BLAST.aim + COUCH_BLAST.crumble - 0.05) continue;

			const at = this.art(blast.seat);

			blast.ashed = true;
			this.dust.push({
				x: at.x + Math.round(COUCH_SEAT * UNIT.x) / 2,
				y: at.y + 2,
				depth: blast.seat.y + 0.3,
				at: this.time,
			});
		}
	}

	// A heap of ash, lying a moment, then sucked up into the tube: its nozzle let down from the ceiling of the room it
	// lies in to just over it, the heap dwindling as flecks of it rise into the nozzle, and the nozzle drawn back up
	drawAshSucked(ctx, heap) {
		const since = this.time - heap.at;
		const room = this.roomAt({ x: heap.x / UNIT.x, y: heap.depth });
		const ceiling = room ? this.art({ x: 0, y: room.y }).y + 2 : heap.y - 40;
		const over = heap.y - 6;
		const { lies, down, sucks, up } = ASH;
		const sucked = Math.max(0, Math.min(1, (since - lies - down) / sucks));
		// How far down its nozzle reaches, 0 to 1
		const reach = (() => {
			if (since < lies) return 0;
			if (since < lies + down) return (since - lies) / down;
			if (since < lies + down + sucks) return 1;

			return Math.max(0, 1 - (since - lies - down - sucks) / up);
		})();

		if (sucked < 1) this.drawDustHeap(ctx, heap, 1 - sucked);
		if (reach <= 0) return;

		const mouth = Math.round(ceiling + (over - ceiling) * reach);

		// Flecks of it rising into the nozzle while it sucks
		if (sucked > 0 && sucked < 1)
			for (let fleck = 0; fleck < 4; fleck++) {
				const rise = (this.time * 2.2 + fleck / 4) % 1;

				rect(
					ctx,
					heap.x + Math.round((1 - rise) * (fleck - 1.5) * 3),
					Math.round(heap.y - 1 + (mouth + 1 - heap.y) * rise),
					1,
					1,
					fleck % 2 ? DUST.light : DUST.dark,
				);
			}
		this.drawNozzle(ctx, heap.x, ceiling, mouth);
	}

	drawDustHeap(ctx, { x, y }, size) {
		const w = Math.round(2 + size * 10);
		const h = Math.max(1, Math.round(size * 3));

		for (let row = 0; row < h; row++) {
			const across = Math.max(1, w - row * 4);

			rect(ctx, x - Math.floor(across / 2), y - row, across, 1, row ? DUST.light : DUST.dark);
		}
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

	// Thinking hard, on a head `w` by `h` with its top at `top` and its middle at `x`: its brow knit over its eyes, and
	// its skull glowing softly, brightening and dimming slowly as it mulls it over
	drawConcentrating(ctx, { x, top, w, h, seed }) {
		const swell = 0.5 + 0.5 * Math.sin((this.time / THINK_BREATH + seed) * TAU);
		const middle = top + (h - EYES_UP) / 2;
		const glow = ctx.createRadialGradient(x, middle, 1, x, middle, w * 0.6);

		glow.addColorStop(0, `rgba(160, 232, 255, ${0.25 + swell * 0.3})`);
		glow.addColorStop(1, 'rgba(160, 232, 255, 0)');
		ctx.fillStyle = glow;
		ctx.fillRect(x - w, middle - h, w * 2, h * 2);

		// Each brow angled down toward the nose, just over its eye
		const brow = top + h - EYES_UP - 1;

		for (const side of [-1, 1]) {
			rect(ctx, x + side * 4, brow - 1, 1, 1, PALETTE.k);
			rect(ctx, x + side * 3, brow, 1, 1, PALETTE.k);
			rect(ctx, x + side * 2, brow, 1, 1, PALETTE.k);
		}
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
	// A rack for each project's island (or its machine, for those jacked into it), out at its forward end where nobody
	// stands in front of it: a sled in it for each process its sessions run beside Claude, as many as it holds, and a
	// beacon atop it while any of them serves something. Pressed, it opens the processes of the one that runs some, or
	// offers each that does.
	rackParts(ctx) {
		const racks = new Map();

		for (const worker of this.workers.values()) {
			const { seat, session, lounging, leaving } = worker;
			const { processes = [], services = [] } = session;

			if (!seat || lounging || leaving || (!processes.length && !services.length)) continue;

			const key = seat.island?.key ?? `${session.project}|${seat.housing ? 'machine' : seat.y}`;
			const rack = racks.get(key) ?? { seat, island: seat.island, processes: [], services: [], workers: [] };

			rack.workers.push(worker);
			rack.processes.push(...processes);
			rack.services.push(...services);
			racks.set(key, rack);
		}

		return [...racks.values()].map(rack => {
			const { island, seat } = rack;
			const spot = (island && { x: island.x + island.w + 0.3, y: island.y - 0.15 }) ||
				(seat.housing && { x: seat.x - 0.65, y: seat.y + 0.05 }) || { x: seat.x - 1.1, y: seat.y - 0.15 };

			return { y: spot.y, draw: () => this.drawRack(ctx, this.art(spot), rack) };
		});
	}

	drawRack(ctx, at, { processes, services, workers }) {
		const count = Math.max(1, Math.min(RACK_SLEDS, processes.length));
		const tall = count * 3 + 2;

		rect(ctx, at.x - 4, at.y - tall, 9, tall, PALETTE.k);
		rect(ctx, at.x - 4, at.y - tall, 1, tall, PALETTE.d);
		for (let unit = 0; unit < count; unit++) {
			const y = at.y - 3 - unit * 3;
			const busy = (processes[unit]?.cpuSeconds ?? 0) > 1;

			rect(ctx, at.x - 2, y, 6, 2, PALETTE.m);
			rect(ctx, at.x - 1, y, 1, 1, busy && Math.floor(this.time * 6 + unit) % 2 ? PALETTE.t : PALETTE.T);
			rect(ctx, at.x + 2, y, 1, 1, Math.floor(this.time * 2 + unit) % 3 ? PALETTE.y : PALETTE.Y);
		}
		if (services.length) {
			rect(ctx, at.x, at.y - tall - 6, 1, 6, PALETTE.l);
			rect(ctx, at.x - 1, at.y - tall - 8, 3, 2, Math.floor(this.time * 2) % 2 ? PALETTE.t : PALETTE.W);
		}
		this.hits.push({
			...this.toScreen({ x: at.x, y: at.y - tall / 2 }),
			r: 6 * this.camera.zoom,
			kind: 'processes',
			worker: workers[0],
			workers,
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
		const { materializer, hangar } = this.layout;
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
				at: { x: clonerAt(materializer).x - 0.6, y: clonerAt(materializer).y + 0.6 },
			},
			// Clear of the hold's stacks and the pad's ring: round the pad on the shipping floor
			'filing decisions': hangar && { room: hangar, at: { x: padAt(hangar).x - 1, y: padAt(hangar).y - 0.5 } },
			'writing a commit message': hangar && {
				room: hangar,
				at: { x: padAt(hangar).x + 1.3, y: padAt(hangar).y + 0.5 },
			},
			'drafting a pull request': hangar && {
				room: hangar,
				at: { x: padAt(hangar).x - 1.1, y: padAt(hangar).y + 0.5 },
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

	// Where a bot of the service crew waits in engineering: lined up in the trunk below its door, the one way in clear of
	// its units
	berthOf(index) {
		const engineering = this.layout.engineering;
		const x = engineering.aisle ?? engineering.x + engineering.w - 0.2;
		const floor = engineering.y + engineering.d - BERTH_GAP;

		return { x, y: Math.min(floor, engineering.door.y + BERTH_GAP * (index + 1)) };
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
				// Setting off one behind another, so those sent together trail along rather than ride on each other
				wait: [...this.bots.values()].filter(bot => !bot.back && bot.path.length).length * BOT_GAP,
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
			if (bot.wait > 0) {
				bot.wait -= seconds;
				continue;
			}

			let left = seconds * BOT_SPEED;

			while (left > 0 && bot.path.length) {
				const [goal] = bot.path;
				const away = Math.hypot(goal.x - bot.x, goal.y - bot.y);

				if (Math.abs(goal.x - bot.x) > 0.01) bot.facing = Math.sign(goal.x - bot.x);
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
		const furniture = this.furniture();

		// Over everything; but behind what stands in front of them (an
		// island, a ship's terminal, the lounge's couches and screen), sorted in among it by depth, so it hides them
		return bots.map(bot => ({
			y: this.behindFurniture(bot, furniture) ? bot.y : TUBE_FRONT - 0.001,
			draw: () => {
				const at = this.art(bot);
				const working = !bot.docked && !bot.back && !bot.path.length;
				const walking = bot.path.length > 0;
				const bob = (working || walking) && Math.floor(this.time * (walking ? 8 : 4) + bot.index) % 2;
				this.drawDroid(ctx, at, { facing: bot.facing ?? 1, lit: !bot.docked, bob, working, seed: bot.index });
				this.hits.push({
					...this.toScreen({ x: at.x, y: at.y - 4 }),
					r: 5 * this.camera.zoom,
					kind: 'crew',
					crew,
				});
			},
		}));
	}

	// What stands that something on the floor can pass behind, in art pixels, its foot the front of it: the bridge's
	// islands with their screens, the other ships' terminals, the lounge's couches and screen, and the materializer's
	// and transporter's tubes
	furniture() {
		const { lounge } = this;
		const box = (from, to, rise) => {
			const [a, b] = [this.art(from), this.art(to)];

			return { left: a.x, right: b.x, top: a.y - rise, bottom: b.y };
		};

		return [
			...(this.bridge?.islands ?? []).map(island =>
				box({ x: island.x, y: island.y }, { x: island.x + island.w, y: island.y + 0.25 }, SCREEN_RISE),
			),
			...(this.bridge ? this.fleetSpots() : []).map(({ x, y }) => {
				const at = this.art({ x, y });

				return { left: at.x - 18, right: at.x + 15, top: at.y - SCREEN_RISE, bottom: at.y + 1 };
			}),
			...(lounge?.count
				? [box({ x: lounge.x, y: lounge.y + LOUNGE_FURNISHED }, { x: lounge.x + lounge.w, y: lounge.y + lounge.d }, 0)]
				: []),
			// The materializer's cloner and the transporter's pad, tall tubes standing at the bridge's foot
			...[this.layout.materializer, this.layout.transporter].filter(Boolean).map(room => {
				const at = this.art(clonerAt(room));

				return { left: at.x - 8, right: at.x + 8, top: at.y - 20, bottom: at.y + 3 };
			}),
		];
	}

	// Whether something on the floor at `at` stands behind any of `furniture`, overlapping it: as big as a droid unless
	// `half` its width and `tall`, in art pixels, say otherwise
	behindFurniture(at, furniture, { half = 5, tall = 7 } = {}) {
		const foot = this.art(at);
		const { left, right, top, bottom } = {
			left: foot.x - half,
			right: foot.x + half,
			top: foot.y - tall,
			bottom: foot.y,
		};

		return furniture.some(
			thing =>
				bottom < thing.bottom &&
				Math.min(right, thing.right) - Math.max(left, thing.left) > 0 &&
				Math.min(bottom, thing.bottom) - Math.max(top, thing.top) > 0,
		);
	}

	// A little droid of the crew, `at` its foot: a low black box on wheels scooting about, its front sloped toward where
	// it's going (`facing`), a sensor eye lit while it's on a job and a stripe of paude's color down its side
	drawDroid(ctx, at, { facing, lit, bob, working, seed }) {
		const { x } = at;
		const y = at.y - bob;
		const front = x + facing * 4;

		// Its wheels, turning while it goes
		for (const wheel of [-3, 2]) {
			rect(ctx, x + wheel, at.y - 1, 2, 1, PALETTE.k);
			if (bob) rect(ctx, x + wheel, at.y - 1, 1, 1, PALETTE.d);
		}
		// The box, its top lit and its front sloped
		rect(ctx, x - 5, y - 6, 10, 5, PALETTE.k);
		rect(ctx, x - 4, y - 5, 8, 3, '#2a2f38');
		rect(ctx, x - 4, y - 5, 8, 1, '#4a5160');
		rect(ctx, front - (facing > 0 ? 1 : 0), y - 5, 1, 1, PALETTE.k);
		rect(ctx, x - 4, y - 3, 8, 1, PALETTE.o);
		// The grille at its back, its eye at its front
		rect(ctx, x - facing * 3, y - 4, 1, 1, '#4a5160');
		const blink = Math.floor(this.time * 4 + seed) % 4 === 0;

		rect(ctx, front - facing * 2, y - 4, 1, 1, (!lit && PALETTE.d) || (blink && PALETTE.W) || PALETTE.r);
		if (working && Math.floor(this.time * 3 + seed) % 2) rect(ctx, x - facing, y - 7, 1, 1, PALETTE.y);
	}

	// Hazard tape round a seat whose session asks nothing before it acts
	drawMats(ctx) {
		for (const { seat, session, lounging } of this.workers.values()) {
			if (!seat || lounging || seat.housing || session.mode !== 'bypassPermissions') continue;

			const from = this.art({ x: seat.x - DESK_PITCH / 2 + 0.1, y: seat.y - DESK_ROW + 0.6 });
			const to = this.art({ x: seat.x + DESK_PITCH / 2 - 0.1, y: seat.y + 0.45 });

			ctx.drawImage(tapeOf(from, to), from.x, from.y);
		}
	}

	// The hold's cargo: for each checkout a stack of sheets for its changed files, and beside it the crates of its
	// commits waiting to go
	cargoParts(ctx) {
		const hold = this.layout.hold;

		if (!hold) return [];

		// A pod on its way out has left its cradle; an empty one is back once it's gone
		const launching = new Set(this.haulers.map(({ pod }) => pod));
		// The gantry along the hold's ceiling, its crane's trolley over the pod it's working or wandering the rail
		const gantry = {
			y: hold.y + 0.05,
			draw: () => {
				const { left, right, rail } = this.gantryOf(hold);
				const trolley = Math.round(this.craneX ?? (left + right) / 2);

				rect(ctx, left, rail - 1, right - left, 3, PALETTE.k);
				rect(ctx, left, rail, right - left, 1, PALETTE.m);
				for (let bolt = left + 4; bolt < right; bolt += 12) rect(ctx, bolt, rail, 1, 1, PALETTE.l);
				rect(ctx, trolley - 5, rail + 1, 11, 5, PALETTE.k);
				rect(ctx, trolley - 4, rail + 2, 9, 3, PALETTE.d);
				rect(ctx, trolley - 4, rail + 2, 9, 1, PALETTE.l);
				rect(ctx, trolley, rail + 3, 2, 1, Math.floor(this.time * 2) % 2 ? PALETTE.y : PALETTE.o);
			},
		};

		return [
			gantry,
			...this.cargo.map((checkout, index) => {
				const spot = holdSpotAt(hold, index);
				const bay = this.bays.find(({ name }) => name === checkout.project);

				return {
					y: spot.y,
					draw: () => {
						const at = this.art(spot);

						if (launching.has(index)) return;
						this.drawPod(ctx, at, { hue: bay?.hue, crates: checkout.unpushed, sheets: checkout.changed });
						this.drawPacking(ctx, at, checkout);
						for (let crate = 0; crate < Math.min(MOST.crates, checkout.unpushed); crate++) {
							const commit = checkout.commits?.[crate];

							if (commit)
								this.hits.push({
									...this.toScreen({ x: this.crateAt(at, crate).x + 1, y: this.crateAt(at, crate).y + 1 }),
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
						// Off the trunk, its branch's plate on the cradle in the branch's color and, close enough, its name
						if (!checkout.trunk && (checkout.changed || checkout.unpushed)) {
							const hue = checkout.branch ? branchHue(checkout.branch) : null;
							const color = hue === null ? PALETTE.l : `hsl(${hue} 60% 74%)`;

							rect(ctx, at.x + 1, at.y + 1, 13, 4, PALETTE.k);
							rect(ctx, at.x + 2, at.y + 2, 11, 2, hue === null ? PALETTE.m : `hsl(${hue} 50% 45%)`);
							if (this.camera.zoom >= 4)
								this.labels.push({
									text: checkout.branch ?? 'detached',
									at: { x: at.x + 7, y: at.y + 5 },
									color,
									align: 'center',
									gap: 8,
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
			}),
		];
	}

	// A push leaving: its checkout's pod lets go of the dock and drops out through the doors in the belly under it with
	// its crates aboard
	// The hold's gantry, in art pixels: its rail's ends and height along the ceiling
	gantryOf(hold) {
		return {
			left: this.art({ x: hold.x + 0.15, y: 0 }).x,
			right: this.art({ x: hold.x + hold.w - 0.15, y: 0 }).x,
			rail: this.art({ x: 0, y: hold.y + 0.3 }).y,
		};
	}

	// The crane's trolley along the gantry: to the pod whose commit it's pressing, else wandering the rail slowly
	tendCrane(seconds) {
		const hold = this.layout?.hold;

		if (!hold) return;

		const { left, right } = this.gantryOf(hold);
		// Carrying a part out of the hopper to its pod, over it; else pressing a commit, over that pod; else wandering
		const carrying = this.parcels.find(({ craned, path }) => craned && path.length);
		const pressing = this.cargo.findIndex(
			({ key }) => this.time - (this.packings.get(key) ?? -Infinity) < PACK_SECONDS,
		);
		const goal =
			(carrying && this.art(carrying).x) ||
			(pressing >= 0 && this.art(holdSpotAt(hold, pressing)).x + 3) ||
			left + 8 + (right - left - 16) * (0.5 + 0.5 * Math.sin(this.time * CRANE_WANDER));

		this.craneX ??= goal;
		// Carrying, right over its load; else easing there
		this.craneX = carrying
			? goal
			: this.craneX + (goal - this.craneX) * Math.min(1, seconds * (pressing >= 0 ? 12 : 2));
	}

	// A commit made: over its pod, a press coming down on the sheets of changes, which flash as they're pressed, and the
	// new crate popping into its place with a spark; up again after
	drawPacking(ctx, at, checkout) {
		const since = this.time - (this.packings.get(checkout.key) ?? -Infinity);

		if (since < 0 || since > PACK_SECONDS) return;

		const t = since / PACK_SECONDS;
		const down = Math.round(Math.sin(Math.min(1, t / 0.6) * Math.PI) * 4);

		// The crane's arm let down from its trolley to the pod's top, and its plate pressing; the sheets flashing under it
		const { rail } = this.gantryOf(this.layout.hold);
		const arm = Math.round(this.craneX ?? at.x + 3);
		const plate = at.y - 29 + down;

		rect(ctx, arm - 1, rail + 6, 3, plate - rail - 6, PALETTE.k);
		rect(ctx, arm, rail + 6, 1, plate - rail - 6, PALETTE.l);
		rect(ctx, arm - 5, plate, 11, 3, PALETTE.k);
		rect(ctx, arm - 4, plate + 1, 9, 1, PALETTE.y);
		if (t < 0.6 && down > 2) rect(ctx, at.x - 7, at.y - 17, 6, 10, 'rgba(255, 255, 255, 0.55)');

		// The crate it made, popped into its slot
		if (t >= 0.55) {
			const slot = this.crateAt(at, Math.max(0, Math.min(MOST.crates, checkout.unpushed) - 1));

			this.drawSparkle(ctx, slot.x + 1, slot.y, (t - 0.55) / 0.45);
		}
	}

	// Where a push's pod is at `time` of it, in world units, and how small it's gone: lifted off its cradle, then dropped
	// out through the hatch in the belly and falling away under and aft of the ship faster and faster as it's left behind
	podFlight({ pod }, time) {
		const from = holdSpotAt(this.layout.hold, pod ?? 0);

		if (time < HAUL_LIFT) return { x: from.x, y: from.y - Math.sin((time / HAUL_LIFT) * Math.PI) * 0.12, scale: 1 };

		const falling = (time - HAUL_LIFT) / (1 - HAUL_LIFT);

		return {
			x: from.x - JETTISON.aft * falling ** 3,
			y: from.y + JETTISON.down * falling ** 2,
			scale: 1 - JETTISON.shrink * falling ** 2,
			falling,
		};
	}

	// Where the hangar's tug is through a push's `time`, in world units, which way it faces and how small it's gone; null
	// while it's on its pad, or away out of sight
	tugFlight(hauler) {
		const { hangar } = this.layout;

		if (!hangar || !this.layout.hold) return null;

		const pad = padAt(hangar);
		const under = this.layout.building.bottom + TUG_UNDER;
		const { time } = hauler;
		const { lifted, below, escorting, gone, home } = TUG_FLIGHT;
		const ease = t => t * t * (3 - 2 * t);

		if (time < lifted) return { x: pad.x, y: pad.y - TUG_HOVER * ease(time / lifted), scale: 1 };
		if (time < below) {
			const t = (time - lifted) / (below - lifted);

			return { x: pad.x, y: pad.y - TUG_HOVER + (under - pad.y + TUG_HOVER) * t * t, scale: 1, diving: true };
		}
		if (time < gone) {
			// Swung round after the pod, closing to just off its nose and keeping there as both are left behind
			const pod = this.podFlight(hauler, time);
			const closing = ease(Math.min(1, (time - below) / (escorting - below)));
			const beside = { x: pod.x + 1.6 * pod.scale, y: pod.y - 0.4 * pod.scale };

			return {
				x: pad.x + (beside.x - pad.x) * closing,
				y: under + (beside.y - under) * closing,
				scale: 1 + (pod.scale - 1) * closing,
				aft: true,
			};
		}

		const t = (time - gone) / (home - gone);

		if (t < 0.15) return null;

		const back = (t - 0.15) / 0.85;

		return { x: pad.x, y: under + 3 - (under + 3 - pad.y) * (1 - (1 - back) ** 2), scale: 1 };
	}

	// Draws `draw` around `at` as much smaller as `scale` says, as something far off
	scaledAbout(ctx, at, scale, draw) {
		ctx.save();
		ctx.translate(at.x, at.y);
		ctx.scale(scale, scale);
		ctx.translate(-at.x, -at.y);
		draw();
		ctx.restore();
	}

	// Who's looking, their key aboard. Told only once the ship has heard who's aboard, by which time they've been found
	// in place with the rest: while it's still sealed, they're taken back out to come aboard by shuttle as it opens.
	get viewer() {
		return this.viewing;
	}

	set viewer(key) {
		const was = this.viewing;

		this.viewing = key;
		if (key && key !== was) this.comeAboard(key);
	}

	comeAboard(key) {
		const walker = this.walkers.get(key);
		const { airlock } = this;

		if (!this.sealed || !walker || walker.shuttle || !airlock) return;
		Object.assign(walker, airlock, {
			path: walker.spot ? this.route(airlock, this.bridge, walker.spot, walker.room) : [],
			room: this.bridge,
		});
		walker.shuttle = { key, hue: walker.person?.hue, kind: 'in', at: this.arrived() ? this.time : undefined };
		this.shuttles.push(walker.shuttle);
	}

	// How long into its visit a shuttle is, in seconds; null while it waits for the ship to come in
	shuttleAge(shuttle) {
		return shuttle.at === undefined ? null : this.time - shuttle.at;
	}

	// How long a shuttle takes to come in and settle over the airlock: flown in, or come in with the ship
	approachOf(shuttle) {
		return shuttle.join ? JOIN.warp + ENTER_SECONDS + JOIN.settle : SHUTTLE.fly;
	}

	// Whether someone is still on their way aboard by shuttle, held at the airlock out of sight
	boarding(walker) {
		const { shuttle } = walker;
		const age = shuttle && this.shuttleAge(shuttle);

		return Boolean(shuttle) && (age === null || age < this.approachOf(shuttle) + SHUTTLE.tube + SHUTTLE.walk);
	}

	// Whether it's come in and opened with the one looking aboard: its plating gone and nobody still on their way in to
	// open it; always, for one that was never sealed
	settled() {
		return !this.sealed && !this.joining() && this.coverOf() === 0 && !this.walkingIn();
	}

	// Whether the one looking, just come aboard by shuttle, is still walking from the airlock to where they belong (as
	// long as that takes, up to a while after they stepped out)
	walkingIn() {
		const walker = this.viewer && this.walkers.get(this.viewer);
		const shuttle = walker?.shuttle;

		if (!shuttle?.join || !walker.path.length) return false;

		return this.time - shuttle.at - this.approachOf(shuttle) - SHUTTLE.tube - SHUTTLE.walk < WALK_IN_MOST;
	}

	// Whether someone just down a shuttle's tube is still in the airlock's doorway, its door opening on them, before
	// they step onto the bridge
	inDoorway(walker) {
		const { shuttle } = walker;
		const age = shuttle && this.shuttleAge(shuttle);

		return (
			Boolean(shuttle) &&
			shuttle.kind === 'in' &&
			age !== null &&
			age < this.approachOf(shuttle) + SHUTTLE.tube + SHUTTLE.walk + DOORWAY_SECONDS
		);
	}

	// Whether the one looking is still coming aboard as the ship opens, its plating held shut till they're in
	joining() {
		const walker = this.viewer && this.walkers.get(this.viewer);

		return Boolean(walker && this.boarding(walker));
	}

	// Shuttles on their way: one waiting on the ship sets off once it's come in out of warp; one come to take someone
	// off takes them once they're at the airlock and its tube is down (or once it's waited long enough), and each goes
	// once it's flown off again
	tendShuttles() {
		const { fly, tube, walk: down, retract } = SHUTTLE;

		for (const shuttle of this.shuttles) if (shuttle.at === undefined && this.arrived()) shuttle.at = this.time;
		for (const [name, walker] of this.walkers) {
			if (!walker.leaving || walker.path.length) continue;

			const shuttle = this.shuttles.find(
				({ key, kind, climbAt }) => key === name && kind === 'out' && climbAt === undefined,
			);
			const age = shuttle ? this.shuttleAge(shuttle) : Infinity;

			if (age < fly + tube && age < SHUTTLE_WAITS) continue;
			if (shuttle) shuttle.climbAt = this.time;
			this.walkers.delete(name);
		}
		for (const shuttle of this.shuttles)
			if (shuttle.kind === 'out' && shuttle.climbAt === undefined && this.shuttleAge(shuttle) > SHUTTLE_WAITS)
				shuttle.climbAt = this.time;
		this.shuttles = this.shuttles.filter(shuttle => {
			const age = this.shuttleAge(shuttle);

			if (age === null) return true;
			if (shuttle.kind === 'in') return age < this.approachOf(shuttle) + tube + down + retract + fly;

			return shuttle.climbAt === undefined || this.time - shuttle.climbAt < down + retract + fly;
		});
	}

	// A shuttle as it is at this point of its visit, docked over the airlock on the hull's back
	drawShuttleOf(ctx, shuttle) {
		const age = this.shuttleAge(shuttle);

		if (age === null || !this.layout.building || !this.airlock) return;

		const { fly, tube, walk: down, retract } = SHUTTLE;
		const ease = u => Math.max(0, Math.min(1, u)) ** 2 * (3 - 2 * Math.max(0, Math.min(1, u)));
		const dock = { x: this.art(this.airlock).x, y: hullEdges(this.layout.building).top };
		// Through its visit: where it's flown in, its tube let down, someone walking it, drawn back, flown off
		let state;

		if (shuttle.kind === 'in') {
			const approach = this.approachOf(shuttle);
			const left = age - approach - tube - down;
			// Come in with the ship: held far off in warp, drawn near as the ship pulls in under it, settled as it shimmers
			const coming = shuttle.join
				? 1 -
					0.65 * ease((age - JOIN.warp) / ENTER_SECONDS) -
					0.35 * ease((age - JOIN.warp - ENTER_SECONDS) / JOIN.settle)
				: 1 - ease(age / fly);

			state = {
				away: coming + ease((left - retract) / fly),
				tube: Math.min(ease((age - approach) / tube), 1 - ease(left / retract)),
				walker: age >= approach + tube && left < 0 ? (age - approach - tube) / down : null,
			};
		} else {
			const climbed = shuttle.climbAt === undefined ? -Infinity : this.time - shuttle.climbAt;
			const after = climbed - down;

			state = {
				away: 1 - ease(age / fly) + ease((after - retract) / fly),
				tube: Math.min(ease((age - fly) / tube), climbed === -Infinity ? 1 : 1 - ease(after / retract)),
				walker: climbed >= 0 && climbed < down ? 1 - climbed / down : null,
			};
		}
		// Come in with the ship, it holds its place on screen as the ship slides in under it
		if (shuttle.join) dock.x -= this.entryShift() / this.camera.zoom;
		drawShuttle(ctx, dock, { ...state, hue: shuttle.hue, time: this.time });
	}

	// The bay doors in the belly, each eased open while something's passing through it and shut again after: the
	// hold's while a pod drops out of it, the hangar's while the tug dives out through it or climbs back in
	tendBayDoors(seconds) {
		const tug = this.haulers[0] && this.tugFlight(this.haulers[0]);
		const time = this.haulers[0]?.time ?? 0;
		const wanted = {
			hold: this.haulers.some(hauler => hauler.time > HAUL_LIFT * 0.5 && hauler.time < 0.45) ? 1 : 0,
			hangar:
				tug && ((time > TUG_FLIGHT.lifted * 0.6 && time < TUG_FLIGHT.below + 0.05) || time > TUG_FLIGHT.gone + 0.03)
					? 1
					: 0,
		};

		this.bayDoors ??= { hold: 0, hangar: 0 };
		for (const door of ['hold', 'hangar']) {
			const step = Math.min(1, seconds * BAY_DOOR_RATE);

			this.bayDoors[door] += Math.max(-step, Math.min(step, wanted[door] - this.bayDoors[door]));
		}
	}

	// Where the tanks stand in the engine bay, in world units: against its back wall, over the reactors' column
	tankSpot() {
		const { engineering } = this.layout;
		const reactor = this.engines[0]?.reactor ?? { x: engineering.x + 1.5 };

		return { x: reactor.x, y: engineering.y + (engineering.face ?? FACE) + 0.35 };
	}

	// The `index`th tank's foot, in art pixels: each on the rack over the last
	tankAt(index) {
		const at = this.art(this.tankSpot());

		return { x: at.x, y: at.y - index * TANK_RACK };
	}

	// The tanks as they read now, each that reads fuller than it did (a limit's window rolled over) sent a refuel ship
	// to fill it from where it was; none on first sight
	refuelled(tanks) {
		const keyOf = tank => tank.account ?? 'unknown';

		tanks.forEach((tank, index) => {
			const was = this.lastTanks?.get(keyOf(tank));

			if (was?.level != null && tank.level != null && tank.level > was.level + REFUELLED)
				this.refuels.push({ key: keyOf(tank), index, from: was, time: 0 });
		});
		this.lastTanks = new Map(tanks.map(tank => [keyOf(tank), { level: tank.level, gauges: tank.gauges }]));

		return tanks;
	}

	// A tank as its gauge shows it: while a refuel ship fills it, rising from where it was to where it is as it pumps
	tankShown(tank) {
		const refuel = this.refuels.find(({ key }) => key === (tank.account ?? 'unknown'));

		if (!refuel) return tank;

		const pumped = Math.max(0, Math.min(1, (refuel.time - 0.3) / 0.45));
		const toward = (from, to) => (from ?? to) + (to - (from ?? to)) * pumped;

		return {
			...tank,
			level: toward(refuel.from.level, tank.level),
			gauges: tank.gauges && {
				session: toward(refuel.from.gauges?.session, tank.gauges.session),
				week: toward(refuel.from.gauges?.week, tank.gauges.week),
			},
			flow: Math.max(tank.flow, pumped > 0 && pumped < 1 ? 1 : 0),
		};
	}

	// A refuel ship on its visit, settled on the hull over the tank it fills, forward of the stern's fin
	drawRefuel(ctx, { index, time }) {
		if (!this.layout.building) return;

		const { top } = hullEdges(this.layout.building);

		drawTanker(ctx, { x: this.tankAt(index).x + REFUEL_FORWARD, y: top }, time, {
			color: TANK_COLORS[index % TANK_COLORS.length],
			time: this.time,
		});
	}

	// A push: the pod lifted off its cradle, its clamps blinking, then dropped out through the hatch in the belly and
	// falling away aft, its thruster firing as it goes and its trail behind it; the tug seeing it off
	drawHauler(ctx, hauler) {
		if (!this.layout.hold) return;

		const { crates, time, project } = hauler;
		const hue = this.bays.find(({ name }) => name === project)?.hue;
		const flight = this.podFlight(hauler, time);
		const at = this.art(flight);

		if (time < HAUL_LIFT && Math.floor(this.time * 10) % 2)
			for (const side of [-14, 19]) rect(ctx, at.x + side - 1, at.y - 12, 2, 2, PALETTE.y);
		if (flight.falling > 0) {
			// Its trail: where it was a moment ago, fading the further back
			for (let back = 1; back <= 6; back++) {
				const was = this.podFlight(hauler, Math.max(HAUL_LIFT, time - back * 0.012));
				const dot = this.art(was);

				ctx.globalAlpha = 0.4 * (1 - back / 7) * (1 - flight.falling);
				rect(ctx, dot.x + 1, dot.y - 22 * was.scale, Math.max(1, Math.round(4 * was.scale)), 3, '#9fd8ff');
			}
			ctx.globalAlpha = 1;
		}
		this.scaledAbout(ctx, at, flight.scale, () => {
			if (flight.falling > 0) {
				// Its thruster, atop it, pushing it down and away
				const flame = 3 + (Math.floor(this.time * 20) % 3);

				rect(ctx, at.x - 1, at.y - 20 - flame, 4, flame, PALETTE.Y);
				rect(ctx, at.x, at.y - 20 - flame + 1, 2, flame - 1, PALETTE.W);
			}
			this.drawPod(ctx, at, { hue, crates, sheets: 0, docked: false });
		});
	}

	// The tug off its pad seeing the first push out, as `tugFlight` puts it
	drawTugFlight(ctx) {
		const tug = this.haulers[0] && this.tugFlight(this.haulers[0]);

		if (!tug) return;

		const at = this.art(tug);

		this.scaledAbout(ctx, at, tug.scale, () => drawTug(ctx, at, this.time, { flying: true, aft: tug.aft }));
	}

	// Where a pod's `index`th crate of commits sits in its window, `at` the pod's foot, in art pixels: two rows of three
	crateAt(at, index) {
		return { x: at.x + 1 + (index % 3) * 5, y: at.y - 12 - Math.floor(index / 3) * 5 };
	}

	// A checkout's pod, `at` its foot: a cargo capsule in its project's color, a rounded nose and an engine bell, ribs down
	// its hull and a window in its side showing its changes as sheets and its commits stacked as crates; a lamp on top
	// blinking amber while changes are loading, steady green with commits to push, dark when empty. Docked, it stands on
	// a cradle.
	drawPod(ctx, at, { hue, crates, sheets, docked = true }) {
		const tint = (s, l) => (hue === null || hue === undefined ? `hsl(220 10% ${l}%)` : `hsl(${hue} ${s}% ${l}%)`);
		const [color, light, dark] = [tint(45, 46), tint(55, 66), tint(40, 27)];
		const { x, y } = at;
		const [top, bottom] = [y - 22, y - 4];

		if (docked) {
			rect(ctx, x - 10, y - 3, 27, 3, PALETTE.k);
			rect(ctx, x - 9, y - 2, 25, 1, PALETTE.m);
			for (const strut of [x - 7, x + 12]) rect(ctx, strut, y - 5, 2, 3, PALETTE.k);
		}
		// Its hull: outlined, the nose rounded off, the bell narrower, lit along its top and shaded along its keel
		rect(ctx, x - 11, top, 28, bottom - top + 1, PALETTE.k);
		rect(ctx, x - 12, top + 2, 1, bottom - top - 3, PALETTE.k);
		rect(ctx, x + 17, top + 3, 2, bottom - top - 5, PALETTE.k);
		rect(ctx, x - 10, top + 1, 26, bottom - top - 1, color);
		rect(ctx, x - 11, top + 3, 1, bottom - top - 5, color);
		rect(ctx, x + 17, top + 4, 1, bottom - top - 7, dark);
		rect(ctx, x - 10, top + 1, 26, 1, light);
		rect(ctx, x - 10, bottom - 1, 26, 1, dark);
		for (let rib = x - 5; rib < x + 16; rib += 7) rect(ctx, rib, top + 1, 1, bottom - top - 1, dark);
		// Its window, the sheets of changes to its left and the crates of commits stacked beside them
		rect(ctx, x - 8, top + 4, 25, 12, PALETTE.k);
		rect(ctx, x - 7, top + 5, 23, 10, '#0d1118');
		for (let sheet = 0; sheet < Math.min(4, sheets); sheet++) rect(ctx, x - 6, top + 13 - sheet * 2, 5, 1, PALETTE.W);
		for (let crate = 0; crate < Math.min(MOST.crates, crates); crate++) {
			const box = this.crateAt(at, crate);

			rect(ctx, box.x, box.y, 4, 4, '#a8702e');
			rect(ctx, box.x, box.y, 4, 1, '#f2c66d');
			rect(ctx, box.x + 1, box.y + 2, 2, 1, '#6e4a1e');
		}
		// Its lamp
		const loading = sheets > 0;
		const lamp =
			(loading && (Math.floor(this.time * 3) % 2 ? '#f2c14e' : '#5a4416')) || (crates > 0 && '#5cff8a') || '#2a3040';

		rect(ctx, x + 2, top - 2, 4, 2, PALETTE.k);
		rect(ctx, x + 3, top - 2, 2, 1, lamp);
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
	// Where each other ship's unmanned terminal stands, along the bridge's near wall from its forward end aft, in the
	// places free of the lounge and of islands standing near the wall: [{ ship, x, y }]
	fleetSpots() {
		const { bridge, lounge } = this;

		if (!bridge || !this.fleet?.length) return [];

		const y = bridge.y + bridge.d - FLEET_FROM_WALL;
		const half = FLEET_PITCH / 2;
		const blocked = [
			...(lounge?.count ? [{ from: lounge.x - 0.3, to: lounge.x + lounge.w + 0.3 }] : []),
			// The materializer and transporter standing on the bridge
			...[this.layout.materializer, this.layout.transporter]
				.filter(room => room?.within)
				.map(room => ({ from: room.x - 0.3, to: room.x + room.w + 0.3 })),
			...(bridge.islands ?? [])
				.filter(island => island.y > y - FLEET_TALL)
				.map(island => ({ from: island.x - 0.3, to: island.x + island.w + 0.3 })),
		];
		const free = x => blocked.every(({ from, to }) => x + half <= from || x - half >= to);
		const spots = [];

		const pad = this.layout.transporter?.within && this.layout.transporter;

		// Butted up to the transporter's forward side, one after another toward the bow, where it stands on the bridge
		if (pad)
			for (
				let x = pad.x + pad.w + half;
				spots.length < this.fleet.length && x + half <= bridge.x + bridge.w;
				x += FLEET_PITCH
			)
				spots.push({ x, y });
		else
			for (
				let x = bridge.x + bridge.w - FLEET_NOSE;
				spots.length < this.fleet.length && x - half > bridge.x + 0.6;
				x -= 0.25
			)
				if (free(x) && (!spots.length || spots.at(-1).x - x >= FLEET_PITCH)) spots.push({ x, y });

		return spots.map((spot, index) => ({ ...spot, ship: this.fleet[index] }));
	}

	// Each other ship kept an eye on from the bridge: an unmanned terminal of its own, its screen saying what's on it as
	// a grey's does (a question while one of its sessions asks, news, work, or at rest), how many need you beside it, and
	// its name under it once close enough to read
	fleetParts(ctx) {
		return this.fleetSpots().map(({ ship, x, y }) => {
			const at = this.art({ x, y });
			const screen = (ship.needs && { kind: 'ask', hue: 45 }) ||
				(ship.news && { kind: 'news', hue: 210 }) ||
				(ship.working && { kind: 'work', hue: 170 }) || { kind: 'idle', hue: 210 };
			const count = ship.needs || ship.news;

			this.hits.push({ ...this.toScreen({ x: at.x - 7, y: at.y - 21 }), r: 9 * this.camera.zoom, kind: 'fleet', ship });

			return {
				y,
				draw: () => {
					// A small desk of its own under its screen
					rect(ctx, at.x - 18, at.y - 11, 33, 12, PALETTE.k);
					rect(ctx, at.x - 17, at.y - 10, 31, 10, PALETTE.m);
					rect(ctx, at.x - 17, at.y - 10, 31, 1, PALETTE.l);
					rect(ctx, at.x - 17, at.y - 2, 31, 2, PALETTE.d);
					drawSeat(ctx, at, { screen, engineColor: PALETTE.p, time: this.time, seed: seeded(ship.key) });
					if (count)
						this.labels.push({
							text: String(count),
							at: { x: at.x + 6, y: at.y - 25 },
							color: ship.needs ? PALETTE.y : PALETTE.b,
							size: 1,
							align: 'left',
						});
					if (this.camera.zoom >= 3)
						this.labels.push({
							text: ship.name,
							at: { x: at.x - 4, y: at.y + 4 },
							color: 'hsl(265 50% 78%)',
							align: 'center',
							size: 1,
							width: FLEET_PITCH * UNIT.x,
						});
				},
			};
		});
	}

	// The tube's runs in art pixels, worked out once a layout: a pipe in the ceiling over each row of islands, from its
	// far end to the aft wall; the trunk down that wall; the rail along the near wall to over the hold; the drop into it
	tubeNet() {
		const { tube } = this.layout;

		if (!tube || !this.bridge) return null;
		if (this.tubeNetOf?.layout === this.layout) return this.tubeNetOf;

		const trunk = this.art({ x: tube.trunk, y: 0 }).x;
		const rail = this.art({ x: 0, y: tube.rail, z: TUBE_Z }).y;
		const drop = this.art({ x: tube.drop, y: 0 }).x;
		const hopper = this.art({ x: 0, y: tube.hopper, z: TUBE_Z }).y;
		const holdTop = this.art({ x: 0, y: this.layout.hold.y }).y;
		const rows = new Map();

		for (const island of this.bridge.islands ?? []) {
			const y = this.art({ x: 0, y: island.y + 0.2 }).y - CEILING;
			const end = this.art({ x: island.x + island.w, y: 0 }).x - 4;

			rows.set(island.y, { y, end: Math.max(end, rows.get(island.y)?.end ?? trunk) });
		}

		this.tubeNetOf = { layout: this.layout, rows, trunk, rail, drop, hopper, holdTop };

		return this.tubeNetOf;
	}

	// The way a part takes from the ceiling over a seat to the hopper, in art pixels; null where there's no tube over it
	pipeFrom(seat) {
		const net = this.tubeNet();
		const row = seat?.island && net?.rows.get(seat.island.y);

		if (!row) return null;

		const over = this.art({ x: seat.x + 0.55, y: 0 }).x;

		return [
			...this.clearOfLounge([
				{ x: over, y: row.y },
				{ x: net.trunk, y: row.y },
			]),
			{ x: net.trunk, y: net.rail },
			{ x: net.drop, y: net.rail },
			{ x: net.drop, y: net.hopper },
		];
	}

	// A part in the tube: a nozzle drops from the ceiling to its desk and draws it up, then it shoots along the pipe;
	// out at the hopper, it falls onto its stack
	tendTube(parcel, seconds) {
		const { tube } = parcel;

		tube.age = (tube.age ?? 0) + seconds;
		if (tube.age < POP_SECONDS) return;

		const length = pathLength(tube.pipe);

		tube.along = Math.min(length, tube.along + TUBE_PX * seconds);
		if (tube.along >= length) parcel.tube = null;
	}

	// The tube runs inside the ceiling and the walls, out of sight: only where it comes out over the hold's stacks shows,
	// down from the hold's ceiling to its hopper
	tubeParts(ctx) {
		const net = this.tubeNet();

		if (!net) return [];

		return [
			{
				y: TUBE_FRONT - 0.001,
				draw: () => {
					this.drawPipe(ctx, [
						{ x: net.drop, y: net.holdTop },
						{ x: net.drop, y: net.hopper },
					]);

					const { drop: x, hopper: y } = net;

					rect(ctx, x - 4, y, 9, 4, PALETTE.k);
					rect(ctx, x - 3, y, 7, 3, PALETTE.l);
					rect(ctx, x - 2, y + 3, 5, 1, PALETTE.m);
				},
			},
		];
	}

	drawPipe(ctx, points) {
		for (const [index, from] of points.slice(0, -1).entries()) {
			const to = points[index + 1];
			const [x, y] = [Math.min(from.x, to.x), Math.min(from.y, to.y)];
			const [w, h] = [Math.abs(to.x - from.x), Math.abs(to.y - from.y)];
			const across = w >= h;

			rect(ctx, x - (across ? 0 : 2), y - (across ? 2 : 0), w + (across ? 1 : 5), h + (across ? 5 : 1), PALETTE.k);
			rect(
				ctx,
				x - (across ? 0 : 1),
				y - (across ? 1 : 0),
				w + (across ? 1 : 3),
				h + (across ? 3 : 1),
				TUBE_GLASS.body,
			);
			if (across) rect(ctx, x, y - 1, w + 1, 1, TUBE_GLASS.shine);
			else rect(ctx, x - 1, y, 1, h + 1, TUBE_GLASS.shine);
			for (let along = 6; along < Math.max(w, h); along += 14)
				if (across) rect(ctx, x + along, y - 2, 2, 5, PALETTE.m);
				else rect(ctx, x - 2, y + along, 5, 2, PALETTE.l);
		}
	}

	// The tube's nozzle let down from the ceiling at `x` to `mouth`, its top fading into the ceiling as if it came down
	// through it
	drawNozzle(ctx, x, ceiling, mouth) {
		for (let y = ceiling; y < mouth; y++) {
			ctx.globalAlpha = Math.min(1, (y - ceiling) / FADE_IN);
			rect(ctx, x - 2, y, 5, 1, PALETTE.k);
			rect(ctx, x - 1, y, 3, 1, TUBE_GLASS.body);
			rect(ctx, x - 1, y, 1, 1, TUBE_GLASS.shine);
		}
		ctx.globalAlpha = 1;
		rect(ctx, x - 3, mouth - 1, 7, 2, PALETTE.l);
	}

	// A part being drawn up into the ceiling: the nozzle coming down over its desk, the sheet rising into it, the two
	// going back up together
	drawPop(ctx, parcel) {
		const { pipe, desk, age = 0 } = parcel.tube;
		const ceiling = pipe[0].y;
		const reach = desk.y - 14;
		const t = age / POP_SECONDS;
		const down = (t < 0.3 && t / 0.3) || (t < 0.75 && 1) || Math.max(0, 1 - (t - 0.75) / 0.25);
		const mouth = Math.round(ceiling + (reach - ceiling) * down);
		const x = pipe[0].x;

		this.drawNozzle(ctx, x, ceiling, mouth);
		if (t >= 0.3 && t < 0.75) {
			const rise = (t - 0.3) / 0.45;

			drawSprite(
				ctx,
				'paper',
				Math.round(desk.x + (x - desk.x) * rise),
				Math.round(desk.y + (mouth + 4 - desk.y) * rise),
			);
		}
	}

	drawParcel(ctx, parcel) {
		const color = `hsl(${parcel.hue ?? 200} 75% 66%)`;

		// On the crane's hook: its line down from the trolley
		if (parcel.craned && this.layout.hold) {
			const { rail } = this.gantryOf(this.layout.hold);
			const at = this.art(parcel);

			rect(ctx, Math.round(at.x), rail + 6, 1, Math.max(0, Math.round(at.y) - rail - 9), PALETTE.l);
		}

		// Drawn up from its desk, then a capsule shooting through the tube, its band in its session's color
		if (parcel.tube) {
			if ((parcel.tube.age ?? 0) < POP_SECONDS) return this.drawPop(ctx, parcel);

			const at = pointAlong(parcel.tube.pipe, parcel.tube.along);
			const net = this.tubeNet();

			// Out of sight in the walls till it comes out over the hold
			if (at.x !== net.drop || at.y < net.holdTop) return;
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

		// One with a least zoom (`least`) only once that close: too small to read further out, it would run into those by it
		for (const label of this.labels) {
			if (label.least && this.camera.zoom < label.least) continue;

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
	// The nearest thing under the point; among areas, the smallest, so a room within another (the lounge on the bridge)
	// is its own; else the last drawn
	hit(x, y) {
		const inside = ({ left, top, right, bottom }) => x >= left && x <= right && y >= top && y <= bottom;
		const size = ({ area }) => (area ? (area.right - area.left) * (area.bottom - area.top) : 0);

		return this.hits
			.map((target, order) => ({ ...target, order, distance: Math.hypot(target.x - x, target.y - y) }))
			.filter(({ distance, r, area }) => (area ? inside(area) : distance <= r))
			.sort((a, b) => (a.r ?? Infinity) - (b.r ?? Infinity) || size(a) - size(b) || b.order - a.order)[0];
	}
}
