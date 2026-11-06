import { mkdtemp, writeFile } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, afterEach, beforeAll, expect, spyOn, test } from 'bun:test';

import { limitsFrom, limitsOf } from './accountLimits';

const configDir = process.env.CLAUDE_CONFIG_DIR;
const ANSWER = {
	five_hour: { utilization: 40, resets_at: 'soon' },
	seven_day: { utilization: 28, resets_at: 'later' },
};
const MINUTE = 60 * 1000;
let home;
let asked;
// Each test far on from the last, past any wait between asks
let now = Date.now();
const later = (minutes = 60) => (now += minutes * MINUTE);
const login = value => writeFile(path.join(home, '.credentials.json'), value);

beforeAll(async () => {
	home = await mkdtemp(path.join(os.tmpdir(), 'paude-limits-'));
	process.env.CLAUDE_CONFIG_DIR = home;
});
afterEach(() => asked?.mockRestore());
afterAll(() => {
	if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = configDir;
});

const answering = (body, ok = true) => {
	asked = spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status: ok ? 200 : 401 }));
};

test("the account's limits as /usage has them: a window not yet open is none of it used, and each model's own week", () => {
	expect(
		limitsFrom({
			five_hour: null,
			seven_day: { utilization: 28, resets_at: '2026-11-06T10:00:00Z' },
			limits: [
				{ kind: 'weekly_all', percent: 28, resets_at: '2026-11-06T10:00:00Z', scope: null },
				{
					kind: 'weekly_scoped',
					percent: 4,
					resets_at: '2026-11-06T10:00:00Z',
					scope: { model: { display_name: 'Fable' } },
				},
			],
		}),
	).toEqual({
		session: { percent: 0, resetsAt: null },
		week: { percent: 28, resetsAt: '2026-11-06T10:00:00Z' },
		models: [{ name: 'Fable', percent: 4, resetsAt: '2026-11-06T10:00:00Z' }],
	});
	expect(limitsFrom({ five_hour: { utilization: 61.5, resets_at: 'soon' } })).toMatchObject({
		session: { percent: 61.5, resetsAt: 'soon' },
		week: null,
		models: [],
	});
});

test('no login, a login file that is not JSON, or one that is null: not known, nothing asked, nothing thrown', async () => {
	answering(ANSWER);
	expect(await limitsOf(later())).toBeNull();
	await login('{ not json');
	expect(await limitsOf(later())).toBeNull();
	await login('null');
	expect(await limitsOf(later())).toBeNull();
	expect(asked).not.toHaveBeenCalled();
});

test("on a Mac with no login file, the keychain's Claude Code item is the login; elsewhere it isn't asked", async () => {
	const platform = Object.getOwnPropertyDescriptor(process, 'platform');
	const keychain = JSON.stringify({ claudeAiOauth: { accessToken: 'kept', expiresAt: now + 1e9 } });
	const spawned = spyOn(Bun, 'spawn').mockImplementation(() => ({
		stdout: new Blob([keychain]).stream(),
		exited: Promise.resolve(0),
		exitCode: 0,
	}));

	try {
		await login('null');
		answering(ANSWER);
		Object.defineProperty(process, 'platform', { value: 'linux', configurable: true });
		expect(await limitsOf(later())).toBeNull();
		expect(spawned).not.toHaveBeenCalled();

		Object.defineProperty(process, 'platform', { value: 'darwin', configurable: true });
		expect(await limitsOf(later())).toMatchObject({ session: { percent: 40 } });
		expect(spawned.mock.calls[0][0]).toEqual([
			'security',
			'find-generic-password',
			'-s',
			'Claude Code-credentials',
			'-w',
		]);
		expect(asked.mock.calls[0][1].headers.authorization).toBe('Bearer kept');
	} finally {
		Object.defineProperty(process, 'platform', platform);
		spawned.mockRestore();
	}
});

test('an expired login is not sent', async () => {
	answering(ANSWER);
	await login(JSON.stringify({ claudeAiOauth: { accessToken: 'old', expiresAt: now - MINUTE } }));
	expect(await limitsOf(later())).toBeNull();
	expect(asked).not.toHaveBeenCalled();
});

test('a live login is sent only to the usage host, as its bearer, and what it says is kept a while then let go', async () => {
	await login(
		JSON.stringify({ claudeAiOauth: { accessToken: 'secret', refreshToken: 'never', expiresAt: now + 1e9 } }),
	);
	answering(ANSWER);

	expect(await limitsOf(later())).toMatchObject({ session: { percent: 40 }, week: { percent: 28 }, ago: 0 });
	expect(asked).toHaveBeenCalledTimes(1);

	const [url, { headers }] = asked.mock.calls[0];

	expect(url).toBe('https://api.anthropic.com/api/oauth/usage');
	expect(headers.authorization).toBe('Bearer secret');
	expect(JSON.stringify(asked.mock.calls)).not.toContain('never');

	// Asked again only after a while; refused then, the last heard stands until it's stale
	expect(await limitsOf(later(1))).toMatchObject({ ago: MINUTE });
	expect(asked).toHaveBeenCalledTimes(1);
	asked.mockRestore();
	answering({}, false);
	expect(await limitsOf(later(4))).toMatchObject({ ago: 5 * MINUTE });
	expect(await limitsOf(later(11))).toBeNull();
});
