// Who is in an arcade session, told to Claude when it changes: the people attached to it now, by the names they go by,
// so whoever made the game, whoever joined on a phone, and whoever left are known without anyone being asked. Said
// again after a compaction, since the summary may drop it.
const told = new Map();

const listed = names => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`);

// What to tell Claude about who is here, or null when it already knows. `people`: [{ name, role }].
export const presenceNote = (id, people) => {
	const names = [...new Set(people.map(person => person.name).filter(Boolean))].sort();
	const key = names.join('\n');

	if (told.get(id) === key) return null;
	told.set(id, key);

	return names.length
		? `paude: here in the arcade now: ${listed(names)}. Build with them, by name where it fits.`
		: 'paude: nobody has the arcade open right now.';
};

export const forgetPresence = id => told.delete(id);
