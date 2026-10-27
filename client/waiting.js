// The watched sessions, here and on other servers, as the watch alerts last found them; of them, those that need
// someone (asking, or with news since they looked), most urgent first
let waiting = [];
let watched = [];
const listeners = new Set();

export const setWaitingSessions = (sessions, all) => {
	waiting = sessions;
	watched = all;
	for (const listener of listeners) listener(waiting);
};

export const watchedSessions = () => watched;

// Called now and on every change; returns the way to stop
export const onWaitingChange = listener => {
	listeners.add(listener);
	listener(waiting);

	return () => listeners.delete(listener);
};
