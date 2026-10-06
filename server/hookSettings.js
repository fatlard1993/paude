import { writeFile } from 'fs/promises';
import { join } from 'path';

// Claude Code tells paude what it's doing through hooks added to each session it starts. They post to this server
// with a secret, so nothing else can feed it a status.
export let hookSecret = Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString('base64url');
let hookUrl = null;

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
	const command = `curl -fsS --max-time 2 -X POST -H 'content-type: application/json' --data-binary @- "${hookUrl}/$PAUDE_SESSION" >/dev/null 2>&1 || true`;
	const hook = [{ hooks: [{ type: 'command', command }] }];

	return JSON.stringify({ hooks: Object.fromEntries(Object.keys(HOOK_EVENTS).map(event => [event, hook])) });
};
