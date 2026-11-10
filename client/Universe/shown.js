// This paude's key among the engines
export const LOCAL = 'here';

// The answers grouped a ship to a subscription, this paude's ship first; one that doesn't say which Claude account it's
// on shares this paude's. An engine whose answer leaves its account out for once (`known`, kept by the caller, has each
// engine's last) stays on its ship rather than turning up on this paude's. { [ship key]: answers }
export const shipsOf = (answers, known = new Map()) => {
	const local = answers.find(({ key }) => key === LOCAL);
	const home = local?.fuel?.account ? `account:${local.fuel.account}` : `own:${LOCAL}`;
	const ships = new Map();

	for (const answer of [...answers].sort((a, b) => (a.key === LOCAL ? -1 : 0) - (b.key === LOCAL ? -1 : 0))) {
		if (answer.fuel?.account) known.set(answer.key, answer.fuel.account);

		const account = answer.fuel?.account ?? known.get(answer.key);
		const key = account ? `account:${account}` : home;

		ships.set(key, [...(ships.get(key) ?? []), answer]);
	}

	return ships;
};

// The stretch of the stage that takes in every ship shown on it, in art pixels, for the view to open on: each ship
// by its own extent ({ left, right, top, height }) and where it stands from the one aboard (`at`). null for fewer
// than two: one ship alone is framed as it always is.
export const fleetBox = placed => {
	if (placed.length < 2) return null;

	const boxes = placed.map(({ extent: { left, right, top, height }, at }) => ({
		left: left + at.x,
		right: right + at.x,
		top: top + at.y,
		bottom: top + height + at.y,
	}));

	return {
		left: Math.min(...boxes.map(box => box.left)),
		right: Math.max(...boxes.map(box => box.right)),
		top: Math.min(...boxes.map(box => box.top)),
		bottom: Math.max(...boxes.map(box => box.bottom)),
	};
};

// The space left between ships shown together, in art pixels
export const FLEET_GAP = 60;

const eased = t => t * t * (3 - 2 * t);
// A ship coming alongside is fast at first and slows to match speed; one leaving pulls away from rest
const slowing = t => 1 - (1 - t) ** 3;
const quickening = t => t ** 3;

// Where each ship on the stage stands from the one aboard, in art pixels: stacked down the screen in the order given,
// their bows in line. `ships`: [{ key, extent: { right, top, height }, aboard, shown (chosen to be shown beside), in
// (how far in it is, 0 away to 1 in place) }]; `reach` how far off the screen's edge is. One coming in comes up from
// astern, past the edge, slowing to hold its place alongside; one going pulls away ahead; each takes its room, or
// gives it back, as it goes. `settled`: where they'll stand once all that's done, those on their way out left out
// (for what the view should take in, which isn't where a ship just shown happens to be).
export const placeShips = (ships, { reach = 0, settled = false } = {}) => {
	const here = ships.filter(ship => ship.aboard || ship.shown || (!settled && ship.in > 0));
	let down = 0;
	const placed = here.map(ship => {
		const { right, top, height } = ship.extent;
		const was = ship.aboard || settled ? 1 : (ship.in ?? 1);
		const slide = ship.shown ? -(1 - slowing(was)) * reach : quickening(1 - was) * reach;
		const at = { x: -right + slide, y: down - top };

		down += (height + FLEET_GAP) * eased(was);

		return { ...ship, at };
	});
	const home = placed.find(({ aboard }) => aboard)?.at ?? { x: 0, y: 0 };

	return placed.map(placing => ({ ...placing, at: { x: placing.at.x - home.x, y: placing.at.y - home.y } }));
};
