// The watched sessions that need someone (asking, or with news since they looked), here and on other servers, most
// urgent first, as the watch alerts last found them
let waiting = [];
const listeners = new Set();

export const setWaitingSessions = sessions => {
	waiting = sessions;
	for (const listener of listeners) listener(waiting);
};

// Called now and on every change; returns the way to stop
export const onWaitingChange = listener => {
	listeners.add(listener);
	listener(waiting);

	return () => listeners.delete(listener);
};
