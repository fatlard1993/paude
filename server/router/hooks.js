import { recordChange, setStatus } from '../activity';
import { turnEnded } from '../claudeInbox';
import { projectOf } from '../projects';
import { afterTurnTasks, runTask } from '../tasks';
import { sessionTimeline } from '../timeline';
import { HOOK_EVENTS, hookSecret } from '../hookSettings';
import { claudeActive } from '../keepWarm';
import { trackProposals } from '../sessions/proposals';
import { runningSession } from '../sessions/running';
import requestMatch from '../utils/requestMatch';

// The checks a project runs after each of Claude's turns, when the turn edited something: the problems they find
// are then about what Claude just did
const runAfterTurn = async id => {
	const session = runningSession(id);
	const tasks = session && afterTurnTasks(projectOf(session.cwd));

	if (!tasks?.length) return;

	const [latest] = (await sessionTimeline(id, session.cwd)).turns;

	if (!latest?.steps.some(step => step.edits)) return;
	for (const task of tasks) await runTask(id, session.cwd, task).catch(() => null);
};

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
	// A keep-warm ping's turn isn't news, and edits nothing
	if (claudeActive(id, payload)) return new Response(null, { status: 204 });
	if (payload.hook_event_name === 'Stop') await recordChange(id);
	// Not waited for: Claude waits on its hook, and the answer can take a few seconds to reach the transcript
	if (payload.hook_event_name === 'Stop')
		runAfterTurn(id).catch(error => console.error('Running the after-turn tasks failed:', error));
	if (['Stop', 'StopFailure'].includes(payload.hook_event_name))
		turnEnded(id).catch(error => console.error('Answering from Claude failed:', error));

	return new Response(null, { status: 204 });
};

export default hooksRoutes;
