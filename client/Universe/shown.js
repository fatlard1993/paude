// This paude's key among the engines
export const LOCAL = 'here';

// The answers grouped a ship to a subscription, this paude's ship first; one that doesn't say which Claude account it's
// on shares this paude's. { [ship key]: answers }
export const shipsOf = answers => {
	const local = answers.find(({ key }) => key === LOCAL);
	const home = local?.fuel?.account ? `account:${local.fuel.account}` : `own:${LOCAL}`;
	const ships = new Map();

	for (const answer of [...answers].sort((a, b) => (a.key === LOCAL ? -1 : 0) - (b.key === LOCAL ? -1 : 0))) {
		const key = answer.fuel?.account ? `account:${answer.fuel.account}` : home;

		ships.set(key, [...(ships.get(key) ?? []), answer]);
	}

	return ships;
};
