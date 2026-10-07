#!/usr/bin/env bun

import os from 'os';
import path from 'path';

import Argi from 'argi';

import { ensureLocalToken, initAuth, initServerId, passwordIsSet } from './auth';
import { initActivity } from './activity';
import { curlMissing, loadHookSecret, setHookAddress } from './hookSettings';
import { initNames } from './names';
import { initNotes } from './notes';
import { initProjects, setProjectsRoot } from './projects';
import { sweepCredentials } from './sessions/attachSocket';
import { sweepSideShells } from './sessions/sideShell';
import { setHolderFolder } from './sessions/holder';
import { adoptHeldSessions, runningSession, setClaudePath } from './sessions/running';
import { startPreview } from './preview';
import { initShares, onSharesChange, watchShares } from './shares';
import { initTasks, onRunsChange } from './tasks';
import { initLinks } from './links';
import { setPreviewPort } from './router/shares';
import server, { spawnBuild } from './server';

import './exit';

const { options } = new Argi({
	options: {
		projects: {
			type: 'string',
			defaultValue: path.join(os.homedir(), 'Projects'),
			description: 'Folder whose subfolders are the projects sessions can run in',
		},
		host: {
			type: 'string',
			alias: 'h',
			defaultValue: '127.0.0.1',
			description: 'Address to listen on; put HTTPS (e.g. Caddy) in front rather than exposing this directly',
		},
		claude: {
			type: 'string',
			defaultValue: 'claude',
			description: 'Claude Code executable each session runs',
		},
		data: {
			type: 'string',
			defaultValue: path.join(os.homedir(), '.paude'),
			description: 'Where logins and collaborator notes are kept',
		},
		port: {
			type: 'number',
			alias: 'p',
			defaultValue: 8044,
		},
		'preview-port': {
			type: 'number',
			description: 'Where shared services and files are served, a separate origin from paude (default: --port + 1)',
		},
	},
});

if (process.env.NODE_ENV === 'development') console.log('Options', options);

setProjectsRoot(options.projects);
await initAuth(options.data, { watchForChanges: true });
await initNotes(options.data);
await initNames(options.data);
await initActivity(options.data);
await initProjects(options.data);
await ensureLocalToken(options.data);
await initServerId(options.data);
await Bun.write(path.join(options.data, 'server.pid'), `${process.pid}\n`);
// Where set-password finds this server, to change the password through it rather than behind its back
await Bun.write(path.join(options.data, 'server-url'), `http://${options.host}:${options.port}\n`);
await loadHookSecret(options.data);
setHookAddress({ host: options.host, port: options.port });
if (curlMissing()) console.warn("curl isn't installed, so sessions can't report working, needs you or ready.");

if (!passwordIsSet()) {
	console.warn(
		'No password set: only this machine logs in (the paude command, and paude web for a browser). For logins from elsewhere, run: bun run set-password',
	);
}
setClaudePath(options.claude);
setHolderFolder(path.join(options.data, 'held'));
await adoptHeldSessions();

server.init({ host: options.host, port: options.port, data: options.data });

const previewPort = options['preview-port'] ?? options.port + 1;

await initShares(options.data, { reserved: [options.port, previewPort] });
await initTasks(options.data);
await initLinks(options.data);
onRunsChange((sessionId, runs) => runningSession(sessionId)?.broadcast({ type: 'runs', runs }));
setPreviewPort(previewPort);
startPreview({ host: options.host, port: previewPort });
watchShares();
// A session's shares changing reaches whoever has it open
onSharesChange((sessionId, shares) => runningSession(sessionId)?.broadcast({ type: 'shares', shares }));
setInterval(() => {
	sweepCredentials();
	sweepSideShells();
}, 30_000).unref();

if (process.env.NODE_ENV === 'development') {
	try {
		for await (const line of console) {
			if (['stop', 'close', 'exit'].includes(line)) process.kill(process.pid, 'SIGTERM');
			else if (line === 'b') {
				console.log('>> Building...');
				spawnBuild(options.data);
			}
		}
	} catch (error) {
		console.error('Build Error', error);
	}
}
