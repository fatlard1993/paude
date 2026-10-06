#!/usr/bin/env bun

import os from 'os';
import path from 'path';

import Argi from 'argi';

import { initAuth, passwordIsSet } from './auth';
import { initNotes } from './notes';
import { setProjectsRoot } from './projects';
import { sweepCredentials } from './sessions/attachSocket';
import { setClaudePath } from './sessions/running';
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
	},
});

if (process.env.NODE_ENV === 'development') console.log('Options', options);

setProjectsRoot(options.projects);
await initAuth(options.data, { watchForChanges: true });
await initNotes(options.data);

if (!passwordIsSet()) console.warn('No password set, so nobody can log in. Run: bun run set-password');
setClaudePath(options.claude);

server.init({ host: options.host, port: options.port });
setInterval(sweepCredentials, 30_000).unref();

if (process.env.NODE_ENV === 'development') {
	try {
		for await (const line of console) {
			if (['stop', 'close', 'exit'].includes(line)) process.kill(process.pid, 'SIGTERM');
			else if (line === 'b') {
				console.log('>> Building...');
				spawnBuild();
			}
		}
	} catch (error) {
		console.error('Build Error', error);
	}
}
