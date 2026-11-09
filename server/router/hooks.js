import path from 'path';

import { requestMatch } from '@vanilla-bean/components/app';

import { recordChange, setStatus } from '../activity';
import { turnEnded } from '../claudeInbox';
import { fileBeforePush, followDecisions, pushEnded, pushStarted } from '../decisions';
import { projectOf } from '../projects';
import { afterTurnTasks, runTask } from '../tasks';
import { sessionTimeline, sessionTurns } from '../timeline';
import { turnEnded as noteTurnCommits, turnStarted } from '../turnCommits';
import { HANDOVER_WAIT_SECONDS, HOOK_EVENTS, hookSecret } from '../hookSettings';
import { claudeActive } from '../keepWarm';
import { commandEnded, commandStarting, commandsSettled, noteChanged } from '../commandEdits';
import { beginHandover, summaryNotes, takeHandover } from '../compaction';
import { keepGoing } from '../keepGoing';
import { lookBack } from '../lookBack';
import { limitHook } from '../usageLimit';
import { noteEmpty } from '../fuel';
import { PROPOSING_TOOLS, trackProposals } from '../sessions/proposals';
import { runningSession } from '../sessions/running';
import { noteHook, notePrompt, noteTool, noteTurnDone } from '../universe';
import { isArcade, snapshotTurn } from '../arcade';

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
	if (!(await fileBeforePush(id, runningSession(id).cwd))) {
		pushStarted(id, payload.tool_use_id);

		return null;
	}

	return Response.json({
		hookSpecificOutput: {
			hookEventName: 'PreToolUse',
			permissionDecision: 'deny',
			permissionDecisionReason:
				'paude filed what this session settled into the commits not pushed yet. Settle the stack so its amend! commits fold in (GIT_SEQUENCE_EDITOR=true git rebase -i --autosquash onto where the branch left its upstream), then push again.',
		},
	});
};

// Claude carrying on from a compaction reads the monitor's handover, if one was written in time, beside the summary
const afterCompact = async (id, { source }) => {
	const handover = source === 'compact' ? await takeHandover(id, HANDOVER_WAIT_SECONDS * 1000) : '';

	if (!handover) return new Response(null, { status: 204 });

	return Response.json({
		hookSpecificOutput: {
			hookEventName: 'SessionStart',
			additionalContext: `A handover from paude's monitor of this session, which has followed the whole run and read the repository (not the person's words): weigh it against the summary and the checkout.\n\n${handover}`,
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
	if (['PostToolUse', 'PostToolUseFailure', 'PermissionDenied'].includes(payload.hook_event_name))
		pushEnded(id, payload.tool_use_id);
	if (['Stop', 'StopFailure'].includes(payload.hook_event_name)) pushEnded(id);
	// Before the push check, which may wait minutes: the checkout as the command finds it
	if (payload.hook_event_name === 'PreToolUse' && payload.tool_name === 'Bash') {
		await commandStarting(id, payload.tool_use_id, runningSession(id).cwd).catch(() => {});

		return (await beforePush(id, payload)) ?? new Response(null, { status: 204 });
	}
	// Compacting: the summary is told what the session settled, and a fabled session's monitor begins the handover
	// Claude is given as it carries on
	if (payload.hook_event_name === 'PreCompact') {
		await beginHandover(id, payload).catch(error => console.error('Beginning a handover failed:', error));

		const notes = await summaryNotes(id).catch(() => '');

		return notes ? new Response(notes) : new Response(null, { status: 204 });
	}
	if (payload.hook_event_name === 'SessionStart') return afterCompact(id, payload);
	// An arcade's turn ends at the question Claude asks, since every turn there ends with one and Claude Code's Stop
	// never comes while a question waits: the turn's changes are kept as its snapshot, and the change recorded
	if (payload.hook_event_name === 'PreToolUse' && payload.tool_name === 'AskUserQuestion') {
		const { cwd } = runningSession(id);

		if (await isArcade(cwd)) {
			await snapshotTurn(id, cwd).catch(error => console.error('The arcade snapshot failed:', error));
			await recordChange(id);
		}

		return new Response(null, { status: 204 });
	}
	// What the command changed, before anything reads the turn: a command editing files is an edit
	const edited =
		['PostToolUse', 'PostToolUseFailure'].includes(payload.hook_event_name) && payload.tool_name === 'Bash'
			? await commandEnded(id, payload.tool_use_id).catch(() => [])
			: [];

	if (['Stop', 'StopFailure'].includes(payload.hook_event_name)) commandsSettled(id);
	// So a command another session runs meanwhile in the same checkout doesn't take this edit for its own
	if (payload.hook_event_name === 'PostToolUse' && [...PROPOSING_TOOLS, 'NotebookEdit'].includes(payload.tool_name)) {
		const file = payload.tool_input?.file_path ?? payload.tool_input?.notebook_path;

		if (typeof file === 'string') noteChanged(id, [path.resolve(runningSession(id).cwd, file)]);
	}
	// Before the status, so the presence that goes out with it says whether a usage limit stopped the turn
	await limitHook(id, payload);
	if (payload.hook_event_name === 'StopFailure' && payload.error === 'rate_limit') await noteEmpty();
	if (status) await setStatus(id, status);
	// A keep-warm ping's turn isn't news, and edits nothing
	if (claudeActive(id, payload)) return new Response(null, { status: 204 });
	noteHook(runningSession(id), payload);
	if (['PostToolUse', 'PostToolUseFailure'].includes(payload.hook_event_name)) {
		await noteTool(
			runningSession(id),
			payload.tool_name,
			payload.hook_event_name === 'PostToolUseFailure',
			payload.tool_input,
		);
		// The ship's fabricator is where edits are made, whichever tool made them
		if (edited.length) await noteTool(runningSession(id), 'Edit', false, { file_path: edited[0] });
	}
	if (payload.hook_event_name === 'UserPromptSubmit') notePrompt(runningSession(id), payload.prompt);
	if (payload.hook_event_name === 'Stop') {
		noteTurnDone(runningSession(id), payload.last_assistant_message);
		await recordChange(id);
	}

	const { cwd } = runningSession(id);

	// Where each turn starts, so its end can note the commits it made with it
	if (payload.hook_event_name === 'UserPromptSubmit') await turnStarted(id, cwd);
	// The prompt settles the turn before it, and the turn's end lets what it settled be filed: after its commits are
	// noted, so a decision finds the commit its turn made
	const ended = ['Stop', 'StopFailure'].includes(payload.hook_event_name);

	// An arcade's turn is kept as one commit before the turn's commits are noted, so the snapshot is the turn's
	if (ended) await snapshotTurn(id, cwd).catch(error => console.error('The arcade snapshot failed:', error));
	if (ended || payload.hook_event_name === 'UserPromptSubmit')
		(ended ? sessionTurns(id, cwd).then(turns => noteTurnCommits(id, turns.at(-1))) : Promise.resolve())
			.then(() => followDecisions(id, cwd))
			// Then the project's other sessions, once each
			.then(() => ended && lookBack(cwd))
			.catch(error => console.error('Following decisions failed:', error));
	// Not waited for: Claude waits on its hook, and the answer can take a few seconds to reach the transcript
	if (payload.hook_event_name === 'Stop')
		runAfterTurn(id).catch(error => console.error('Running the after-turn tasks failed:', error));
	if (payload.hook_event_name === 'Stop')
		keepGoing(id, payload.last_assistant_message).catch(error => console.error('Keeping going failed:', error));
	if (['Stop', 'StopFailure'].includes(payload.hook_event_name))
		turnEnded(id).catch(error => console.error('Answering from Claude failed:', error));

	return new Response(null, { status: 204 });
};

export default hooksRoutes;
