import os from 'os';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';

// How much of the Claude account's usage limits is used, as Claude Code's /usage shows it: asked of Anthropic with the
// login Claude Code keeps, read and never refreshed (refreshing would rotate it out from under Claude Code), so with
// none to read, or one expired, it isn't known. Asked at most this often, and after a failure, less often.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const FRESH_MS = 2 * 60 * 1000;
const FAILED_MS = 10 * 60 * 1000;
const TIMEOUT_MS = 10 * 1000;

let last = { at: 0, value: null, failed: false };

// Claude Code's login: in its config folder when one's set, else in ~/.claude (on a Mac it's in the keychain instead)
const tokenOf = async (now = Date.now()) => {
	const folder = process.env.CLAUDE_CONFIG_DIR ?? path.join(os.homedir(), '.claude');
	const { claudeAiOauth: login } = await readJsonFile(path.join(folder, '.credentials.json'), {});

	return login?.accessToken && (!login.expiresAt || login.expiresAt > now) ? login.accessToken : null;
};

const limitOf = (window, fallback = null) =>
	window ? { percent: window.utilization ?? 0, resetsAt: window.resets_at ?? null } : fallback;

// What the answer says: the five-hour window (none open yet is none used), the week, and each model's own week.
// { session: { percent, resetsAt }, week, models: [{ name, percent, resetsAt }] }
export const usageFrom = answer => ({
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

// The latest known, `ago` how long since it was asked; null while it's never been known
export const usageOf = async (now = Date.now()) => {
	if (now - last.at < (last.failed ? FAILED_MS : FRESH_MS)) return last.value && { ...last.value, ago: now - last.at };

	const token = await tokenOf(now);

	last = { ...last, at: now, failed: true };
	if (!token) return null;
	try {
		const response = await fetch(USAGE_URL, {
			headers: { authorization: `Bearer ${token}`, 'anthropic-beta': 'oauth-2025-04-20' },
			signal: AbortSignal.timeout(TIMEOUT_MS),
		});

		if (response.ok) last = { at: now, value: usageFrom(await response.json()), failed: false };
	} catch {
		// Not known this time: the last known stands
	}

	return last.value && { ...last.value, ago: now - last.at };
};
