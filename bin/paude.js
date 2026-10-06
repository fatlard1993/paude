#!/usr/bin/env bun

import os from 'os';
import path from 'path';

import Argi from 'argi';

import packageJSON from '../package.json';

import attachSession from '../cli/attach';
import { forget, nameServer, normalizeUrl, resolveServer, saveToken } from '../shared/credentials';
import { allServers, api, ensureLocalServer, stopLocalServer } from '../cli/servers';
import doctor from '../cli/doctor';
import pickSession from '../cli/picker';
import startWatchAlerts from '../cli/watchAlerts';
import { loadPrefs, savePrefs } from '../cli/prefs';
import { readHidden } from '../cli/screen';

const KEY_HINTS = 3;

const USAGE = `paude                    pick a session from this machine and every server you're logged into
paude add [folder]       make a folder (default: this one) a project on this machine's paude
paude remove <name>      stop treating a folder added with paude add as a project
paude web [url]          open a paude in the browser, already logged in (default: this machine's)
paude login <url>        log in to a paude server (e.g. https://paude.example.com); --name <name> shows it by that name
paude login <invite>     join with an invite link someone sent you
paude name <url> <name>  show a server you're logged into by a name
paude logout [url]       sign this machine out of a server and forget the login
paude --url <url>        pick from that server only
paude --url <url> -s <id>  attach straight to a session there
paude stop               stop this machine's background paude (after an update, say)
paude doctor             what works on this machine, and what to install for the rest
paude serve              run this machine's paude in the foreground instead (--projects, --host, --port, --data, --claude)`;

// An invite link (https://host/#/join/<token>) logs its guest in without a password
const parseTarget = target => {
	const [base, inviteToken] = target.split(/\/?#?\/join\//);

	return { url: normalizeUrl(base), inviteToken };
};

const login = async (target, name) => {
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

	await saveToken(url, (await response.json()).token, name);
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

let attachedTo = null;

const attachLoop = async (pick, first) => {
	let chosen = first;

	while (true) {
		attachedTo = null;
		chosen ??= await pick();

		if (!chosen) return;

		attachedTo = chosen.id;

		const { server, id, identity } = chosen;
		const guest = !identity.owner;
		const prefs = await loadPrefs();
		const showKeyHint = guest || (prefs.keyHints ?? 0) < KEY_HINTS;

		if (!guest && showKeyHint) await savePrefs({ ...prefs, keyHints: (prefs.keyHints ?? 0) + 1 });

		const outcome = await attachSession(server, id, {
			canSwitch: !guest,
			role: guest ? identity.role : 'owner',
			showKeyHint,
		});

		if (outcome !== 'switch') return console.log(OUTCOMES[outcome]);

		chosen = null;
	}
};

const runOne = async options => {
	const server = await resolveServer(options.url);

	if (!server.url || !server.token) {
		return console.log(
			options.url
				? `Not logged in to ${options.url}. Run: paude login ${options.url}`
				: 'Which server? Add --url <url>, or run paude login <url> first.',
		);
	}

	const { identity } = await api(server, '/api/auth');

	if (!identity) return console.log(OUTCOMES.unauthorized);

	const id = identity.owner ? options.session : identity.sessionId;
	const one = [{ ...server, label: new URL(server.url).host }];

	startWatchAlerts(one, () => attachedTo);

	return attachLoop(() => pickSession(one), id ? { server, id, identity } : null);
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

	if (options.url || options.session) return runOne(options);

	const servers = await allServers();

	if (!servers.length) {
		return console.log(
			`Nothing to show yet. Run paude add in a folder to work on it here, or paude login <url> for a hosted paude.\n\n${USAGE}`,
		);
	}

	startWatchAlerts(servers, () => attachedTo);

	return attachLoop(() => pickSession(servers));
};

const add = async folder => {
	const server = await ensureLocalServer();
	const requested = path.resolve(folder ?? process.cwd());
	const { name } = await api(server, '/api/projects', { method: 'POST', body: JSON.stringify({ path: requested }) });

	console.log(`${requested} is the project "${name}" on this machine's paude. Run paude to open a session in it.`);
};

const remove = async name => {
	if (!name) return console.log('Which project? paude remove <name>');

	const server = await ensureLocalServer();

	const response = await fetch(`${server.url}/api/projects/${encodeURIComponent(name)}`, {
		method: 'DELETE',
		headers: { authorization: `Bearer ${server.token}` },
	});

	if (response.status === 404) return console.log(`"${name}" isn't a folder added with paude add.`);
	if (!response.ok) throw new Error(`This machine's paude answered ${response.status}.`);
	console.log(`"${name}" is no longer a project. Its sessions are still in Claude Code's history.`);
};

const serve = async args => {
	const entry = path.join(import.meta.dir, '..', 'server', 'index.js');
	const child = Bun.spawn(['bun', entry, ...args], {
		cwd: path.join(import.meta.dir, '..'),
		env: { NODE_ENV: 'production', ...process.env },
		stdio: ['inherit', 'inherit', 'inherit'],
	});

	process.exitCode = await child.exited;
};

const OPENERS = { darwin: 'open', win32: 'explorer' };

const web = async target => {
	const server = target ? await resolveServer(target) : await ensureLocalServer();

	if (!server.url || !server.token) return console.log(`Not logged in to ${target}. Run: paude login ${target}`);

	const { code } = await api(server, '/api/handoff', { method: 'POST' });
	const link = `${server.url}/#/handoff/${code}`;

	try {
		Bun.spawn([OPENERS[process.platform] ?? 'xdg-open', link], { stdio: ['ignore', 'ignore', 'ignore'] });
	} catch {
		// No browser to open here; the link below still works on any machine that can reach the server
	}
	console.log(`Opening ${server.url}. If no browser comes up, open this within a minute (it works once):\n${link}`);
};

const [command, target] = process.argv.slice(2);
const flag = name => {
	const at = process.argv.indexOf(name);

	return at === -1 ? undefined : process.argv[at + 1];
};

try {
	if (command === 'login') await login(target, flag('--name'));
	else if (command === 'name') {
		const name = process.argv[4];

		if (!target || !name) console.log('paude name <url> <name>');
		else if (await nameServer(normalizeUrl(target), name)) console.log(`${normalizeUrl(target)} shows as "${name}".`);
		else console.log(`Not logged in to ${normalizeUrl(target)}.`);
	} else if (command === 'stop') {
		console.log((await stopLocalServer()) ? "Stopped this machine's paude." : "This machine's paude isn't running.");
	} else if (command === 'doctor') await doctor();
	else if (command === 'add') await add(target);
	else if (command === 'remove') await remove(target);
	else if (command === 'serve') await serve(process.argv.slice(3));
	else if (command === 'web') await web(target);
	else if (command === 'logout') await logout(target);
	else if (command === 'help' || command === '--help') console.log(USAGE);
	else await run();
} catch (error) {
	console.error(error.message);
	process.exitCode = 1;
} finally {
	process.exit();
}
