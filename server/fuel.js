import crypto from 'crypto';
import os from 'os';
import path from 'path';

import readJsonFile from '../shared/readJsonFile';
import writeJsonFile from '../shared/writeJsonFile';
import { burnOf } from './cacheMeter';
import { usageOf } from './usage';

// The fuel this machine's Claude runs on: the Claude account it's logged into, which every machine logged into it
// draws from, and what its sessions have burned of it. The tank's size isn't told, so it's measured: what had been
// burned when a usage limit stopped a session. Kept per account, { [account]: { capacity, at } }.
const WINDOW_MS = 5 * 60 * 60 * 1000;
const ACCOUNT_MS = 60 * 1000;

let file;
let tanks = {};
let account = { at: 0, value: null };

export const initFuel = async dataDir => {
	file = path.join(dataDir, 'fuel.json');
	tanks = await readJsonFile(file, {});
};

// Which account and plan, from Claude Code's own settings: the account as a hash of its id, enough to tell two
// machines on one account without naming it
const accountOf = async (now = Date.now()) => {
	if (now - account.at < ACCOUNT_MS) return account.value;

	const home = process.env.CLAUDE_CONFIG_DIR ?? os.homedir();
	const settings = await readJsonFile(path.join(home, '.claude.json'), {});
	const { accountUuid, planDisplayName } = settings.oauthAccount ?? {};

	account = {
		at: now,
		value: accountUuid
			? {
					id: crypto.createHash('sha256').update(accountUuid).digest('hex').slice(0, 12),
					plan: planDisplayName ?? null,
				}
			: null,
	};

	return account.value;
};

// A usage limit stopped a session: the tank is as big as what had been burned this window, the most measured in it
export const noteEmpty = async (now = Date.now()) => {
	const known = await accountOf(now);

	if (!known) return;

	const { burned } = burnOf(now);
	const tank = tanks[known.id];

	if (tank && now - tank.at < WINDOW_MS && tank.capacity >= burned) return;
	tanks[known.id] = { capacity: burned, at: now };
	if (file) await writeJsonFile(file, () => tanks);
};

// { account, plan, burned, rate, capacity, capacityAgo, usage }: capacity only once a limit has measured it; usage as
// the account's own limits say, when they can be asked
export const fuelOf = async (now = Date.now()) => {
	const known = await accountOf(now);
	const tank = known && tanks[known.id];

	return {
		account: known?.id ?? null,
		plan: known?.plan ?? null,
		...burnOf(now),
		capacity: tank?.capacity ?? null,
		capacityAgo: tank ? now - tank.at : null,
		usage: await usageOf(now),
	};
};
