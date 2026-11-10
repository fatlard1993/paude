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
