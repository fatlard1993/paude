import { existsSync } from 'fs';
import { mkdtemp } from 'fs/promises';
import os from 'os';
import path from 'path';
import { afterAll, beforeAll, expect, test } from 'bun:test';

import { initActivity } from '../activity';
import { heldSessions, isHeld, setHolderFolder } from './holder';
import PtySession from './PtySession';

const FAKE_CLAUDE = path.join(import.meta.dir, 'fixtures', 'fake-claude.js');
const until = async (check, ms = 5000) => {
	for (const deadline = Date.now() + ms; Date.now() < deadline; await Bun.sleep(25)) if (await check()) return true;

	return false;
};

let cwd;

beforeAll(async () => {
	cwd = await mkdtemp(path.join(os.tmpdir(), 'paude-held-'));
	await initActivity(cwd);
	setHolderFolder(path.join(cwd, 'held'));
});

afterAll(() => setHolderFolder(null));

test.skipIf(!Bun.which('dtach'))(
	'a held session outlives the server holding it, and the next server takes it back',
	async () => {
		const id = crypto.randomUUID();
		const first = new PtySession({ id, cwd, claudePath: FAKE_CLAUDE });

		expect(await until(() => first.title === 'Fake session')).toBe(true);

		// The server goes away: its client of the session dies, Claude doesn't
		first.process.kill();
		await first.process.exited;
		expect(isHeld(id)).toBe(true);
		expect((await heldSessions()).map(held => held.id)).toContain(id);

		const output = [];
		const second = new PtySession({ id, cwd, claudePath: FAKE_CLAUDE, adopt: true });

		second.attach(
			{ send: message => output.push(message), close: () => {} },
			{ kind: 'web', role: 'owner', cols: 100, rows: 30 },
		);
		second.input([...second.clients][0], 'still here\r');
		expect(
			await until(() =>
				output.some(chunk => typeof chunk !== 'string' && new TextDecoder().decode(chunk).includes('echo: still here')),
			),
		).toBe(true);

		// Ending it ends Claude, so nothing is left held
		second.end();
		await second.process.exited;
		expect(await until(() => !isHeld(id))).toBe(true);
		expect(await until(async () => !(await heldSessions()).some(held => held.id === id))).toBe(true);
		expect(await until(() => !existsSync(path.join(cwd, 'held', `${id}.json`)))).toBe(true);
	},
);
