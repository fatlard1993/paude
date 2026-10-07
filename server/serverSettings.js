import os from 'os';
import { join } from 'path';

import readJsonFile from '../shared/readJsonFile';
import updateJsonFile from '../shared/updateJsonFile';

const MAX_NAME = 40;

// This machine's paude settings live in ~/.config/paude, beside the paude command's own
export const configFile = name => join(process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'), 'paude', name);

// { "name": "laptop", "shareRemotes": true }. `name` is what browsers and other machines call this server unless they
// name it themselves; `shareRemotes` lets a password login see the other servers this machine is logged into, not
// just this machine's own logins. Read each time, so a change needs no restart.
export const serverSettings = () => readJsonFile(configFile('server.json'), {}).catch(() => ({}));

// This machine's own token, or the owner password where this machine shares them
export const mayListRemotes = async identity =>
	Boolean(identity?.local || (identity?.owner && (await serverSettings()).shareRemotes));

export const cleanServerName = name => (typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '') || null;

export const serverName = async () => cleanServerName((await serverSettings()).name);

// An empty name goes back to none
export const setServerName = name =>
	updateJsonFile(configFile('server.json'), {}, settings => {
		const next = { ...settings, name: cleanServerName(name) };

		if (!next.name) delete next.name;

		return next;
	});
