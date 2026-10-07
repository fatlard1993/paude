// The watched sessions that need someone, here and on other servers, as the watch alerts last found them
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
