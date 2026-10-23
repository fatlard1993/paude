import { requestMatch } from '@vanilla-bean/components/app';

import { recordChange, setStatus } from '../activity';
import { turnEnded } from '../claudeInbox';
import { fileBeforePush, followDecisions } from '../decisions';
import { projectOf } from '../projects';
import { afterTurnTasks, runTask } from '../tasks';
import { sessionTimeline } from '../timeline';
import { HOOK_EVENTS, hookSecret } from '../hookSettings';
import { claudeActive } from '../keepWarm';
import { limitHook } from '../usageLimit';
import { trackProposals } from '../sessions/proposals';
import { runningSession } from '../sessions/running';

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

// A command that runs git push, anywhere in it: filing first costs a wait at most, even when it pushes somewhere else
export const isPush = command =>
	/(?:^|[;&|(]\s*)git(?:\s+-[cC]\s+\S+|\s+--?[\w-]+(?:=\S+)?)*\s+push\b/m.test(command ?? '');

// Claude waits on this answer before its push runs: turned back once anything was filed, so it settles first
const beforePush = async (id, payload) => {
	if (!isPush(payload.tool_input?.command)) return null;
	if (!(await fileBeforePush(id, runningSession(id).cwd))) return null;

	return Response.json({
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason:
				'paude filed what this session settled into the commits not pushed yet, as amend! commits. Settle the stack (GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash onto where the branch left its upstream), then push again.',
		},
	});
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
	if (payload.hook_event_name === 'PreToolUse' && payload.tool_name === 'Bash')
		return (await beforePush(id, payload)) ?? new Response(null, { status: 204 });
	// Before the status, so the presence that goes out with it says whether a usage limit stopped the turn
	await limitHook(id, payload);
	if (status) await setStatus(id, status);
	// A keep-warm ping's turn isn't news, and edits nothing
	if (claudeActive(id, payload)) return new Response(null, { status: 204 });
	if (payload.hook_event_name === 'Stop') await recordChange(id);
	// The prompt settles the turn before it, and the turn's end lets what it settled be filed
	if (['UserPromptSubmit', 'Stop'].includes(payload.hook_event_name))
		followDecisions(id, runningSession(id).cwd).catch(error => console.error('Following decisions failed:', error));
	// Not waited for: Claude waits on its hook, and the answer can take a few seconds to reach the transcript
	if (payload.hook_event_name === 'Stop')
		runAfterTurn(id).catch(error => console.error('Running the after-turn tasks failed:', error));
	if (['Stop', 'StopFailure'].includes(payload.hook_event_name))
		turnEnded(id).catch(error => console.error('Answering from Claude failed:', error));

	return new Response(null, { status: 204 });
};

export default hooksRoutes;
