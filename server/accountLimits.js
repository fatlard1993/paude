import os from 'os';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';

// How much of the Claude account's usage limits is used, as Claude Code's /usage shows it: asked of Anthropic with the
// login Claude Code keeps, read and never refreshed (refreshing would rotate it out from under Claude Code), so with
// none to read, or one expired, it isn't known. Asked at most this often, and after a failure, less often; what was
// last heard is told only so long after, so a login gone stale falls back to the estimate rather than old numbers.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const FRESH_MS = 2 * 60 * 1000;
const FAILED_MS = 10 * 60 * 1000;
const STALE_MS = 15 * 60 * 1000;
const TIMEOUT_MS = 10 * 1000;

let last = { at: 0, heard: 0, value: null, failed: false };

// On a Mac, Claude Code keeps its login in the keychain, as this item's password
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

const keychainLogin = async () => {
	try {
		const child = Bun.spawn(['security', 'find-generic-password', '-s', KEYCHAIN_SERVICE, '-w'], {
			stdout: 'pipe',
			stderr: 'ignore',
		});
		const [said] = await Promise.all([new Response(child.stdout).text(), child.exited]);

		return child.exitCode === 0 ? JSON.parse(said) : null;
	} catch {
		return null;
	}
};

// Claude Code's login: in its config folder when one's set, else in ~/.claude; on a Mac with none there, its keychain
const tokenOf = async (now = Date.now()) => {
	const folder = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
	const login =
		(await readJsonFile(path.join(folder, '.credentials.json'), {}))?.claudeAiOauth ??
		(process.platform === 'darwin' ? (await keychainLogin())?.claudeAiOauth : null);

	return login?.accessToken && (!login.expiresAt || login.expiresAt > now) ? login.accessToken : null;
};

const limitOf = (window, fallback = null) =>
	window ? { percent: window.utilization ?? 0, resetsAt: window.resets_at ?? null } : fallback;

// What the answer says: the five-hour window (none open yet is none used), the week, and each model's own week.
// { session: { percent, resetsAt }, week, models: [{ name, percent, resetsAt }] }
export const limitsFrom = answer => ({
	session: limitOf(answer.five_hour, { percent: 0, resetsAt: null }),
	week: limitOf(answer.seven_day),
	models: (answer.limits ?? [])
		.filter(({ kind, scope }) => kind === 'weekly_scoped' && scope?.model?.display_name)
		.map(({ scope, percent, resets_at: resetsAt }) => ({
			name: scope.model.display_name,
			percent: percent ?? 0,
			resetsAt,
		})),
});

// What was last heard, `ago` how long since; null while it's never been heard, or not for too long
const lastHeard = now => (last.value && now - last.heard < STALE_MS ? { ...last.value, ago: now - last.heard } : null);

export const limitsOf = async (now = Date.now()) => {
	if (now - last.at < (last.failed ? FAILED_MS : FRESH_MS)) return lastHeard(now);

	last = { ...last, at: now, failed: true };
	try {
		const token = await tokenOf(now);

		if (!token) return lastHeard(now);

		const response = await fetch(USAGE_URL, {
			headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});

		if (response.ok) last = { at: now, heard: now, value: limitsFrom(await response.json()), failed: false };
	} catch {
		// Not heard this time, nor its login read: what was last heard stands while it's fresh enough
	}

	return lastHeard(now);
};
