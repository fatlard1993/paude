import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { basename, join } from 'path';

import pkg from '../package.json';
import readJsonFile from '../shared/readJsonFile';
import { READING } from '../shared/arcade';
import writeJsonFile from '../shared/writeJsonFile';
import { statusOf } from './activity';
import { askClaude } from './claudeInbox';
import { listProjects, projectOf, projectPath } from './projects';
import { sessionEnvironment } from './sessions/PtySession';
import { feedFrom } from './feed';
import { HubError, hostGame, hostingOf, recordHosting } from './motherHub';
import { transcriptLines } from './sessions/transcript';
import gitEnvironment from './utils/gitEnvironment';

// What marks a project as an arcade game, kept in it: who it's for and how they read, and where it's shelved
const MARKER = '.paude-arcade.json';
// Claude's rules for the game, paude's to rewrite whenever Claude starts there; CLAUDE.local.md imports it and is
// the person's to add to
const RULES = '.paude-arcade.md';
const RULES_IMPORT = `@./${RULES}`;
const LOCAL_STUB = `${RULES_IMPORT}\n\n<!-- paude rewrites ${RULES} from ${MARKER} whenever Claude starts here. Add your own notes for Claude below. -->\n`;
const SNAPSHOT = 'turn: ';
const SNAPSHOT_WORDS = 72;

// An arcade project: a game made from web-game-framework's scaffold, in a folder of its own under the projects root,
// with a file telling Claude who it's building the game with and how they read. Its session is an ordinary one; the
// arcade page (client/Arcade) is what the person building sees of it.

const NAME_LENGTH = 60;
// The idea a game starts from, as rough or detailed as the person cares to write
const IDEA_LENGTH = 4000;
// How much of the idea opens the game's README and manifest, until Claude writes it a proper one
const FACE_DESCRIPTION_LENGTH = 300;
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;
// How long a new session is watched for Claude's trust question about its folder
const TRUST_WAIT_MS = 90_000;
const TRUST_POLL_MS = 500;
const TRUST_QUESTION = /Is this a project you created or one you trust/;
const TRUST_YES = /Yes, I trust this folder/;
// Down is pressed at most this often before giving up, so a dialog that never moves is never answered
const TRUST_PRESSES = 6;

// What Claude works under in a game: auto mode, its classifier answering whatever the allow list doesn't, the deny list
// holding what would reach past the game (root, a push, history rewritten, the disk wiped). No one sits at an arcade
// to answer a permission prompt, so any that would still appear is turned back at once by a hook, with word to find
// another way, and the turn carries on; Claude's own questions to the person aren't permission prompts and pass.
const PROMPTS_ANSWERED = '^(?!AskUserQuestion$|ExitPlanMode$).*';
const TURNED_BACK = JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'PermissionRequest',
		decision: {
			behavior: 'deny',
			message:
				'Nobody here answers permission prompts, so this was turned back without asking. Do it another way within the project, or leave it out and carry on.',
		},
	},
});

export const claudeSettings = {
	permissions: {
		defaultMode: 'auto',
		allow: [
			'Read',
			'Glob',
			'Grep',
			'Edit',
			'Write',
			'MultiEdit',
			'WebFetch',
			'WebSearch',
			'Bash(ls *)',
			'Bash(cat *)',
			'Bash(head *)',
			'Bash(tail *)',
			'Bash(wc *)',
			'Bash(grep *)',
			'Bash(rg *)',
			'Bash(find *)',
			'Bash(sed *)',
			'Bash(tree *)',
			'Bash(mkdir *)',
			'Bash(touch *)',
			'Bash(cp *)',
			'Bash(mv *)',
			'Bash(ss *)',
			'Bash(curl *)',
			'Bash(bun *)',
			'Bash(git *)',
		],
		deny: ['Bash(sudo *)', 'Bash(git push*)', 'Bash(git reset --hard*)', 'Bash(rm -rf /*)', 'Bash(rm -rf ~*)'],
	},
	hooks: {
		PermissionRequest: [
			{ matcher: PROMPTS_ANSWERED, hooks: [{ type: 'command', command: `printf '%s' '${TURNED_BACK}'` }] },
		],
	},
};

export { READING };

export class ArcadeError extends Error {}

// What the game is called for now: its name, or while it has none, the first words of the idea, or nothing much
export const workingTitle = ({ name, idea }) => {
	const named = String(name ?? '')
		.trim()
		.slice(0, NAME_LENGTH);

	if (named) return named;

	const words = String(idea ?? '')
		.trim()
		.split(/\s+/)
		.filter(Boolean)
		.slice(0, 4)
		.join(' ')
		.replace(/[.,;:!?]+$/, '');

	return words ? words.slice(0, NAME_LENGTH) : 'New game';
};

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
		'They take in what you write by ear: the page reads it all aloud, so write to be heard, one short sentence at a time, two or three at most, in everyday words. No lists, no headings, no code, no file names, no links, no markdown of any kind.',
		'Choices have two or three options. Each label is an emoji, then one to three words.',
	],
	learning: [
		'They are learning to read. The page reads what you write aloud and shows it big, so keep to short, common words and one sentence per line, four lines at most. No code, no file names, no links. Bold a word only to make it the one that matters.',
		'Choices have two to four options. Each label is an emoji, then two to five words.',
	],
	reading: [
		'They read on their own. Plain, concise sentences, a few lines at most. Code or a file name when they ask for it or it is the clearest way to say something.',
		'Choices have two to four options. Each label is an emoji, then a few words.',
	],
};

// What Claude is told, in the project's CLAUDE.local.md: who it's building with and how to talk with them. The code's
// conventions are the scaffold's own CLAUDE.md.
// The rules' section on the idea: the one they started with, carried on from; a game under way before any idea was
// recorded, to be read from its files; or none yet, found together first
const ideaSection = ({ idea, underWay }) => {
	if (idea)
		return [
			'## The idea they started with',
			'',
			idea,
			'',
			'This is the brief, in their words, and it comes first: do not swap it for an idea of your own, and do not start with questions. Before you build, harden it:',
			'',
			'1. Read it through and list for yourself every thing it asks for: what you see, what you do, what happens, how you win or lose.',
			'2. Where it is vague or leaves a gap, decide it yourself with the choice they would most likely want. Do not ask about it.',
			'3. Write the hardened version into `IDEA.md` in the project, as a short plain list of what the game has, so the next turns (and a fresh session) build the same game.',
			'4. Then build it, the whole of it, going on from one part to the next without stopping to ask, checking each works before the next. Start with the core of the idea so the game is playable early, then add each remaining part the brief names.',
			'',
			'Only when what the brief describes is in the game do you start asking what should happen next, as below: from then on it is theirs to change as they go. Until then, do not use the questions in "Every turn" below.',
			'',
		];
	if (underWay)
		return [
			'## Already under way',
			'',
			'The game was begun before these rules were written down, so what it is about is in its files: read `Game.js` and `client/Play.js` before changing anything, and carry on from there. Do not start over or ask what the game should be.',
			'',
		];

	return [
		'## Finding the idea first',
		'',
		'There is no idea yet. Find one together before building anything, one question at a time, each with the AskUserQuestion tool and two to four picture choices (the page adds "More ideas" itself):',
		'',
		'1. What they love: a few worlds to pick from, say 🐸 animals, 🚀 space, 🏎️ racing, 🏰 castles, 🌊 the sea, 🍕 food. Pick ones that suit who you are building with; vary them if they ask for more.',
		'2. What they want to do in it: say 🎯 catch things, 🏃 dodge things, 🎨 draw, 🧱 build, 🔍 find what is hidden, 🏁 race.',
		'3. Three game ideas that fit both answers, each a short title with its emoji and one line under it saying what you do, so they can picture it. Each should be something you can have playable within a turn or two.',
		'4. Once one is picked, say the idea back in one short line, then offer a few names for it as choices.',
		'',
		'When the idea and name are settled, write the idea in one or two sentences into "idea" in `.paude-arcade.json` (and the name into "title"), so paude remembers it for you, then build the first thing they can see and carry on as below. If they already know what they want at any step, skip the rest of the steps and go with it.',
		'',
	];
};

export const arcadeInstructions = ({ title, named = true, idea = '', underWay = false, player, reading }) =>
	[
		named ? `# Building ${title} together` : '# Building a game together',
		'',
		`You are building this game with ${player || 'the person here'}. They decide what the game is and what happens next; you do all of the building, and you are trusted to do it well and see it through on your own. The owner of this paude may write in the same conversation now and then; follow what they say.`,
		'',
		...ideaSection({ idea, underWay }),
		...(named
			? []
			: [
					'## It has no name yet',
					'',
					'Once you both know what the game is about, offer a few names as choices, a question like any other. When one is picked, put it in the title of `client/index.html`, on the Start view in `client/Start.js`, as the heading of `README.md` and as "name" and "short_name" in `client/manifest.json` when there is one, and set it as "title" in `.paude-arcade.json`, which is where paude reads the name from.',
					'',
				]),
		'## The game is already running',
		'',
		"The game's server runs under paude as the project's `dev` task and shows live beside this conversation: the server starts over and the page reloads every time you save a file, so a change is live the moment it's saved. If it ever seems to be running old code, save a file the server loads (`Game.js`, `server.js`) again; if it dies, paude starts it again. Keeping it running is yours: don't start a second copy (`bun run dev`), don't stop it, and never ask anyone to restart anything. To see what it does, find its port (`ss -ltnp`, the bun process in this folder) and curl it. \"Show me\" means say in a line what to look at or tap in the game they already see.",
		'',
		"## The game's face",
		'',
		'The first paragraph of `README.md`, under its heading, tells someone who has never seen the game what it is, in one or two plain sentences: the house\'s list of games shows it on the game\'s card. When the game becomes something new (a new goal, a new way to play), rewrite that paragraph to match, and set "description" in `client/manifest.json` to the same words when there is one. Do it in the same turn, without bringing it up.',
		'',
		'## Every turn',
		'',
		'1. Make the change they asked for, the whole of it, and check it works before handing it back: `bun test` passes, the page builds, the server answers. If something breaks, fix it.',
		'2. Say what changed, in a line.',
		'3. Ask what should happen next with the AskUserQuestion tool, one question, and offer two to four real choices about the game (what it looks like, what happens, what is in it), never about code or files. Do not offer "show me" (the game is always on their screen, beside you), "my idea" (they can always talk or type to you) or "more ideas" (the page adds that one itself, and it asks you for a fresh set); every choice is a real thing the game could do.',
		'',
		'## How to write',
		'',
		...WRITING[reading],
		'The labels of your choices are read aloud and shown as big buttons, so the emoji comes first and the words stay few.',
		'Decide every technical question yourself, without asking. Explain how the code works only when they ask. Say so in a few words when something works; do not gush.',
		'',
		'## Working',
		'',
		"Work inside this project, with whatever the job needs: read and edit files, run shell commands, tests and builds, add a package when the game is better for it, curl the running server, look things up on the web. Routine work runs without asking. No one is there to answer a permission prompt: anything that would need one is turned back at once, so when something is refused, find another way to do it within the project and carry on, rather than stopping or asking for help. Don't push or rewrite history: paude keeps every turn as a commit that can be put back, and hosts the game itself.",
		'',
		"The libraries' docs are in `node_modules` (see `CLAUDE.md`): read them before building what the framework or the component library might already do.",
		'',
	].join('\n');

// The first thing Claude is asked, when the session starts
export const openingPrompt = ({ title, named = true, idea = '', player }) => {
	const hello = `Say hello to ${player || 'the person you are building with'}.`;
	const called = named ? `The game is called "${title}".` : 'The game has no name yet.';
	const soFar = String(idea).trim();

	if (!soFar)
		return `${hello} ${called} There is no idea yet: find one together as your rules say, starting by asking what they love, with a few picture choices.${named ? '' : ' Find a name together once the idea is clear.'}`;

	return `${hello} ${called} Their idea, in their words:\n\n${soFar}\n\nThat is the brief: harden it as your rules say, save it to IDEA.md, and build what it describes before asking what should happen next.${named ? '' : ' Offer a few names once what they described is built.'}`;
};

// The next folder free under `base` for a game with no name of its own: base, then base-2, base-3, ...
const freeFolder = async base => {
	for (let n = 1; n < 100; n++) {
		const folder = projectPath(n === 1 ? base : `${base}-${n}`);

		if (folder && !(await exists(folder))) return folder;
	}
	throw new ArcadeError(`No room for another ${base} here.`);
};

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

// Make the game: the scaffold copied into a new folder under the projects root, its marker and paude's files for
// Claude written beside it, its libraries installed (what that prints goes to onOutput), and the first commit made.
// { folder, name }
export const createArcadeProject = async ({ name, idea, player, reading }, onOutput = () => {}) => {
	const named = Boolean(String(name ?? '').trim());
	const title = workingTitle({ name, idea });
	const theIdea = String(idea ?? '')
		.trim()
		.slice(0, IDEA_LENGTH);

	if (!(reading in READING)) throw new ArcadeError(`Say how well they read: ${Object.keys(READING).join(', ')}.`);

	// A named game takes its name's folder, and another of the same name is a mistake; an unnamed one takes the next free
	const folder = named ? projectPath(folderName(title)) : await freeFolder(folderName(title));

	if (!folder) throw new ArcadeError(`${folderName(title)} can't be a project here.`);
	if (await exists(folder)) throw new ArcadeError(`There's already a project called ${folderName(title)}.`);

	const { module, spec } = framework();
	const { newGame } = await import(module).catch(() => {
		throw new ArcadeError(
			"The game framework isn't installed here: bun install in paude, or name a checkout in PAUDE_GAME_FRAMEWORK.",
		);
	});

	onOutput(`Making ${basename(folder)} from the game scaffold\n`);
	// The title and idea become the game's face (its page title, manifest and README), from a scaffold that takes them
	await newGame(folder, {
		name: basename(folder),
		title,
		description: theIdea.replace(/\s+/g, ' ').slice(0, FACE_DESCRIPTION_LENGTH) || undefined,
		framework: spec,
		vbc: pkg.dependencies['@vanilla-bean/components'],
	});
	await writeJsonFile(join(folder, MARKER), () => ({
		title,
		named,
		idea: theIdea,
		player: String(player ?? '')
			.trim()
			.slice(0, 40),
		reading,
		made: new Date().toISOString(),
	}));
	await refreshArcade(folder);

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

	// The hub has it from the start; it builds and starts it there itself
	keepHosted(folder, { delay: 0 });

	return { folder, name: basename(folder) };
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

// Whether a folder is an arcade, for every session summary the universe makes: the marker's presence, remembered a
// little while so a poll doesn't stat every session's folder
const ARCADE_KNOWN_MS = 30_000;
const arcadeKnown = new Map();

export const isArcade = async cwd => {
	if (!cwd) return false;

	const known = arcadeKnown.get(cwd);

	if (known && known.until > Date.now()) return known.is;

	const is = Boolean(await arcadeOf(cwd));

	arcadeKnown.set(cwd, { is, until: Date.now() + ARCADE_KNOWN_MS });

	return is;
};

// The arcade a folder is, from its marker: { title, player, reading, made, hosted? }, or null for an ordinary project
export const arcadeOf = async cwd => {
	if (!cwd) return null;

	const marker = await readJsonFile(join(cwd, MARKER), null).catch(() => null);

	return marker && typeof marker === 'object' && marker.reading in READING ? marker : null;
};

// A game from the scaffold before its server started over on each save: `bun --hot` swaps the code under games already
// running, so a change to their rules never reaches them and the server looks stuck on the old game. Its dev script is
// moved to `bun --watch`, which takes effect the next time the game's server starts.
const HOT = 'bun --hot server.js';

const restartOnSave = async cwd => {
	const file = join(cwd, 'package.json');
	const text = await readFile(file, 'utf8').catch(() => null);

	if (text?.includes(`"dev": "NODE_ENV=development ${HOT}"`))
		await writeFile(file, text.replace(HOT, 'bun --watch server.js'));
};

// Paude's files in a game, written again from its marker: Claude's rules and its permissions, so a game made before
// either changed (or copied from another machine) runs under the current ones each time Claude starts there.
// CLAUDE.local.md imports the rules; one paude wrote whole in an earlier version (its own heading first) is replaced
// by the import, and one with a person's own words keeps them, the import put first. True when `cwd` is an arcade.
export const refreshArcade = async cwd => {
	const marker = await arcadeOf(cwd);

	if (!marker) return false;

	// Past the scaffold's first commit, the game is what its files say, idea recorded or not
	const commits = await gitOut(cwd, ['rev-list', '--count', 'HEAD']);

	await writeFile(
		join(cwd, RULES),
		arcadeInstructions({
			title: marker.title,
			named: marker.named ?? true,
			idea: marker.idea ?? '',
			underWay: commits.ok && Number(commits.out) > 1,
			player: marker.player,
			reading: marker.reading,
		}),
	);
	await mkdir(join(cwd, '.claude'), { recursive: true });
	await writeFile(join(cwd, '.claude', 'settings.json'), `${JSON.stringify(claudeSettings, null, '\t')}\n`);
	await restartOnSave(cwd);

	const local = join(cwd, 'CLAUDE.local.md');
	const current = await readFile(local, 'utf8').catch(() => null);

	if (current === null || current.startsWith('# Building ')) await writeFile(local, LOCAL_STUB);
	else if (!current.includes(RULES_IMPORT)) await writeFile(local, `${RULES_IMPORT}\n\n${current}`);

	return true;
};

// What a snapshot is named for: the last thing the person gave Claude, an answer to its question (a choice's label,
// or words typed into it) or a prompt, whichever came last; 'a change' when nothing is known
export const turnName = entries => {
	const last = entries.findLast(entry => entry.kind === 'answer' || entry.kind === 'prompt');

	return (
		String(last?.text ?? '')
			.replace(/\s+/g, ' ')
			.trim()
			.slice(0, SNAPSHOT_WORDS) || 'a change'
	);
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
// what was asked, so "put it back" has something to put back and the game's history reads as what was
// asked for. A turn Claude committed itself, or that changed nothing, leaves no snapshot. Resolves to the subject,
// or null.
export const snapshotTurn = async (sessionId, cwd) => {
	if (!(await arcadeOf(cwd))) return null;

	// Whatever the turn left (a snapshot here, or a commit Claude made itself), the house's copy follows it
	keepHosted(cwd);

	await gitOut(cwd, ['add', '-A']);
	if ((await gitOut(cwd, ['diff', '--cached', '--quiet'])).ok) return null;

	const entries = await transcriptLines(sessionId, cwd)
		.then(lines => feedFrom(lines, cwd))
		.catch(() => []);
	const subject = `${SNAPSHOT}${turnName(entries)}`;
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

	// What was put back is put back in the house's copy too
	keepHosted(cwd);

	askClaude(sessionId, {
		prompt: `We put the game back to how it was before your last change ("${undone}"): that change is reverted in git, so read the files again before changing them. Say in one short line that it is back the way it was, then ask what to do next.`,
	});

	return { undone };
};

// The game put with the house's games, hosted by the mother hub (motherHub.js): the one this paude is wired to, or its
// own copy. Where it went is kept in the marker, so the arcade page can say. { id, name, port, url }
export const hostArcade = async (cwd, name, onOutput = () => {}, { whenIdle = false, again = false } = {}) => {
	if (!(await arcadeOf(cwd))) throw new ArcadeError('This is not an arcade game.');

	let hosted;

	try {
		hosted = await hostGame(cwd, name, onOutput, { whenIdle, again });
	} catch (error) {
		if (!(error instanceof HubError)) throw error;

		// Forgotten in the hub: paude stops sending it until someone hosts it again on purpose
		if (error.status === 410) await recordHosting(cwd, { ...(await hostingOf(cwd)), state: 'forgotten' });

		throw new ArcadeError(error.message);
	}

	await recordHosting(cwd, {
		id: hosted.id,
		port: hosted.port,
		url: hosted.url ?? null,
		hub: hosted.hub,
		head: hosted.head,
		state: hosted.deferred ? 'waiting' : 'hosted',
	});

	return hosted;
};

// Every arcade game is hosted by the mother hub, without anyone asking: made, it's hosted at once, and as it's built it's
// hosted again once a spell of building has gone quiet for a while (so the house's copy follows a few minutes behind,
// rather than rebuilding under every turn), each time asking the hub to wait while anyone's playing the house's copy. A
// game whose committed state is already the house's is left alone; one forgotten in the hub, until it's hosted again on
// purpose; one busy there, tried again shortly. The timers live on globalThis, so a hot reload doesn't double them.
const HOST_AFTER_QUIET_MS = 10 * 60 * 1000;
const RETRY_BUSY_MS = 2 * 60 * 1000;
const hostTimers = (globalThis.paudeHostTimers ??= new Map());

export const keepHosted = (cwd, { delay = HOST_AFTER_QUIET_MS } = {}) => {
	clearTimeout(hostTimers.get(cwd));
	hostTimers.set(
		cwd,
		setTimeout(async () => {
			hostTimers.delete(cwd);

			const known = await hostingOf(cwd);
			const head = await gitOut(cwd, ['rev-parse', 'HEAD']);

			if (known?.state === 'forgotten' || (known?.state === 'hosted' && head.ok && known.head === head.out)) return;

			try {
				await hostArcade(cwd, projectOf(cwd), () => {}, { whenIdle: true });
			} catch (error) {
				if (/busy/i.test(error.message)) keepHosted(cwd, { delay: RETRY_BUSY_MS });
				else console.warn(`The mother hub didn't host ${cwd}: ${error.message}`);
			}
		}, delay),
	);
};

// At start, the arcade games paude has no record of hosting (made before it hosted them all) are handed to the hub, a
// little apart so they don't all build at once
export const hostUnhosted = async ({ apartMs = 30_000 } = {}) => {
	let delay = apartMs;

	for (const name of await listProjects()) {
		const cwd = projectPath(name);

		if (!cwd || !(await arcadeOf(cwd)) || (await hostingOf(cwd))) continue;

		keepHosted(cwd, { delay });
		delay += apartMs;
	}
};

// The house button's hosting, run on after the request that started it: on purpose, so a game forgotten in the hub comes
// back. While it runs, and what came of it, is what the arcade page shows.
const hostingRuns = (globalThis.paudeHostingRuns ??= new Map());

export const startHosting = (cwd, name) => {
	if (hostingRuns.get(cwd)?.running) return false;

	const run = { running: true, error: null };

	hostingRuns.set(cwd, run);
	hostArcade(cwd, name, () => {}, { again: true })
		.catch(error => (run.error = error.message.split('\n')[0]))
		.finally(() => (run.running = false));

	return true;
};

export const hostingNow = async cwd => ({ ...(await hostingOf(cwd)), ...hostingRuns.get(cwd) });
