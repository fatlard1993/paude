import { readdir } from 'fs/promises';
import path from 'path';

import { sessionEnvironment } from './sessions/PtySession';

// What a session's processes see in their environment, and what the project's .env files set, for the Tasks
// panel. A value whose name sounds secret is never sent, nor any .env value: only that it's set, and how long it is.
const SECRET_NAME = /KEY|TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|AUTH|COOKIE|PRIVATE|SESSION_ID|DSN|CONN/i;
const ENV_FILE = /^\.env(\..+)?$/;
const MAX_VALUE = 300;

const masked = value => `•••• (${value.length} characters)`;

const shown = (name, value) => (SECRET_NAME.test(name) ? masked(value) : value.slice(0, MAX_VALUE));

// NAME=value lines, as dotenv reads them (comments, export, quotes)
export const parseEnvFile = text =>
	text.split('\n').flatMap(line => {
		const found = /^\s*(?:export\s+)?([A-Za-z_][\w.]*)\s*=\s*(.*)$/.exec(line);

		if (!found) return [];

		return [{ name: found[1], value: found[2].trim().replace(/^(['"])(.*)\1$/, '$2') }];
	});

export const sessionEnvironmentView = async cwd => {
	const variables = Object.entries(sessionEnvironment())
		.sort(([a], [b]) => a.localeCompare(b))
		.map(([name, value]) => ({ name, value: shown(name, value) }));
	const names = (await readdir(cwd).catch(() => [])).filter(name => ENV_FILE.test(name)).sort();
	const files = await Promise.all(
		names.map(async name => ({
			file: name,
			variables: parseEnvFile(await Bun.file(path.join(cwd, name)).text()).map(({ name: key, value }) => ({
				name: key,
				value: masked(value),
			})),
		})),
	);

	return { variables, files };
};
