#!/usr/bin/env bun

import os from 'os';

import Argi from 'argi';

import packageJSON from '../package.json';

import attachSession from '../cli/attach';
import { forget, normalizeUrl, resolveServer, saveToken } from '../cli/credentials';
import pickSession from '../cli/picker';
import { readHidden } from '../cli/screen';

const USAGE = `paude login <url>     log in to a paude server (e.g. https://paude.example.com) and make it the default
paude login <invite>  join with an invite link someone sent you
paude logout [url]     sign this machine out of the server and forget the login
paude [--url <url>]    pick a session and attach to it
paude -s <id>          attach straight to a session`;

// An invite link (https://host/#/join/<token>) logs its guest in without a password
const parseTarget = target => {
	const [base, inviteToken] = target.split(/\/?#?\/join\//);

	return { url: normalizeUrl(base), inviteToken };
};

const login = async target => {
	if (!target) return console.log(USAGE);

	const { url, inviteToken } = parseTarget(target);
	const credentials = inviteToken ? { invite: inviteToken } : { password: await readHidden(`Password for ${url}: `) };
	let response;

	try {
		response = await fetch(`${url}/api/tokens`, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ ...credentials, name: os.hostname() }),
		});
	} catch {
		return console.error(`Nothing answered at ${url}. Is the address right?`);
	}

	if (response.status === 401) return console.error('Wrong password.');
	if (response.status === 410) return console.error('That invite has expired or was revoked. Ask for a new one.');
	if (response.status === 429) return console.error(`Too many tries. Wait ${response.headers.get('retry-after')}s.`);
	if (!response.ok) return console.error(`${url} answered ${response.status}. Is that a paude server?`);

	await saveToken(url, (await response.json()).token);
	console.log(inviteToken ? 'Joined. Run paude to open the session.' : 'Logged in. Run paude to pick a session.');
};

const logout = async target => {
	const { url, token } = await resolveServer(target);

	if (!url) return console.log('Not logged in.');

	// The token stays valid on the server until it's revoked there; forgetting it locally isn't enough
	const revoked = await fetch(`${url}/api/tokens/current`, {
		method: 'DELETE',
		headers: { authorization: `Bearer ${token}` },
	}).then(
		response => response.ok,
		() => false,
	);

	await forget(url);
	console.log(revoked ? `Signed out of ${url}.` : `Forgot ${url}, but couldn't reach it to revoke the token.`);
};

const OUTCOMES = {
	detach: 'Detached. The session keeps running.',
	ended: 'The session ended. Open it again to resume.',
	unauthorized: 'Your login ended (signed out, or the password changed). Run: paude login <url>',
};

const run = async () => {
	const { options } = new Argi({
		// Otherwise argi looks for one in the current directory, and paude runs from anywhere
		packageJSON,
		options: {
			url: { type: 'string', defaultValue: process.env.PAUDE_URL, description: 'paude server (env: PAUDE_URL)' },
			session: { type: 'string', alias: 's', description: 'Attach straight to this session id' },
		},
	});
	const server = await resolveServer(options.url);

	if (!server.url || !server.token) return console.log(`Not logged in. Run: paude login <url>\n\n${USAGE}`);

	const { identity } = await (
		await fetch(`${server.url}/api/auth`, { headers: { authorization: `Bearer ${server.token}` } })
	).json();

	if (!identity) return console.log(OUTCOMES.unauthorized);

	// A guest's invite names one session; there's nothing to pick
	const guest = !identity.owner;
	let id = guest ? identity.sessionId : options.session;

	while (true) {
		id ??= await pickSession(server);

		if (!id) return;

		const outcome = await attachSession(server, id, { canSwitch: !guest, role: guest ? identity.role : 'owner' });

		if (outcome !== 'switch') return console.log(OUTCOMES[outcome]);

		id = null;
	}
};

const [command, target] = process.argv.slice(2);

try {
	if (command === 'login') await login(target);
	else if (command === 'logout') await logout(target);
	else if (command === 'help' || command === '--help') console.log(USAGE);
	else await run();
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
} finally {
	process.exit();
}
