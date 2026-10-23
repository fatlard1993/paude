import { writeFile } from 'fs/promises';
import { join } from 'path';

import { PROPOSING_TOOLS } from './sessions/proposals';

// Claude Code tells paude what it's doing through hooks added to each session it starts. They post to this server
// with a secret, so nothing else can feed it a status.
export let hookSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
let hookUrl = null;
// How long a push waits on the filing, at most
const PUSH_WAIT_SECONDS = 240;

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

	hookUrl = `http://${reachable.includes(':') ? `[${reachable}]` : reachable}:${port}/api/hooks/${hookSecret}`;
};

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

	return JSON.stringify({
		hooks: {
			...Object.fromEntries(Object.keys(HOOK_EVENTS).map(event => [event, hook])),
			// Only the edits, before any permission prompt, so the page can show what Claude proposes
			PreToolUse: [
				{ matcher: PROPOSING_TOOLS.join('|'), hooks: hook[0].hooks },
				{ matcher: 'Bash', hooks: [beforeCommand] },
			],
		},
	});
};
