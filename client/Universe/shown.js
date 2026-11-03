// This paude's key among the engines
export const LOCAL = 'here';

// { engines: [engine key], projects: [name] }, read from the older { machines } too
const HIDDEN = 'paude-universe-hidden';

export const hiddenNow = () => {
	try {
		const stored = JSON.parse(localStorage.getItem(HIDDEN) ?? '{}');

		return { engines: stored.engines ?? stored.machines ?? [], projects: stored.projects ?? [] };
	} catch {
		return { engines: [], projects: [] };
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

// A hidden engine leaves out its whole answer; a hidden project leaves out its sessions on every engine
export const shownOf = (answers, { engines, projects }) =>
	answers
		.filter(({ key }) => !engines.includes(key))
		.map(answer => ({
			...answer,
			projects: answer.projects?.filter(({ name }) => !projects.includes(name)),
			sessions: answer.sessions?.filter(({ project }) => !projects.includes(project)),
		}));

// For engines that don't say which Claude account they're on: { [engine key]: the engine key it shares a subscription
// with, or 'own' }; one not in it shares this paude's
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

	if (sharing && sharing !== key && sharing !== LOCAL) assigned[key] = sharing;
	else delete assigned[key];
	try {
		localStorage.setItem(SHIPS, JSON.stringify(assigned));
	} catch {
		// For this visit only
	}
};

// The answers grouped a ship to a subscription, this paude's ship first. Whose subscription is shared is looked up
// among `everyone`, hidden engines included, so hiding one doesn't move those sharing its subscription off their ship;
// engines set to share each other's round in a ring share one. { [ship key]: answers }
export const shipsOf = (answers, assigned = {}, everyone = answers) => {
	const byKey = new Map(everyone.map(answer => [answer.key, answer]));
	const sharingOf = answer => {
		const sharing = assigned[answer.key] ?? LOCAL;
		const other = sharing === 'own' ? null : byKey.get(sharing);

		return other?.key === answer.key ? null : other;
	};
	const shipOf = (answer, seen = []) => {
		if (answer.fuel?.account) return `account:${answer.fuel.account}`;

		const other = sharingOf(answer);

		if (!other) return `own:${answer.key}`;
		if (!seen.includes(other.key)) return shipOf(other, [...seen, answer.key]);

		// The ring's ship, named the same from wherever in it
		const ring = [...seen.slice(seen.indexOf(other.key)), answer.key];

		return `own:${ring.sort()[0]}`;
	};
	const ships = new Map();

	for (const answer of [...answers].sort((a, b) => (a.key === LOCAL ? -1 : 0) - (b.key === LOCAL ? -1 : 0))) {
		const key = shipOf(answer);

		ships.set(key, [...(ships.get(key) ?? []), answer]);
	}

	return ships;
};
