import os from 'os';
import path from 'path';

import writeJsonFile from '../shared/writeJsonFile';

// { default: url, tokens: { [url]: token } }, readable only by this user
const file = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'paude', 'credentials.json');

const read = async () => {
	const stored = Bun.file(file);

	return (await stored.exists()) ? stored.json() : { default: null, tokens: {} };
};

const write = credentials => writeJsonFile(file, () => credentials);

// A bare host means HTTPS, except this machine's own addresses: a paude reachable over plain http should only be on
// localhost
const LOCAL_HOST = /^(localhost|127(?:\.\d+){3}|\[::1\])(:\d+)?(\/|$)/;

export const normalizeUrl = url => {
	const withScheme = /^https?:\/\//.test(url) ? url : `${LOCAL_HOST.test(url) ? 'http' : 'https'}://${url}`;

	return withScheme.replace(/\/+$/, '');
};

export const saveToken = async (url, token) => {
	const credentials = await read();

	credentials.tokens[url] = token;
	credentials.default = url;
	await write(credentials);
};

export const forget = async url => {
	const credentials = await read();

	delete credentials.tokens[url];
	if (credentials.default === url) credentials.default = Object.keys(credentials.tokens)[0] ?? null;
	await write(credentials);
};

export const resolveServer = async url => {
	const credentials = await read();
	const chosen = url ? normalizeUrl(url) : credentials.default;

	return { url: chosen, token: chosen ? credentials.tokens[chosen] : null };
};

export const allTokens = async () => (await read()).tokens;
