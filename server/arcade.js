import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';

import pkg from '../package.json';
import readJsonFile from '../shared/readJsonFile';
import { READING } from '../shared/arcade';
import writeJsonFile from '../shared/writeJsonFile';
import { statusOf } from './activity';
import { askClaude } from './claudeInbox';
import { projectPath } from './projects';
import { serverSettings } from './serverSettings';
import { sessionEnvironment } from './sessions/PtySession';
import { sessionTimeline } from './timeline';
import gitEnvironment from './utils/gitEnvironment';

// What marks a project as an arcade game, kept in it: who it's for and how they read, and where it's shelved
const MARKER = '.paude-arcade.json';
const SNAPSHOT = 'turn: ';
const SNAPSHOT_WORDS = 72;
const SHELF_PORTS = [3100, 3999];
const SHELF_TIMEOUT_MS = 5 * 60 * 1000;

// An arcade project: a game made from web-game-framework's scaffold, in a folder of its own under the projects root,
// with a file telling Claude it's building the game with a kid who may not read yet. Its session is an ordinary one;
// the arcade page (client/Arcade) is what the kid sees of it.

const NAME_LENGTH = 60;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
// How long a new session is watched for Claude's trust question about its folder
const TRUST_WAIT_MS = 90_000;
const TRUST_POLL_MS = 500;
const TRUST_QUESTION = /Is this a project you created or one you trust/;
const TRUST_YES = /Yes, I trust this folder/;
// Down is pressed at most this often before giving up, so a dialog that never moves is never answered
const TRUST_PRESSES = 6;

// What Claude may do in the game without asking: read anything in it (the libraries' docs under node_modules
// included), change its files, look around with the shell's read-only commands, and run what checks and builds it.
// Anything that reaches out or destroys is refused outright. What's left between is auto mode's to answer, and the
// rare question it still asks is shown to the owner alone: a kid's session must not stop on one.
export const claudeSettings = {
	permissions: {
		// Auto mode, as a session of the owner's runs: its classifier answers what the allow list doesn't, so nothing
		// waits on a grown-up for a routine command; the deny list still holds whatever it would allow
		defaultMode: 'auto',
		allow: [
			'Read',
			'Glob',
			'Grep',
			'Edit',
			'Write',
			'MultiEdit',
			'Bash(ls *)',
			'Bash(cat *)',
			'Bash(head *)',
			'Bash(tail *)',
			'Bash(wc *)',
			'Bash(grep *)',
			'Bash(rg *)',
			'Bash(find *)',
			'Bash(sed -n *)',
			'Bash(tree *)',
			'Bash(mkdir *)',
			'Bash(bun test*)',
			'Bash(bun run *)',
			'Bash(bun build*)',
			'Bash(bun -e *)',
			'Bash(git status*)',
			'Bash(git diff*)',
			'Bash(git log*)',
			'Bash(git show*)',
			'Bash(git add*)',
			'Bash(git commit*)',
		],
		deny: [
			'Bash(rm -rf *)',
			'Bash(sudo *)',
			'Bash(curl *)',
			'Bash(wget *)',
			'Bash(git push*)',
			'Bash(git reset --hard*)',
			'WebFetch',
		],
	},
};

export { READING };

export class ArcadeError extends Error {}

// The game's folder (and package) name from what it's called
export const folderName = name =>
	String(name)
		.toLowerCase()
		.replace(/['’]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)
		.replace(/-+$/, '') || 'game';

// Where the framework and its scaffold come from: a checkout named by PAUDE_GAME_FRAMEWORK, which the games then
// depend on by path (for working on the scaffold itself), or the package paude installs, which the games pin as
// paude does
const framework = () => {
	const checkout = process.env.PAUDE_GAME_FRAMEWORK;

	if (checkout) return { module: join(checkout, 'bin/new-game.js'), spec: `file:${checkout}` };

	return {
		module: '@fatlard1993/web-game-framework/new-game',
		spec: pkg.dependencies['@fatlard1993/web-game-framework'],
	};
};

const WRITING = {
	listening: [
		'They cannot read yet. The page reads everything you write aloud, so write to be heard: one short sentence at a time, two or three sentences at most, in the words a five-year-old uses. No lists, no headings, no code, no file names, no links, no markdown of any kind.',
		'Choices have two or three options. Each label is an emoji, then one to three words.',
	],
	learning: [
		'They are learning to read. The page reads what you write aloud and shows it big, so keep to short, common words and one sentence per line, four lines at most. No code, no file names, no links. Bold a word only to make it the one that matters.',
		'Choices have two to four options. Each label is an emoji, then two to five words.',
	],
	reading: [
		'They read on their own. Plain short sentences, a few lines at most, no code unless they ask to see it. A file name only when they ask where something is.',
		'Choices have two to four options. Each label is an emoji, then a few words.',
	],
};

// What Claude is told, in the project's CLAUDE.local.md: who it's building with and how to talk with them. The code's
// conventions are the scaffold's own CLAUDE.md.
export const arcadeInstructions = ({ title, player, reading }) =>
	[
		`# Building ${title} together`,
		'',
		`You are making this game with ${player || 'a kid'}, who is young. They decide what the game is and what happens next; you do all the building. A grown-up who owns this paude may write in the same conversation now and then; follow what they say.`,
		'',
		'## The game is already running',
		'',
		'The game\'s server runs under paude as the project\'s `dev` task, and the kid sees the game live beside this conversation: it rebuilds and reloads itself every time you save a file. Never start, stop or restart it, and never run `bun run dev` yourself. "Show me" means say in a line what to look at or tap in the game they already see. If the game looks broken, fix the file; paude restarts the server itself if it ever dies.',
		'',
		'## Every turn',
		'',
		'1. Do one thing they can see in the game, and keep the game running: the page reloads itself when you save.',
		'2. Say what changed, in a line.',
		'3. Ask what should happen next with the AskUserQuestion tool, one question, and offer two to four real choices about the game (what it looks like, what happens, what is in it), never about code or files. Do not offer "show me" (the game is always on their screen, beside you) or "my idea" (they can always talk or type to you); every choice is a real thing the game could do.',
		'',
		'## How to write',
		'',
		...WRITING[reading],
		'The labels of your choices are read aloud and shown as big buttons, so the emoji comes first and the words stay few.',
		'Decide every technical question yourself, without asking. Never explain how the code works unless they ask. Celebrate in a few words when something works; do not gush.',
		'',
		'## Keep it safe and small',
		'',
		'Work only inside this project. Do not install new packages unless the game truly needs one, and then say so in a word. Make small changes so each is seen within a minute. If something breaks, fix it quietly and say what you did in a line.',
		'',
		'## Tools',
		'',
		"Read files with the Read tool, find things with Grep and Glob, and change files with Edit and Write, never through shell commands or scripts: those tools run without asking, while a shell command beyond bun test, bun run, bun build and git status, diff, log, add and commit stops everything until a grown-up answers a question the kid cannot see. The libraries' docs are files too: read them with Read.",
		'',
	].join('\n');

// The first thing Claude is asked, when the session starts
export const openingPrompt = ({ title, player }) =>
	`Say hello to ${player || 'the kid you are building with'}. The game is called "${title}". Ask what it should be about, offering a few ideas as choices.`;

const exists = async path => Boolean(await stat(path).catch(() => null));

const run = async (command, cwd, onOutput, { env = sessionEnvironment(), timeout } = {}) => {
	const child = Bun.spawn(command, { cwd, env, stdin: 'ignore', stdout: 'pipe', stderr: 'pipe', timeout });
	const relay = async stream => {
		for await (const chunk of stream) onOutput(new TextDecoder().decode(chunk));
	};

	await Promise.all([relay(child.stdout), relay(child.stderr)]);

	return child.exited;
};

const git = (folder, args) =>
	run(['git', ...args], folder, () => {}, { env: gitEnvironment() }).then(code => code === 0);

// Make the game: the scaffold copied into a new folder under the projects root, Claude's instructions written beside
// it, its libraries installed (what that prints goes to onOutput), and the first commit made. { folder, name }
export const createArcadeProject = async ({ name, player, reading }, onOutput = () => {}) => {
	const title = String(name ?? '')
		.trim()
		.slice(0, NAME_LENGTH);

	if (!title) throw new ArcadeError('Name the game.');
	if (!(reading in READING)) throw new ArcadeError(`Say how well they read: ${Object.keys(READING).join(', ')}.`);

	const folder = projectPath(folderName(title));

	if (!folder) throw new ArcadeError(`${folderName(title)} can't be a project here.`);
	if (await exists(folder)) throw new ArcadeError(`There's already a project called ${folderName(title)}.`);

	const { module, spec } = framework();
	const { newGame } = await import(module).catch(() => {
		throw new ArcadeError(
			"The game framework isn't installed here: bun install in paude, or name a checkout in PAUDE_GAME_FRAMEWORK.",
		);
	});

	onOutput(`Making ${folderName(title)} from the game scaffold\n`);
	await newGame(folder, {
		name: folderName(title),
		framework: spec,
		vbc: pkg.dependencies['@vanilla-bean/components'],
	});
	await writeFile(
		join(folder, 'CLAUDE.local.md'),
		arcadeInstructions({
			title,
			player: String(player ?? '')
				.trim()
				.slice(0, 40),
			reading,
		}),
	);
	await mkdir(join(folder, '.claude'), { recursive: true });
	await writeFile(join(folder, '.claude', 'settings.json'), `${JSON.stringify(claudeSettings, null, '\t')}\n`);
	await writeJsonFile(join(folder, MARKER), () => ({
		title,
		player: String(player ?? '')
			.trim()
			.slice(0, 40),
		reading,
		made: new Date().toISOString(),
	}));

	onOutput('Installing its libraries\n');

	const installed = await run([process.execPath, 'install'], folder, onOutput, { timeout: INSTALL_TIMEOUT_MS });

	if (installed !== 0) throw new ArcadeError('The libraries could not be installed; the folder is there to look at.');

	onOutput('Making the first commit\n');
	await git(folder, ['init', '-q']);
	await git(folder, ['add', '-A']);
	// With no identity set up here, the commit is paude's
	(await git(folder, ['commit', '-q', '-m', `${title}: a new game from the scaffold`])) ||
		(await git(folder, [
			'-c',
			'user.name=paude',
			'-c',
			'user.email=paude@localhost',
			'commit',
			'-q',
			'-m',
			`${title}: a new game from the scaffold`,
		]));

	return { folder, name: folderName(title) };
};

const screenLines = session => {
	const buffer = session.mirror.buffer.active;
	const lines = [];

	for (let y = 0; y < buffer.length; y++) lines.push(buffer.getLine(y)?.translateToString(true) ?? '');

	return lines;
};

// The first Claude in a folder asks whether to trust it, on its screen, with nothing a hook reports and no numbered
// answer the dialog reader could offer. A folder paude made from the scaffold is trusted by construction, so the
// question is answered here: Down until the cursor is on "Yes", and only then Enter, since an Enter that lands while
// the cursor still sits on the default, "No, exit", ends the session. Resolves to whether it was answered.
export const acceptTrust = async (session, { waitMs = TRUST_WAIT_MS, pollMs = TRUST_POLL_MS } = {}) => {
	const until = Date.now() + waitMs;
	let pressed = 0;

	while (Date.now() < until) {
		if (session.ended) return false;

		const lines = screenLines(session);
		const asking = lines.some(line => TRUST_QUESTION.test(line)) && lines.some(line => TRUST_YES.test(line));

		if (asking) {
			if (lines.some(line => /^\s*❯/.test(line) && TRUST_YES.test(line))) {
				session.typeIn('\r');

				return true;
			}
			if (pressed >= TRUST_PRESSES) return false;
			session.typeIn('\x1b[B');
			pressed += 1;
		}
		await Bun.sleep(pollMs);
	}

	return false;
};

// The arcade a folder is, from its marker: { title, player, reading, made, shelf? }, or null for an ordinary project
export const arcadeOf = async cwd => {
	if (!cwd) return null;

	const marker = await readJsonFile(join(cwd, MARKER), null).catch(() => null);

	return marker && typeof marker === 'object' && marker.reading in READING ? marker : null;
};

const gitOut = async (folder, args) => {
	const child = Bun.spawn(['git', ...args], {
		cwd: folder,
		env: gitEnvironment(),
		stdin: 'ignore',
		stdout: 'pipe',
		stderr: 'pipe',
	});
	const [out, err] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text()]);

	return { ok: (await child.exited) === 0, out: out.trim(), err: err.trim() };
};

const asPaude = ['-c', 'user.name=paude', '-c', 'user.email=paude@localhost'];

// After each of Claude's turns in an arcade, what the turn left in the game is committed as one snapshot named for
// what was asked, so "put it back" has something to put back and the parent can read the game's history as the
// kid's asks. A turn Claude committed itself, or that changed nothing, leaves no snapshot. Resolves to the subject,
// or null.
export const snapshotTurn = async (sessionId, cwd) => {
	if (!(await arcadeOf(cwd))) return null;

	await gitOut(cwd, ['add', '-A']);
	if ((await gitOut(cwd, ['diff', '--cached', '--quiet'])).ok) return null;

	const [latest] = (await sessionTimeline(sessionId, cwd).catch(() => ({ turns: [] }))).turns;
	const asked = String(latest?.prompt ?? '')
		.replace(/\s+/g, ' ')
		.trim()
		.slice(0, SNAPSHOT_WORDS);
	const subject = `${SNAPSHOT}${asked || 'a change'}`;
	const committed = await gitOut(cwd, [...asPaude, 'commit', '-q', '-m', subject]);

	return committed.ok ? subject : null;
};

// The last snapshot undone: the game goes back to how it was before that turn, as a new commit, so nothing is lost
// and it can be put forward again by hand. Refused while Claude is working (its edits would land on the revert) and
// when the newest commit isn't a snapshot (Claude's own commit, or the scaffold's first). { undone } or throws.
export const undoLastTurn = async (sessionId, cwd) => {
	if (!(await arcadeOf(cwd))) throw new ArcadeError('This is not an arcade game.');
	if (statusOf(sessionId) === 'working') throw new ArcadeError('Claude is still working. Wait for it to finish.');

	const head = await gitOut(cwd, ['log', '-1', '--format=%s']);

	if (!head.ok || !head.out.startsWith(SNAPSHOT)) throw new ArcadeError("There is nothing of Claude's to put back.");
	if ((await gitOut(cwd, ['status', '--porcelain'])).out)
		throw new ArcadeError('Something is half changed. Try again in a moment.');

	const reverted = await gitOut(cwd, [...asPaude, 'revert', '--no-edit', 'HEAD']);

	if (!reverted.ok) {
		await gitOut(cwd, ['revert', '--abort']);
		throw new ArcadeError('It could not be put back cleanly.');
	}

	const undone = head.out.slice(SNAPSHOT.length);

	askClaude(sessionId, {
		prompt: `We put the game back to how it was before your last change ("${undone}"): that change is reverted in git, so read the files again before changing them. Say in one short line that it is back the way it was, then ask what to do next.`,
	});

	return { undone };
};

// The house shelf: a command this paude is given (server.json: { "arcade": { "shelf": "shelf-game {name} {port}" } })
// that makes a finished game one of the house's own, run in the game's folder with {name}, {path} and {port} filled
// in (and in PAUDE_SHELF_NAME, PAUDE_SHELF_PATH, PAUDE_SHELF_PORT). The port is picked once, free in the arcade's
// range, and kept in the marker, so shelving again (after more building) keeps the game's address.
export const shelfCommand = async () => {
	const { arcade = {} } = await serverSettings();

	return typeof arcade.shelf === 'string' && arcade.shelf.trim() ? arcade.shelf.trim() : null;
};

const portFree = port => {
	try {
		Bun.listen({ hostname: '0.0.0.0', port, socket: { data() {} } }).stop(true);

		return true;
	} catch {
		return false;
	}
};

const pickPort = () => {
	const [from, to] = SHELF_PORTS;

	for (let tries = 0; tries < 200; tries++) {
		const port = from + Math.floor(Math.random() * (to - from + 1));

		if (portFree(port)) return port;
	}
	throw new ArcadeError('No free port for the shelf.');
};

export const shelveGame = async (cwd, name, onOutput = () => {}) => {
	const marker = await arcadeOf(cwd);

	if (!marker) throw new ArcadeError('This is not an arcade game.');

	const command = await shelfCommand();

	if (!command) throw new ArcadeError('This paude has no shelf: set arcade.shelf in ~/.config/paude/server.json.');

	const port = marker.shelf?.port ?? pickPort();
	const filled = command.replaceAll('{name}', name).replaceAll('{path}', cwd).replaceAll('{port}', String(port));

	onOutput(`${filled}\n`);

	const code = await run(['sh', '-c', filled], cwd, onOutput, {
		env: { ...sessionEnvironment(), PAUDE_SHELF_NAME: name, PAUDE_SHELF_PATH: cwd, PAUDE_SHELF_PORT: String(port) },
		timeout: SHELF_TIMEOUT_MS,
	});

	if (code !== 0) throw new ArcadeError(`The shelf command ended with ${code}.`);

	await writeJsonFile(join(cwd, MARKER), () => ({ ...marker, shelf: { port, at: new Date().toISOString() } }));

	return { port };
};
