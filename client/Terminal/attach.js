import sessionSocket from '../../shared/sessionSocket';

// This page's session socket, on the page's own server with its login cookie
const attach = (sessionId, options) => sessionSocket({ url: window.location.origin, sessionId, ...options });

export default attach;
