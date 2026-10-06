import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { beforeAll, expect, test } from 'bun:test';

import { initActivity } from '../activity';
import PtySession from './PtySession';

const FAKE_CLAUDE = path.join(import.meta.dir, 'fixtures', 'fake-claude.js');

const socket = () => {
	const sent = [];

	return {
		sent,
		send: message => sent.push(typeof message === 'string' ? JSON.parse(message) : message),
		close: () => {},
	};
};

const until = async (check, ms = 3000) => {
	for (const deadline = Date.now() + ms; Date.now() < deadline; await Bun.sleep(20)) if (check()) return true;

	return false;
};

let cwd;

beforeAll(async () => {
	cwd = await mkdtemp(path.join(os.tmpdir(), 'paude-pty-'));
	await initActivity(cwd);
});

const start = () => {
	const exits = [];
	const session = new PtySession({
		id: crypto.randomUUID(),
		cwd,
		claudePath: FAKE_CLAUDE,
		onExit: () => exits.push(1),
	});

	return { session, exits };
};

test('a joiner gets a snapshot, and the title says when Claude is working', async () => {
	const { session } = start();
	const owner = socket();

	session.attach(owner, { kind: 'web', label: 'laptop', name: 'chase', role: 'owner', cols: 100, rows: 30 });
	expect(await until(() => owner.sent.some(message => message.type === 'snapshot'))).toBe(true);
	expect(await until(() => session.title === 'Fake session')).toBe(true);

	session.input([...session.clients][0], 'work\r');
	expect(await until(() => session.busy)).toBe(true);
	expect(await until(() => !session.busy)).toBe(true);
	expect(owner.sent.some(message => message.type === 'presence' && message.busy)).toBe(true);

	session.process.kill();
});

test("only someone who may type sets the size; a viewer's small terminal doesn't shrink it", async () => {
	const { session } = start();
	const owner = socket();
	const viewer = socket();

	session.attach(owner, { kind: 'terminal', label: 'laptop', role: 'owner', cols: 120, rows: 40 });
	session.attach(viewer, { kind: 'terminal', label: 'phone', role: 'watch', cols: 30, rows: 10 });
	const viewerClient = [...session.clients].find(client => client.role === 'watch');

	session.resize(viewerClient, 20, 5);
	expect([session.cols, session.rows]).toEqual([120, 40]);

	session.process.kill();
});

test('a typed answer clears needs you, and the session ending is reported', async () => {
	const { setStatus, statusOf } = await import('../activity');
	const { session, exits } = start();
	const owner = socket();

	session.attach(owner, { kind: 'web', label: 'laptop', role: 'owner', cols: 100, rows: 30 });
	await setStatus(session.id, 'waiting');
	session.input([...session.clients][0], 'y');
	expect(statusOf(session.id)).toBe('working');

	session.input([...session.clients][0], '\rexit\r');
	expect(await until(() => exits.length === 1)).toBe(true);
});
