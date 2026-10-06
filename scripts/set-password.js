#!/usr/bin/env bun

import os from 'os';
import path from 'path';

import { readHidden } from '../cli/screen';
import { initAuth, setPassword } from '../server/auth';

const MIN_LENGTH = 12;

const dataDir = process.argv[2] ?? path.join(os.homedir(), '.paude');

await initAuth(dataDir);

const password = await readHidden('New paude password: ');

if (password.length < MIN_LENGTH) {
	console.error(`Use at least ${MIN_LENGTH} characters; this login guards a shell on this machine.`);
	process.exit(1);
}

if ((await readHidden('Again: ')) !== password) {
	console.error('They did not match.');
	process.exit(1);
}

// A running server keeps auth.json in memory and saves it as it goes; it changes the password itself, or it could
// write its old state back over this one
const throughServer = async () => {
	try {
		const url = (await Bun.file(path.join(dataDir, 'server-url')).text()).trim();
		const token = (await Bun.file(path.join(dataDir, 'local-token')).text()).trim();
		const ownId = (await Bun.file(path.join(dataDir, 'server-id')).text()).trim();
		const { serverId } = await (await fetch(`${url}/api/auth`, { signal: AbortSignal.timeout(1000) })).json();

		if (serverId !== ownId) return false;

		const response = await fetch(`${url}/api/password`, {
			method: 'PUT',
			headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
			body: JSON.stringify({ password }),
		});

		return response.ok;
	} catch {
		return false;
	}
};

if (!(await throughServer())) await setPassword(password);

console.log(
	`Saved to ${path.join(dataDir, 'auth.json')}. Every login, invite and terminal token was signed out, except this machine's own.`,
);
