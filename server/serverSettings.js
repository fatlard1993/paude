import os from 'os';
import { join } from 'path';

import readJsonFile from '../shared/readJsonFile';
import updateJsonFile from '../shared/updateJsonFile';
import { cleanPublicUrl } from './publicOrigin';

const MAX_NAME = 40;

// This machine's paude settings live in ~/.config/paude, beside the paude command's own
export const configFile = name => join(process.env.XDG_CONFIG_HOME ?? join(os.homedir(), '.config'), 'paude', name);

// { "name": "laptop", "shareRemotes": true, "ownerName": "Alice", "publicUrl": "https://laptop.tail1234.ts.net" }.
// `name` is what browsers and other machines call this server unless they name it themselves; `shareRemotes` lets a
// password login see the other servers this machine is logged into, not just this machine's own logins; `ownerName`
// is what the owner goes by in chat and comments (this machine's user name otherwise); `publicUrl` is the address
// invite links carry, whichever address they were made from, and `previewPort` where shares are behind a proxy on 443
// when that isn't 8444 (paude tailscale sets both). Read each time, so
// a change needs no restart.
export const serverSettings = () => readJsonFile(configFile('server.json'), {}).catch(() => ({}));

// This machine's own token, or the owner password where this machine shares them
export const mayListRemotes = async identity =>
	Boolean(identity?.local || (identity?.owner && (await serverSettings()).shareRemotes));

export const cleanServerName = name => (typeof name === 'string' ? name.trim().slice(0, MAX_NAME) : '') || null;

export const serverName = async () => cleanServerName((await serverSettings()).name);

export const ownerName = async () => cleanServerName((await serverSettings()).ownerName) ?? os.userInfo().username;

// An empty name goes back to none
export const setServerName = name =>
	updateJsonFile(configFile('server.json'), {}, settings => {
		const next = { ...settings, name: cleanServerName(name) };

		if (!next.name) delete next.name;

		return next;
	});

// Where invite links point, and the port shares are on behind it when that isn't 8444; null takes the address back
// to the one each link is made from, and the port back to 8444
export const setPublicUrl = (url, { previewPort = null } = {}) =>
	updateJsonFile(configFile('server.json'), {}, settings => {
		const next = { ...settings, publicUrl: cleanPublicUrl(url), previewPort };

		if (!next.publicUrl) delete next.publicUrl;
		if (!next.previewPort) delete next.previewPort;

		return next;
	});
