import sessionSocket from '../../shared/sessionSocket';

const WAKE_EVENTS = ['online', 'pageshow', 'focus'];

// This page's session socket, on the page's own server with its login cookie. A phone puts a page to sleep with its
// socket and its timers; coming back into view, the socket is checked at once and replaced if it died meanwhile.
const attach = (sessionId, options) => {
	const connection = sessionSocket({ url: window.location.origin, sessionId, ...options });
	const wake = () => document.visibilityState === 'visible' && connection.wake();

	document.addEventListener('visibilitychange', wake);
	for (const event of WAKE_EVENTS) window.addEventListener(event, wake);

	return {
		...connection,
		close() {
			document.removeEventListener('visibilitychange', wake);
			for (const event of WAKE_EVENTS) window.removeEventListener(event, wake);
			connection.close();
		},
	};
};

export default attach;
