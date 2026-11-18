import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import os from 'os';
import { join } from 'path';
import { afterAll, afterEach, beforeAll, beforeEach, expect, test } from 'bun:test';

import { UpdateError, initSelfUpdate, startUpdate, updateState } from './selfUpdate';

const SERVICE = {
	linux: '.config/systemd/user/paude.service',
	darwin: 'Library/LaunchAgents/com.github.fatlard1993.paude.plist',
};

let base;
let origin;
let app;
let data;
const kept = {};

const sh = async (command, cwd) => {
	const child = Bun.spawn(['sh', '-c', command], { cwd, stdout: 'pipe', stderr: 'pipe' });

	if ((await child.exited) !== 0) throw new Error(await new Response(child.stderr).text());

	return (await new Response(child.stdout).text()).trim();
};

const commit = (message, cwd) =>
	sh(
		`git -c user.name=t -c user.email=t@t commit -q --allow-empty -m "${message}" && git push -q 2>/dev/null || true`,
		cwd,
	);

const finished = async () => {
	for (let tries = 0; tries < 100; tries += 1) {
		const state = await updateState();

		if (!state.running) return state;
		await Bun.sleep(50);
	}

	throw new Error('The update never finished');
};

beforeAll(async () => {
	base = await mkdtemp(join(os.tmpdir(), 'paude-update-'));
	kept.nodeEnv = process.env.NODE_ENV;
});

beforeEach(async () => {
	origin = join(base, `origin-${Date.now()}`);
	app = join(base, `app-${Date.now()}`);
	data = join(base, `data-${Date.now()}`);
	await mkdir(data);
	await sh(`git init -q --bare -b main "${origin}" && git clone -q "${origin}" "${app}" 2>/dev/null`, base);
	await mkdir(join(app, 'scripts'));
	// The installer stand-in says what it was handed, and pulls as the real one does
	await writeFile(
		join(app, 'scripts', 'install.sh'),
		'echo "> app $PAUDE_APP port $PAUDE_PORT env ${NODE_ENV:-none}"\nsleep ${SLOW:-0}\ngit pull -q --ff-only\nexit ${FAIL:-0}\n',
	);
	await chmod(join(app, 'scripts', 'install.sh'), 0o755);
	await sh(
		'git add -A && git -c user.name=t -c user.email=t@t commit -q -m first && git push -q -u origin main 2>/dev/null',
		app,
	);

	await mkdir(join(base, SERVICE[process.platform], '..'), { recursive: true });
	await writeFile(join(base, SERVICE[process.platform]), `WorkingDirectory=${app}\n`);
	process.env.NODE_ENV = 'production';
	initSelfUpdate({ app, data, projects: join(base, 'Projects'), port: 9123, home: base });
});

afterEach(() => {
	delete process.env.FAIL;
	delete process.env.SLOW;
});

afterAll(async () => {
	process.env.NODE_ENV = kept.nodeEnv;
	await rm(base, { recursive: true, force: true });
});

test('a checkout run in development, or a paude no service runs, is not updated from here', async () => {
	process.env.NODE_ENV = 'development';
	expect((await updateState()).kind).toBe('development');

	process.env.NODE_ENV = 'production';
	await writeFile(join(base, SERVICE[process.platform]), 'WorkingDirectory=/somewhere/else\n');
	expect((await updateState()).kind).toBe('manual');
	expect(startUpdate()).rejects.toThrow(UpdateError);
});

test('an installed paude says what it would pull, and the installer brings it in', async () => {
	expect(await updateState({ fresh: true })).toMatchObject({ kind: 'installed', running: false, behind: 0 });

	const elsewhere = join(base, `elsewhere-${Date.now()}`);

	await sh(`git clone -q "${origin}" "${elsewhere}" 2>/dev/null`, base);
	await commit('the second', elsewhere);
	await commit('the third', elsewhere);

	const behind = await updateState({ fresh: true });

	expect(behind.behind).toBe(2);
	expect(behind.incoming.map(({ subject }) => subject)).toEqual(['the third', 'the second']);

	await startUpdate();

	const done = await finished();

	expect(done).toMatchObject({ behind: 0, last: { exit: 0 } });
	expect(done.last.log).toBe(`> app ${app} port 9123 env none`);
	expect(done.head).toBe((await sh('git rev-parse HEAD', elsewhere)).slice(0, 7));
	expect(await readFile(join(data, 'update.pid'), 'utf8').catch(() => null)).toBeNull();
});

test("a failed run says so, and one already running isn't started again", async () => {
	process.env.FAIL = '3';
	process.env.SLOW = '0.5';
	await startUpdate();
	expect(startUpdate()).rejects.toThrow('already running');

	expect((await finished()).last.exit).toBe(3);
});
