import { recordChange, setStatus } from '../activity';
import { turnEnded } from '../claudeInbox';
import { HOOK_EVENTS, hookSecret } from '../hookSettings';
import { trackProposals } from '../sessions/proposals';
import { runningSession } from '../sessions/running';
import requestMatch from '../utils/requestMatch';

// Where the hooks in hookSettings report; authenticated by the secret in the address rather than a login
const hooksRoutes = async request => {
	const match =
		requestMatch('POST', '/api/hooks/:secret/:session', request) || requestMatch('POST', '/api/hooks/:secret', request);

	if (!match) return null;
	if (match.secret !== hookSecret) return new Response('Not Found', { status: 404 });

	const payload = await request.json();
	const id = match.session ?? payload?.session_id;
	const status = HOOK_EVENTS[payload?.hook_event_name]?.(payload);

	if (typeof id !== 'string' || !runningSession(id)) return new Response(null, { status: 204 });
	trackProposals(id, payload);
	if (status) await setStatus(id, status);
	if (payload.hook_event_name === 'Stop') await recordChange(id);
	// Not waited for: Claude waits on its hook, and the answer can take a few seconds to reach the transcript
	if (['Stop', 'StopFailure'].includes(payload.hook_event_name))
		turnEnded(id).catch(error => console.error('Answering from Claude failed:', error));

	return new Response(null, { status: 204 });
};

export default hooksRoutes;
