// A paude too old to have a universe still lists its sessions and projects for this one, so they come aboard from that:
// those running, and those watched with news; who and what, without the screens, tools or fuel a universe would add
const olderPaude = ({ sessions = [], watching = [], projects = [] }) => {
	const listed = new Map([...watching, ...sessions].map(session => [session.id, session]));
	const aboard = [...listed.values()].filter(
		({ live, status, watching: watched, unseen }) => live || status !== 'stopped' || (watched && unseen > 0),
	);

	return {
		older: true,
		projects: projects.map(({ name, hue, watching: watched }) => ({ name, hue, watching: Boolean(watched) })),
		sessions: aboard.map(({ id, title, project, hue, status, busy, unseen = 0, gitBranch }) => ({
			id,
			title,
			project,
			hue,
			status: busy && status === 'ready' ? 'working' : status,
			tool: null,
			unseen,
			reply: null,
			branch: gitBranch,
		})),
		checkouts: [],
		tools: [],
	};
};

export default olderPaude;
