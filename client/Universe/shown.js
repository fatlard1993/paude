// Which engines and projects the universe leaves off the ship, a choice kept for this browser

// The engines and projects hidden from the ship, kept for this browser: { machines: [world key], projects: [name] }
const HIDDEN = 'paude-universe-hidden';

export const hiddenNow = () => {
	try {
		const kept = JSON.parse(localStorage.getItem(HIDDEN) ?? '{}');

		return { machines: kept.machines ?? [], projects: kept.projects ?? [] };
	} catch {
		return { machines: [], projects: [] };
	}
};

export const toggleHidden = (kind, key) => {
	const hidden = hiddenNow();
	const list = hidden[kind];

	hidden[kind] = list.includes(key) ? list.filter(other => other !== key) : [...list, key];
	try {
		localStorage.setItem(HIDDEN, JSON.stringify(hidden));
	} catch {
		// Hidden for this visit only
	}
};

// The looks with what's hidden left out: a hidden engine's paude altogether, its reactor and its sessions, and a
// hidden project's machine and sessions on every engine
export const shownOf = (worlds, { machines, projects }) =>
	worlds
		.filter(({ key }) => !machines.includes(key))
		.map(world => ({
			...world,
			projects: world.projects?.filter(({ name }) => !projects.includes(name)),
			sessions: world.sessions?.filter(({ project }) => !projects.includes(project)),
		}));

// Which subscription each paude that doesn't say which Claude account it's on shares, set by hand: { [world key]: the
// world key it shares one with, or 'own' for one of its own }; one not in it is taken to share this machine's
const SHIPS = 'paude-universe-ships';

export const shipsAssigned = () => {
	try {
		return JSON.parse(localStorage.getItem(SHIPS) ?? '{}');
	} catch {
		return {};
	}
};

export const assignShip = (key, sharing) => {
	const assigned = shipsAssigned();

	if (sharing && sharing !== key && sharing !== 'here') assigned[key] = sharing;
	else delete assigned[key];
	try {
		localStorage.setItem(SHIPS, JSON.stringify(assigned));
	} catch {
		// For this visit only
	}
};

// The looks grouped a ship to a subscription: those logged into one Claude account together; one that doesn't say
// which taken to share this machine's, or as set by hand (`assigned`), its own or another's; this machine's ship
// first (one of its own for each such machine made the ships one to a machine). Whose subscription is shared is
// found among `everyone`, the hidden looks too, so hiding a machine doesn't move those sharing its subscription off
// their ship; machines set to share each other's, round in a ring, share one. { [ship key]: worlds }
export const shipsOf = (worlds, assigned = {}, everyone = worlds) => {
	const byKey = new Map(everyone.map(world => [world.key, world]));
	const sharingOf = world => {
		const sharing = assigned[world.key] ?? 'here';
		const other = sharing === 'own' ? null : byKey.get(sharing);

		return other?.key === world.key ? null : other;
	};
	const shipOf = (world, seen = []) => {
		if (world.fuel?.account) return `account:${world.fuel.account}`;

		const other = sharingOf(world);

		if (!other) return `own:${world.key}`;
		if (!seen.includes(other.key)) return shipOf(other, [...seen, world.key]);

		// Round a ring: the ring's ship, named the same from wherever in it
		const ring = [...seen.slice(seen.indexOf(other.key)), world.key];

		return `own:${ring.sort()[0]}`;
	};
	const ships = new Map();

	for (const world of [...worlds].sort((a, b) => (a.key === 'here' ? -1 : 0) - (b.key === 'here' ? -1 : 0))) {
		const key = shipOf(world);

		ships.set(key, [...(ships.get(key) ?? []), world]);
	}

	return ships;
};
