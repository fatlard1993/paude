import { mkdir, stat, writeFile } from 'fs/promises';
import { join } from 'path';

import pkg from '../package.json';
import { READING } from '../shared/arcade';
import { projectPath } from './projects';
import { sessionEnvironment } from './sessions/PtySession';
import gitEnvironment from './utils/gitEnvironment';

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

// What Claude may do in the game without asking: change its files, and run what checks and builds them. A command
// beyond these still asks, and the arcade shows that question to the owner.
export const claudeSettings = {
	permissions: {
		defaultMode: 'acceptEdits',
		allow: [
			'Bash(bun test*)',
			'Bash(bun run build*)',
			'Bash(bun run test*)',
			'Bash(git status*)',
			'Bash(git diff*)',
			'Bash(git log*)',
			'Bash(git add*)',
			'Bash(git commit*)',
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
		'## Every turn',
		'',
		'1. Do one thing they can see in the game, and keep the game running: the page reloads itself when you save.',
		'2. Say what changed, in a line.',
		'3. Ask what should happen next with the AskUserQuestion tool, one question, and offer real choices about the game (what it looks like, what happens, what is in it), never about code or files. Always include one option that shows them something ("👀 Show me") and one that lets them say their own idea ("💡 My idea").',
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
