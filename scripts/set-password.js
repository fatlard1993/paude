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

await setPassword(password);

console.log(`Saved to ${path.join(dataDir, 'auth.json')}. Every existing login and terminal token was signed out.`);
