import { existsSync } from 'fs';

import { setPublicUrl } from '../server/serverSettings';
import { LOCAL_URL } from './servers';

// The Mac app carries the command inside its bundle rather than on the PATH
const MAC_APP_BINARY = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';
// Where paude is served on the tailnet, and where its shares are: the same ports Caddy would front, so the server's
// share links need no setting
const PAUDE_PORT = 443;
const PREVIEW_PORT = 8444;
const RUN_TIMEOUT_MS = 20_000;

const binary = () => Bun.which('tailscale') ?? (existsSync(MAC_APP_BINARY) ? MAC_APP_BINARY : null);

const run = (command, args) => {
	const result = Bun.spawnSync([command, ...args], { stdout: 'pipe', stderr: 'pipe', timeout: RUN_TIMEOUT_MS });

	return { ok: result.exitCode === 0, out: result.stdout.toString().trim(), err: result.stderr.toString().trim() };
};

// What tailscale status --json says of this machine: its tailnet name and whether it's connected; null when the status
// says nothing of it (logged out, or not what was asked)
export const parseStatus = text => {
	try {
		const status = JSON.parse(text);
		const name = status.Self?.DNSName?.replace(/\.$/, '');

		return name ? { name, running: status.BackendState === 'Running' } : null;
	} catch {
		return null;
	}
};

// This machine on its tailnet, null without tailscale; `installed` tells the two apart
export const tailnetSelf = () => {
	const command = binary();

	if (!command) return null;

	const status = run(command, ['status', '--json']);

	return { installed: true, ...(status.ok ? parseStatus(status.out) : {}) };
};

// For paude doctor, beside whether tailscale is connected
export const tailnetDetail = (tailnet, publicUrl) => {
	if (!tailnet) return 'install it, then paude tailscale puts this paude on your tailnet with HTTPS';
	if (!tailnet.name) return 'log in to it (tailscale up), then paude tailscale puts this paude on your tailnet';
	if (!tailnet.running)
		return `not connected: tailscale up, then paude tailscale puts this paude at https://${tailnet.name}`;
	if (publicUrl === `https://${tailnet.name}`) return `serving this paude at ${publicUrl}`;

	return `paude tailscale puts this paude at https://${tailnet.name}, with HTTPS`;
};

// Why tailscale wouldn't serve, as what to do about it
const serveFailure = err => {
	if (/https|cert/i.test(err)) {
		return `${err}\nTurn on HTTPS certificates for your tailnet first: https://login.tailscale.com/admin/dns`;
	}
	if (/denied|permission|operator/i.test(err)) {
		return `${err}\nLet your user run tailscale serve: sudo tailscale set --operator=$USER`;
	}

	return err;
};

// paude tailscale: Tailscale Serve fronts this machine's paude on 443 and its shares on 8444, with a certificate for
// the machine's tailnet name, and the server's links carry that address. Off takes both down.
const tailscale = async args => {
	const command = binary();

	if (!command) {
		return console.error(
			"Tailscale isn't installed: https://tailscale.com/download. Then paude tailscale puts this paude on your tailnet with HTTPS.",
		);
	}

	const tailnet = tailnetSelf();

	if (!tailnet.name) return console.error("Tailscale isn't logged in. Run: tailscale up");
	if (!tailnet.running) return console.error("Tailscale isn't connected. Run: tailscale up");

	const url = `https://${tailnet.name}`;

	if (args[0] === 'off') {
		// A port that wasn't being served is already off; anything else tailscale objects to is said, and the links
		// still go back to their own addresses
		for (const port of [PAUDE_PORT, PREVIEW_PORT]) {
			const result = run(command, ['serve', `--https=${port}`, 'off']);

			if (!result.ok) console.error(`Tailscale wouldn't stop serving port ${port}: ${result.err}`);
		}

		await setPublicUrl(null);

		return console.log(`${url} no longer reaches this paude. Links use the address they're made from again.`);
	}

	const port = Number(new URL(LOCAL_URL).port || 80);
	const served = [
		[PAUDE_PORT, port],
		[PREVIEW_PORT, port + 1],
	];

	for (const [from, to] of served) {
		const result = run(command, ['serve', '--bg', `--https=${from}`, `http://127.0.0.1:${to}`]);

		if (!result.ok)
			return console.error(`Tailscale wouldn't serve port ${to} as ${url}:${from}: ${serveFailure(result.err)}`);
	}

	await setPublicUrl(url);

	console.log(`This paude is on your tailnet at ${url}, its shares at ${url}:${PREVIEW_PORT}.`);
	console.log('Invite and share links carry that address now, whichever address they are made from.');
	console.log(`From another machine on the tailnet: paude login ${url}`);
	console.log('To take it down: paude tailscale off');
};

export default tailscale;
