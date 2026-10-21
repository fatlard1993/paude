// What needs a person most: a question first, then the most unseen, then the most recently active (as paude saw it,
// or as its transcript was last written for one paude never ran)
const activeAt = session => session.activeAt ?? session.lastModified ?? 0;

const byUrgency = (a, b) =>
	(b.status === 'waiting') - (a.status === 'waiting') || b.unseen - a.unseen || activeAt(b) - activeAt(a);

export default byUrgency;
