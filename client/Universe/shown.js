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
