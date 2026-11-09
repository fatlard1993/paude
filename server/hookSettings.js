import { writeFile } from 'fs/promises';
import { join } from 'path';

import { PROPOSING_TOOLS } from './sessions/proposals';
import { soundToken } from './sounds';

// Claude Code tells paude what it's doing through hooks added to each session it starts. They post to this server
// with a secret, so nothing else can feed it a status.
export let hookSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
let hookUrl = null;
let serverUrl = null;
// How long a push waits on the filing, at most
const PUSH_WAIT_SECONDS = 240;
// How long Claude, carrying on from a compaction, waits on the handover a fabled session's monitor is writing, at most
export const HANDOVER_WAIT_SECONDS = 120;
// How long compacting waits on paude's notes for the summary, read from what it already holds
const NOTES_WAIT_SECONDS = 10;

// A session held through a restart keeps the hooks it started with, so the secret outlives any one server: kept in
// the data folder, readable only by this user
export const loadHookSecret = async dataDir => {
	const file = join(dataDir, 'hook-secret');
	const stored = (await Bun.file(file).exists()) ? (await Bun.file(file).text()).trim() : '';

	if (stored) hookSecret = stored;
	else await writeFile(file, `${hookSecret}\n`, { mode: 0o600 });
};

export const setHookAddress = ({ host, port }) => {
	const reachable = ['0.0.0.0', '::', ''].includes(host) ? '127.0.0.1' : host;

	serverUrl = `http://${reachable.includes(':') ? `[${reachable}]` : reachable}:${port}`;
	hookUrl = `${serverUrl}/api/hooks/${hookSecret}`;
};

// The address a session asks paude for a game sound at (see router/sounds.js), its own token in it; null before the
// server knows where it listens
export const soundsAddress = sessionId =>
	serverUrl && `${serverUrl}/api/sounds/${sessionId}/${soundToken(hookSecret, sessionId)}`;

export const HOOK_EVENTS = {
	Notification: payload =>
		['permission_prompt', 'elicitation_dialog'].includes(payload.notification_type) ? 'waiting' : null,
	UserPromptSubmit: () => 'working',
	PostToolUse: () => 'working',
	PostToolUseFailure: () => 'working',
	PermissionDenied: () => 'working',
	Stop: () => 'ready',
	StopFailure: () => 'ready',
};

export const curlMissing = () => !Bun.which('curl');

// The --settings JSON that adds paude's hooks alongside the person's own (Claude Code runs both)
export const hookSettings = () => {
	if (!hookUrl) return null;

	// The session is named by paude's id, from the environment it starts Claude in: Claude's own id changes on /clear
	const post = `curl -fsS -X POST -H 'content-type: application/json' --data-binary @- "${hookUrl}/$PAUDE_SESSION"`;
	const command = `${post.replace('curl -fsS', 'curl -fsS --max-time 2')} >/dev/null 2>&1 || true`;
	const hook = [{ hooks: [{ type: 'command', command }] }];
	// Before a command runs, paude may answer: a push waits while what the session settled is filed, and is turned back
	// when the filing added to what it would push. Its answer is the hook's output; no answer lets the command run.
	const beforeCommand = {
		type: 'command',
		command: `${post.replace('curl -fsS', `curl -fsS --max-time ${PUSH_WAIT_SECONDS}`)} 2>/dev/null || true`,
		timeout: PUSH_WAIT_SECONDS + 10,
	};
	// A prompt arriving or a question answered, paude may answer with a line for Claude to read with it (who's in an
	// arcade, when that changes); otherwise nothing, and nothing is added
	const toldBack = [
		{
			hooks: [
				{ type: 'command', command: `${post.replace('curl -fsS', 'curl -fsS --max-time 2')} 2>/dev/null || true` },
			],
		},
	];
	// Compacting, paude answers with notes for the summary, which Claude Code takes as instructions for it
	const beforeCompact = {
		type: 'command',
		command: `${post.replace('curl -fsS', `curl -fsS --max-time ${NOTES_WAIT_SECONDS}`)} 2>/dev/null || true`,
		timeout: NOTES_WAIT_SECONDS + 5,
	};
	// Carrying on from a compaction, paude may answer with a handover for Claude to read beside the summary
	const afterCompact = {
		type: 'command',
		command: `${post.replace('curl -fsS', `curl -fsS --max-time ${HANDOVER_WAIT_SECONDS + 5}`)} 2>/dev/null || true`,
		timeout: HANDOVER_WAIT_SECONDS + 15,
	};

	return JSON.stringify({
		hooks: {
			...Object.fromEntries(Object.keys(HOOK_EVENTS).map(event => [event, hook])),
			UserPromptSubmit: toldBack,
			PostToolUse: toldBack,
			// Only the edits, before any permission prompt, so the page can show what Claude proposes; and a subagent
			// going out, so the universe view can fly it until its tool ends
			PreToolUse: [
				{ matcher: PROPOSING_TOOLS.join('|'), hooks: hook[0].hooks },
				{ matcher: 'Bash', hooks: [beforeCommand] },
				{ matcher: 'Task|Agent', hooks: hook[0].hooks },
				// A question for the person: in an arcade, where every turn ends with one, this is the turn's end, since
				// a Stop never comes while the question waits
				{ matcher: 'AskUserQuestion', hooks: hook[0].hooks },
			],
			// A compaction beginning, for notes on the summary and a fabled monitor's handover, and Claude carrying on after
			PreCompact: [{ hooks: [beforeCompact] }],
			SessionStart: [{ matcher: 'compact', hooks: [afterCompact] }],
		},
	});
};
