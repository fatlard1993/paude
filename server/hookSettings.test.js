import { mkdtemp, stat } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { expect, test } from 'bun:test';

import { HOOK_EVENTS, hookSecret, hookSettings, loadHookSecret, setHookAddress } from './hookSettings';

// Recorded from Claude Code 2.1.291 (paths and ids dropped). Declining the permission prompt sent no hook at all,
// which is why typing into a waiting session clears it (PtySession.input).
const RECORDED = [
	{ hook_event_name: 'UserPromptSubmit' },
	{ hook_event_name: 'Notification', message: 'Claude needs your permission', notification_type: 'permission_prompt' },
	{ hook_event_name: 'Stop', stop_hook_active: false },
];

const statusOf = payload => HOOK_EVENTS[payload.hook_event_name]?.(payload) ?? null;

test("Claude Code's hook payloads map to working, needs you and ready", () => {
	expect(RECORDED.map(statusOf)).toEqual(['working', 'waiting', 'ready']);
	expect(statusOf({ hook_event_name: 'Notification', notification_type: 'idle_prompt' })).toBeNull();
	expect(statusOf({ hook_event_name: 'SessionStart' })).toBeNull();
});

test('the settings post every event to a per-session address, and never fail the hook', () => {
	setHookAddress({ host: '0.0.0.0', port: 8044 });

	const { hooks } = JSON.parse(hookSettings());

	expect(Object.keys(hooks).sort()).toEqual(Object.keys(HOOK_EVENTS).sort());

	const { command } = hooks.Stop[0].hooks[0];

	expect(command).toContain('http://127.0.0.1:8044/api/hooks/');
	expect(command).toContain('/$PAUDE_SESSION"');
	expect(command).toEndWith('|| true');
});

test('the secret is kept for the next server, so held sessions still report after a restart', async () => {
	const dataDir = await mkdtemp(join(os.tmpdir(), 'paude-hooks-'));
	const first = hookSecret;

	await loadHookSecret(dataDir);
	expect((await Bun.file(join(dataDir, 'hook-secret')).text()).trim()).toBe(first);
	expect((await stat(join(dataDir, 'hook-secret'))).mode & 0o777).toBe(0o600);

	await Bun.write(join(dataDir, 'hook-secret'), 'kept-from-before\n');
	await loadHookSecret(dataDir);
	setHookAddress({ host: '127.0.0.1', port: 8044 });
	expect(hookSettings()).toContain('/api/hooks/kept-from-before/$PAUDE_SESSION');
});
