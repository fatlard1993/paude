import { recordChange, setStatus } from '../activity';
import { HOOK_EVENTS, hookSecret } from '../hookSettings';
import { runningSession } from '../sessions/running';
import requestMatch from '../utils/requestMatch';

// Where the hooks in hookSettings report; authenticated by the secret in the address rather than a login
const hooksRoutes = async request => {
	const match = requestMatch('POST', '/api/hooks/:secret', request);

	if (!match) return null;
	if (match.secret !== hookSecret) return new Response('Not Found', { status: 404 });

	const payload = await request.json();
	const id = payload?.session_id;
	const status = HOOK_EVENTS[payload?.hook_event_name]?.(payload);

	if (typeof id !== 'string' || !runningSession(id)) return new Response(null, { status: 204 });
	if (status) await setStatus(id, status);
	if (payload.hook_event_name === 'Stop') await recordChange(id);

	return new Response(null, { status: 204 });
};

export default hooksRoutes;
