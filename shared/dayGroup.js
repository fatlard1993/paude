const DAY_MS = 24 * 60 * 60 * 1000;

export const DAY_GROUPS = ['Today', 'Yesterday', 'Past week', 'Past month', 'Older'];

// Which stretch of days a time falls in, counted in whole local days back from `now`
const dayGroup = (time, now = Date.now()) => {
	const midnight = new Date(now).setHours(0, 0, 0, 0);

	if (time >= midnight) return 'Today';
	if (time >= midnight - DAY_MS) return 'Yesterday';
	if (time >= midnight - 6 * DAY_MS) return 'Past week';
	if (time >= midnight - 29 * DAY_MS) return 'Past month';

	return 'Older';
};

// When, said the way its group needs: the time of day for today and yesterday, the weekday too for the past week, and
// the date for anything older
export const whenIn = (group, time) => {
	const at = new Date(time);
	const clock = at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

	if (group === 'Today' || group === 'Yesterday') return clock;
	if (group === 'Past week') return `${at.toLocaleDateString([], { weekday: 'short' })} ${clock}`;

	return at.toLocaleDateString([], {
		month: 'short',
		day: 'numeric',
		...(at.getFullYear() !== new Date().getFullYear() && { year: 'numeric' }),
	});
};

export default dayGroup;
