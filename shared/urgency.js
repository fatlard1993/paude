// What needs a person most: a question first, then the most unseen, then the most recently active
const byUrgency = (a, b) =>
	(b.status === 'waiting') - (a.status === 'waiting') || b.unseen - a.unseen || (b.activeAt ?? 0) - (a.activeAt ?? 0);

export default byUrgency;
