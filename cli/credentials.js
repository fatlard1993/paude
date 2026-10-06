import os from 'os';
import path from 'path';

import updateJsonFile from '../shared/updateJsonFile';

// { default: url, tokens: { [url]: token }, names: { [url]: name } }, readable only by this user
const file = path.join(process.env.XDG_CONFIG_HOME ?? path.join(os.homedir(), '.config'), 'paude', 'credentials.json');

const EMPTY = { default: null, tokens: {} };

const read = async () => {
	const stored = Bun.file(file);

	return (await stored.exists()) ? stored.json() : structuredClone(EMPTY);
};

const update = change => updateJsonFile(file, EMPTY, change);

// A bare host means HTTPS, except this machine's own addresses: a paude reachable over plain http should only be on
// localhost
const LOCAL_HOST = /^(localhost|127(?:\.\d+){3}|\[::1\])(:\d+)?(\/|$)/;

export const normalizeUrl = url => {
	const withScheme = /^https?:\/\//.test(url) ? url : `${LOCAL_HOST.test(url) ? 'http' : 'https'}://${url}`;

	return withScheme.replace(/\/+$/, '');
};

export const saveToken = (url, token, name) =>
	update(credentials => {
		credentials.tokens[url] = token;
		if (name) (credentials.names ??= {})[url] = name;
		credentials.default = url;

		return credentials;
	});

export const forget = url =>
	update(credentials => {
		delete credentials.tokens[url];
		delete credentials.names?.[url];
		if (credentials.default === url) credentials.default = Object.keys(credentials.tokens)[0] ?? null;

		return credentials;
	});

export const resolveServer = async url => {
	const credentials = await read();
	const chosen = url ? normalizeUrl(url) : credentials.default;

	return { url: chosen, token: chosen ? credentials.tokens[chosen] : null };
};

export const allTokens = async () => (await read()).tokens;

export const serverNames = async () => (await read()).names ?? {};

export const nameServer = async (url, name) => {
	let named = false;

	await update(credentials => {
		named = Boolean(credentials.tokens[url]);
		if (named) (credentials.names ??= {})[url] = name;

		return credentials;
	});

	return named;
};
