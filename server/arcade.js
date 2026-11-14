import { mkdir, readFile, readdir, rm, stat, writeFile } from 'fs/promises';
import { basename, join, resolve } from 'path';

import pkg from '../package.json';
import readJsonFile from '../shared/readJsonFile';
import { READING } from '../shared/arcade';
import writeJsonFile from '../shared/writeJsonFile';
import { statusOf } from './activity';
import { arcadeModeOf } from './arcadeMode';
import { claudeSettings } from './arcadeSettings';
import { askClaude } from './claudeInbox';
import { knownProject, listProjects, projectOf, projectPath } from './projects';
import { ownerName } from './serverSettings';
import { gameSpeechAddress } from './hookSettings';
import { sessionEnvironment } from './sessions/PtySession';
import { voicePerforms, voiceSettings } from './speech';
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
export const SPEECH_FILE = '.paude-speech';
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

export { claudeSettings };

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

// How to write for each way of reading, about the thing being made: the game, or a project brought into the arcade
const WRITING = (thing = 'game') => ({
	listening: [
		'They take in what you write by ear: the page reads it all aloud, so write to be heard, one short sentence at a time, two or three at most, in everyday words. No lists, no headings, no code, no file names, no links, no markdown of any kind.',
		`Choices have two or three options. Each label is an emoji, then one to three words. Each option also has a description: two or three short sentences on what picking it changes in the ${thing}, and what they would lose or get, so they can decide yes or no from it alone.`,
	],
	learning: [
		'They are learning to read. The page reads what you write aloud and shows it big, so keep to short, common words and one sentence per line, four lines at most. No code, no file names, no links. Bold a word only to make it the one that matters.',
		`Choices have two to four options. Each label is an emoji, then two to five words. Each option also has a description: two or three short, common-word sentences on what picking it changes in the ${thing}, and what they would lose or get, so they can decide yes or no from it alone.`,
	],
	reading: [
		'They read on their own. Plain, concise sentences, a few lines at most. Code or a file name when they ask for it or it is the clearest way to say something.',
		`Choices have two to four options. Each label is an emoji, then a few words. Each option also has a description of a few sentences: what picking it changes in the ${thing}, and what they would lose or get, enough to decide yes or no from it alone.`,
	],
});

// Choosing what to offer: what the first sessions' players typed past again and again (the same ignored options
// offered a dozen times and more, features stacked on a game that didn't feel right yet, a judgment asked of something
// that wasn't working, a typed answer taken for a glitch)
const choosingSection = thing => [
	'## Choosing what to offer',
	'',
	`- What they type in place of a tap is their answer, in their own words, and the clearest steer you get: act on it. Never take it for a glitch or a mis-tap, and never ask the same question again in place of doing what it says.`,
	`- When their last words were a complaint or a wish, at least one choice answers it. When something felt wrong (slow, confusing, broken), the next choices are about making what's there feel right, before anything new.`,
	`- Drop a choice they've passed over twice; offer something they haven't seen. Fresh choices grow from what they've said they love about the ${thing}, not from a list of usual features.`,
	"- Never ask them to judge something you couldn't confirm works (a sound you couldn't hear play, a page you didn't look at): make sure first, or fix it.",
	'',
];

// Looking before saying it works: the first sessions said "works" from tests and server-only runs while the page
// showed nothing, a slice of the screen, or a game one person alone couldn't start, and each wrote its own browser
// driver to find out
export const lookingSection = ({ thing = 'game' } = {}) => [
	'## Look before you say it works',
	'',
	`Tests and curl say the server is right; only looking says the ${thing} is. After a change they can see, look at the page the way they will, with paude's look tool: it opens the page in a headless Chrome at a phone's size and a computer's, taps and types as you say, saves a screenshot of each, and prints the frame rate, the words on screen and anything that went wrong (console errors, exceptions, failed requests).`,
	'',
	'```sh',
	'bun "$PAUDE_LOOK" http://localhost:<port> --tap "Play" --key ArrowRight --wait 1000 --out <your scratchpad>',
	'```',
	'',
	`Read the screenshots, and fix what's wrong before you hand the turn back. Look as one person alone, as they will often be: what does it say, what can they do? Each \`--size WxH\` adds a screen; more than one player is two looks run side by side.`,
	'',
];

// Small things that tripped the first sessions again and again
const handlingSection = () => [
	'## Handling',
	'',
	'- Stop a process you started by its PID (`kill $pid`, saved when you started it). `pkill -f` matches the shell running your own command and ends it (exit 144).',
	'- Scratch files and screenshots go in your scratchpad, never `/tmp` or the project; clean up what you started before the turn ends.',
	'- Make changes with the Edit tool, after reading the file, rather than scripted find-and-replace, which trips over tabs and quotes.',
	'- Stay inside this project and its libraries unless they point you somewhere else, and even then read only what the job needs: never dump a file that may hold passwords, keys or recovery codes (private notes, `.env`, credentials) to find something in it; search it for the one thing instead.',
	'',
];

// What players asked for over and over in the first arcade games (the screen half used, tools in the wrong place,
// presses at the edge lost, keys that didn't play, a wind no one could see, players who'd left still shown, a README
// gone stale), told up front so no one has to ask again
const feelSection = () => [
	'## What makes it feel good',
	'',
	'Players asked for these over and over in the first games built here; do them from the start rather than waiting to be told:',
	'',
	'- The game takes the whole screen: the play area grows to fill everything below the top bar. Score, level and the buttons that are not part of playing go in the top bar; the tools a player plays with sit right beside the play area.',
	'- A press or drag that starts just outside the play area still counts, held to its edge: fingers miss.',
	"- On a computer the keyboard plays it (arrow keys and WASD to move, space for the main action) and the mouse aims; on-screen touch controls show only on touch devices (`matchMedia('(pointer: coarse)')`).",
	'- Everything that acts on the game is seen acting: wind blows visibly, a current flows, a timer drains. A force a player cannot see is a rule they cannot learn.',
	"- A player whose page closed leaves the table: the framework marks them `online: false` and calls the game's `onPresence(id, online)` (on an older framework, notice they stopped sending), so take their ship out of space or their hand off the board until they are back.",
	'- Saved games (`data/games.json`) outlive changes to the game: when `state` changes shape, a game saved the old way still loads.',
	'- `README.md` says how to play, with the rules as they are now: when a rule changes, the README changes in the same turn.',
	'',
	"A game made from the newer scaffold already does these with the framework's kits (`act` and `enterGame`, `createInput`, `Stage`, `createSound`, `JoinCard`; its `CLAUDE.md` says where): build on them rather than writing your own.",
	'',
];

// When this paude's voice performs cues: Claude acts through the cues the voice takes, in the one voice every game
// shares (which also keeps what it has said reusable from the voice's cache)
const voiceSection = ({ game = true } = {}) => [
	'## Your voice',
	'',
	`Everything you write here is performed aloud by an expressive voice, the same one in every ${game ? 'game' : 'arcade'}: warm, lively and quick to laugh. Write it as a performance, as yourself, not as a character made up for this ${game ? 'game' : 'project'}.`,
	'',
	'Act with cues in square brackets, right before or after the words they color:',
	'',
	'- How it is said: [excited], [whispers], [sarcastic], [curious], [mischievously], [nervously], [shouting], [crying], or a voice like [low, gravelly voice].',
	'- The sounds a person makes: [laughs], [laughs harder], [giggles], [sighs], [gasps], [gulps], [coughs], [clears throat], [snorts].',
	...(game
		? [
				'- Sound effects for what happens in the game: [explosion], [applause], [clapping], [laser zap], [splash], [crowd cheering]; any short description works.',
			]
		: []),
	'',
	`CAPS stress a word, an ellipsis... makes a pause, and an exclamation lifts it. ${game ? 'A cue or two per message, where it lands (a laugh at their joke, a gasp at a big change, a whisper for a secret, an explosion when the bombs go in), makes a performance' : 'This is real work, sometimes about real money or real trouble: a cue now and then where it truly fits (a laugh at their joke), and none over bad news'}; a cue in every sentence makes noise. Only what a voice or the scene would make: no [music], [pacing] or [standing]. When they say something is wrong, take it warmly and set about fixing it: never a sigh, a sarcastic cue or a laugh at them then. The page shows each cue as a small stage direction, so it reads well too. Choice labels stay plain words: no cues in them.`,
	'',
];

// When this paude has an ElevenLabs key: real sounds for the game, made by paude and written into it
const soundsSection = () => [
	'## Sounds for the game',
	'',
	'Give the game real sounds: a laser, a coin, a crash, footsteps, a win fanfare, a looping engine hum. Ask paude and it makes the sound and writes it into the game as an mp3:',
	'',
	'```sh',
	'curl -fsS -X POST "$PAUDE_SOUNDS" -H \'content-type: application/json\' -d \'{"description": "retro 8-bit coin pickup, bright and quick", "seconds": 0.6, "file": "client/sounds/coin.mp3"}\'',
	'```',
	'',
	'- "description" is what it sounds like: what makes it, how it feels, how it ends.',
	'- "seconds" is 0.5 to 10 (1.5 when left out). Game sounds are short: most under a second.',
	'- "loop": true makes one that repeats without a seam, for a music bed or an engine hum.',
	"- Import it where it plays: `import coin from './sounds/coin.mp3'` gives its address once built. Play it through the framework's sound kit when the game has one (`createSound` from `@fatlard1993/web-game-framework/client`: `createSound({ effects: { coin }, music: { level } })`, then `sound.play('coin')`, `sound.music('level')`, and a `SoundToggle` in the bar); on an older framework, an `Audio` per sound, rewound or cloned for overlaps.",
	'',
	'The same request again comes from the cache and costs nothing; every new second of sound is paid for, and a game has 90 new seconds a day. So make the sounds the game needs, keep them short, and reuse them. If the answer says the budget is spent, use the sounds already made.',
	'',
	'Music too: give "music" (what it is: genre, mood, tempo, instruments) in place of "description", and paude composes a track:',
	'',
	'```sh',
	'curl -fsS -X POST "$PAUDE_SOUNDS" -H \'content-type: application/json\' -d \'{"music": "bouncy chiptune for a sunny desert puzzle level, steady mid tempo, square-wave lead, no build-up or ending", "seconds": 60, "file": "client/sounds/level.mp3"}\'',
	'```',
	'',
	'- A track per mood the game has (the menu, a level, a boss, a win), not one per screen. It is instrumental unless you say "instrumental": false.',
	'- "seconds" is 3 to 120 (45 when left out); 30 to 60 loops well. Ask for no intro, build-up or ending, so it loops without a seam.',
	'- Play it on a loop under the game, quiet beside the sounds, started on the first tap (browsers hold sound until then), and let it be turned off: `sound.music(name)` does all of that, crossfading from the track before.',
	'',
	'Music is dear: a game has 120 new seconds of it a day, apart from the sounds, and a track asked for again costs nothing. Make each one count, and reuse it.',
	'',
	"Lines spoken as the game is played (a verse a player wrote, a narrator, a name called out) are said by paude too, for the game's own server, which never holds a key: POST a line to the address in `PAUDE_SPEECH`, or, where that isn't set (the house's copy of the game), the one in the `.paude-speech` file beside it, and the answer is the MP3. Neither is there when this paude has no voice: the game plays on without speech then.",
	'',
	'```js',
	"const address = process.env.PAUDE_SPEECH ?? (await Bun.file('.paude-speech').text().catch(() => '')).trim();",
	"const mp3 = await fetch(address, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice }) });",
	'```',
	'',
	'- "text" is at most 1000 characters; "voice" is an ElevenLabs voice id, paude\'s own voice when left out, so different characters can have different voices. "model" is optional too.',
	"- A line said before in the same voice costs nothing; a game has 20,000 new characters a day. Never ask for, look for or use an ElevenLabs key of the game's own.",
	"- Hand the MP3 to the page to play through the sound kit, which starts on the first tap like the rest of the game's sound.",
	'',
];

// What Claude is told, in the project's CLAUDE.local.md: who it's building with and how to talk with them. The code's
// conventions are the scaffold's own CLAUDE.md.
// The rules' section on the idea: the one they started with, carried on from; a game under way before any idea was
// recorded, to be read from its files; or none yet, found together first
// Its icon: drawn by Claude once the game is something, for the browser's tab and its arcade cabinet in paude's
// universe, which prints it 8 pixels square in three tones of the cabinet's color, so it's made to survive that.
// `has`: whether the page links one yet (null: not a web page, so nothing to say)
export const iconSection = ({ has, page = 'client/index.html' }) =>
	has === null || has === undefined
		? []
		: [
				'## Its icon',
				'',
				`${has ? 'It has an icon' : 'It has no icon yet'}: an SVG beside \`${page}\`, linked from it as \`<link rel="icon" type="image/svg+xml" href="./favicon.svg" />\` (not in \`manifest.json\`'s icons, whose paths the build leaves pointing at a file it renamed). The browser's tab shows it, and so does its arcade cabinet in paude's universe, printed on the cabinet's side. ${has ? 'When the game becomes something else, draw it again to match' : "Draw one in this turn, alongside whatever is asked, once there's a name and a look to go on (its hero, the thing it's about); until then, as soon as there is"}, without bringing it up.`,
				'',
				'Drawn to read in a tab and printed tiny:',
				'',
				'- Square, on a 16 by 16 viewBox, its background clear.',
				'- One bold subject that says the game at a glance; never letters or a word.',
				"- Three values and no more: a dark outline, one main fill in the game's own color (its theme-color), and one light part. The cabinet shrinks it to 8 by 8 pixels and prints each in one of three tones by how light it is, so the shape must hold in those three: a big light part on a mid one, outlined in dark. Thin lines, small details and text vanish.",
				'',
				"This house's: Humanity, a card game, is a black card behind a white one; Sorcery & Savagery, built out from a campfire, is a yellow flame on a green shield.",
				'',
			];

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
			"3. When it names a game it's like, play it the way that game is played: its controls, its pacing, who types or draws what. That outranks the scaffold's own defaults (its picture-only controls among them).",
			"4. Plan for who will try it first: often one person alone in the arcade. Alone, the game says what it's waiting for and how many it needs, and lets them play or practice on their own when the game can be played that way.",
			"5. Give it a look of its own from the first build: colors, type and shapes that fit what it's about, not the component library's plain default.",
			'6. Write the hardened version into `IDEA.md` in the project, as a short plain list of what the game has, so the next turns (and a fresh session) build the same game.',
			'7. Then build it, the whole of it, going on from one part to the next without stopping to ask, checking each works before the next. Start with the core of the idea so the game is playable early, then add each remaining part the brief names. When it is a kind of game everyone knows (a shooter, a racer, a platformer), get its basic feel right first: smooth movement between server updates, a camera that follows, a hit that is felt.',
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

export const arcadeInstructions = ({
	title,
	named = true,
	idea = '',
	underWay = false,
	player,
	reading,
	performs = false,
	sounds = false,
	icon = null,
}) =>
	[
		named ? `# Building ${title} together` : '# Building a game together',
		'',
		`You are building this game with ${player || 'the person here'}. They decide what the game is and what happens next; you do all of the building, and you are trusted to do it well and see it through on your own. The owner of this paude may write in the same conversation now and then; follow what they say. Others may join on their own devices: paude adds a line naming who is in the arcade whenever that changes, so build with whoever is there.`,
		'',
		...ideaSection({ idea, underWay }),
		...(named
			? []
			: [
					'## It has no name yet',
					'',
					'Once you both know what the game is about and it plays well, offer a few names as choices, a question like any other; while something they\'ve said is wrong still stands, fix that first and let the name wait. When one is picked, put it in the title of `client/index.html`, on the Start view in `client/Start.js`, as the heading of `README.md` and as "name" and "short_name" in `client/manifest.json` when there is one, and set it as "title" in `.paude-arcade.json`, which is where paude reads the name from.',
					'',
				]),
		'## The game is already running',
		'',
		"The game's server runs under paude as the project's `dev` task and shows live beside this conversation: the server starts over and the page reloads every time you save a file, so a change is live the moment it's saved. If it ever seems to be running old code, save a file the server loads (`Game.js`, `server.js`) again; if it dies, paude starts it again at the next prompt or question. Keeping it running is yours: don't start a second copy (`bun run dev`), don't stop it, and never ask anyone to restart anything. Its port is between 41000 and 41999 (`ss -ltnp`, the bun process in this folder); curl it, and look at it as below. \"Show me\" means say in a line what to look at or tap in the game they already see.",
		'',
		"The house's copy of the game, the one paude hosts for anyone to play, is another server on a port from 4100 up. It's paude's: brought up to date by itself a while after the building goes quiet, with saves of its own. Don't test against it, stop it, restart it or ask about it, and don't run `bun run build`, which writes the house copy's page: the dev server builds its own on every save.",
		'',
		...lookingSection(),
		...feelSection(),
		"## The game's face",
		'',
		'The first paragraph of `README.md`, under its heading, tells someone who has never seen the game what it is, in one or two plain sentences: the house\'s list of games shows it on the game\'s card. When the game becomes something new (a new goal, a new way to play), rewrite that paragraph to match, and set "description" in `client/manifest.json` to the same words when there is one. Do it in the same turn, without bringing it up.',
		'',
		...iconSection({ has: icon }),
		'## Every turn',
		'',
		'1. Make the change they asked for, the whole of it, and check it works before handing it back: `bun test` passes (a new rule gets a test in the project, not a throwaway script), the server answers, and you have looked at the page as above. If something breaks, fix it.',
		'2. Say what changed, in a line.',
		'3. Ask what should happen next with the AskUserQuestion tool, one question, and offer two to four real choices about the game (what it looks like, what happens, what is in it), never about code or files. Do not offer "show me" (the game is always on their screen, beside you), "my idea" (they can always talk or type to you) or "more ideas" (the page adds that one itself, and it asks you for a fresh set); every choice is a real thing the game could do.',
		'',
		"Every turn ends with that question, even one where they typed over the last question or asked for something small: it's what they tap, and what Put it back keeps the turn by.",
		'',
		...choosingSection('game'),
		'## How to write',
		'',
		...WRITING('game')[reading],
		'The labels of your choices are read aloud and shown as big buttons, so the emoji comes first and the words stay few.',
		'Decide every technical question yourself, without asking. Explain how the code works only when they ask. Say so in a few words when something works; do not gush.',
		'',
		...(performs ? voiceSection() : []),
		...(sounds ? soundsSection() : []),
		'## Working',
		'',
		"Work inside this project, with whatever the job needs: read and edit files, run shell commands, tests and builds, add a package when the game is better for it, curl the running server, look things up on the web. Routine work runs without asking. No one is there to answer a permission prompt: anything that would need one is turned back at once, so when something is refused, find another way to do it within the project and carry on, rather than stopping or asking for help. Don't push or rewrite history: paude keeps every turn as a commit that can be put back, and hosts the game itself.",
		'',
		"The libraries' docs are in `node_modules` (see `CLAUDE.md`): read them before building what the framework or the component library might already do.",
		'',
		...handlingSection(),
	].join('\n');

// The rules for a project that was there before the arcade: any repo, game or not, worked on the arcade's way (big
// type, read aloud, a choice at the end of each turn) without paude's game scaffold assumed: no Game.js, no dev server
// unless it has one, and its README left as its owners wrote it
export const adoptedInstructions = ({
	title,
	player,
	reading,
	devServer = false,
	empty = false,
	performs = false,
	sounds = false,
	icon = null,
	page,
}) =>
	[
		`# Working on ${title} together`,
		'',
		`You are working on this project with ${player || 'the person here'}. They decide what it should become and what happens next; you do all of the work, and you are trusted to do it well and see it through on your own. The owner of this paude may write in the same conversation now and then; follow what they say. Others may join on their own devices: paude adds a line naming who is in the arcade whenever that changes, so work with whoever is there.`,
		'',
		...(empty
			? [
					'## A new project',
					'',
					"The folder is empty: this is a project begun from nothing. Build it the way they describe, on what they already use where you can tell (their own libraries, the stack of their other projects), and keep to that from then on. Don't ask what it is: build the first version of what they said, then ask what's next.",
					'',
				]
			: [
					'## An existing project',
					'',
					"It was here before this conversation: read its README, its `CLAUDE.md` if it has one, and the files that matter before changing anything, and keep to how it's already written. Don't start over or ask what it is.",
					'',
				]),
		...(devServer
			? [
					'## It is already running',
					'',
					"Its `dev` script runs under paude as the project's `dev` task and shows live beside this conversation. Keeping it running is yours: don't start a second copy or stop it, and never ask anyone to restart anything; if a change doesn't show, look at how the dev script reloads and make it show. If it dies, paude starts it again at the next prompt or question. \"Show me\" means say in a line what to look at or tap in what they already see.",
					'',
					...lookingSection({ thing: 'project' }),
				]
			: [
					'## What they see',
					'',
					`Beside this conversation they see what you change: each file you touch, a tap from its diff. "Show me" means say in a line which file to look at. A project with a page to see gets a \`dev\` script in \`package.json\` that serves it and reloads on save: paude runs it as the project's \`dev\` task from the next prompt on and shows it beside this conversation, so never start a server of your own for them to look at. Look at a page you made with paude's look tool, \`bun "$PAUDE_LOOK" <its address> --out <your scratchpad>\`, which prints what went wrong and saves screenshots at a phone's size and a computer's.`,
					'',
				]),
		...iconSection({ has: icon, page }),
		'## Every turn',
		'',
		'1. Make the change they asked for, the whole of it, and check it works before handing it back: its tests pass, it builds, and a page it shows has been looked at. If something breaks, fix it.',
		'2. Say what changed, in a line.',
		'3. Ask what should happen next with the AskUserQuestion tool, one question, and offer two to four real choices about the project (what it does, how it looks, what is in it), never about code or files. Do not offer "show me", "my idea" (they can always talk or type to you) or "more ideas" (the page adds that one itself, and it asks you for a fresh set); every choice is a real thing the project could do.',
		'',
		"Every turn ends with that question, even one where they typed over the last question or asked for something small: it's what they tap, and what Put it back keeps the turn by. When they steer by typing, as someone who builds things often does, a question that gathers what you need to know (who, which, how much) serves better than a menu of features.",
		'',
		...choosingSection('project'),
		'## How to write',
		'',
		...WRITING('project')[reading],
		'The labels of your choices are read aloud and shown as big buttons, so the emoji comes first and the words stay few.',
		'Decide every technical question yourself, without asking. Explain how the code works only when they ask. Say so in a few words when something works; do not gush.',
		'',
		...(performs ? voiceSection({ game: false }) : []),
		...(sounds ? soundsSection() : []),
		'## Working',
		'',
		"Work inside this project, with whatever the job needs: read and edit files, run shell commands, tests and builds, add a package when the project is better for it, look things up on the web. Routine work runs without asking. No one is there to answer a permission prompt: anything that would need one is turned back at once, so when something is refused, find another way to do it within the project and carry on, rather than stopping or asking for help. Don't push or rewrite history: paude keeps every turn as a commit that can be put back.",
		'',
		...handlingSection(),
	].join('\n');

// The first thing Claude is asked in a project brought into the arcade
export const adoptedOpeningPrompt = ({ title, player }) =>
	`Say hello to ${player || 'the person you are working with'}. This is ${title}, a project that was here before: look around it as your rules say, tell them in a line or two what it is and what it can do now, then ask what they'd like to do with it.`;

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

	if (!(reading in READING))
		throw new ArcadeError(`Pick how Claude writes to them: ${Object.keys(READING).join(', ')}.`);

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

// Whether a session is in the arcade: as it was switched, or by its project's default (a marker there)
export const isArcadeSession = async (id, cwd) => {
	const mode = arcadeModeOf(id);

	return mode ? mode.on : await isArcade(cwd);
};

// What a session's arcade is: its project's marker (a game, or a project brought in) with the session's own reading if it
// was given one, or for a session switched into the arcade in a project without one, what paude knows of it. null when
// the session isn't in the arcade.
export const arcadeFor = async (id, cwd) => {
	const mode = arcadeModeOf(id);

	if (mode && !mode.on) return null;

	const marker = await arcadeOf(cwd);

	if (marker) return { ...marker, ...(mode?.reading && { reading: mode.reading }) };
	if (!mode?.on) return null;

	return { title: basename(cwd), named: true, reading: mode.reading ?? 'reading', session: true };
};

// Said to Claude in a project with the arcade's rules, for a session switched out of the arcade
const ARCADE_OFF =
	'This session is not in the arcade: the arcade rules in `.paude-arcade.md` do not apply to it. Work as an ordinary Claude Code session: write as you normally would, and end turns however fits rather than always with a question.';

// What Claude starts with in a session, for the arcade: settings to go with paude's own (the arcade's permissions and the
// hook that turns permission prompts back) and words added to its system prompt (the arcade's rules, where no file in the
// project carries them). A game paude made has both in its own files; a project brought in has its rules in a file and
// takes the settings here; any other session switched into the arcade takes both here. null for an ordinary session.
export const arcadeLaunch = async (id, cwd) => {
	const mode = arcadeModeOf(id);
	const marker = await arcadeOf(cwd);

	if (mode && !mode.on) return marker ? { systemPrompt: ARCADE_OFF } : null;
	if (marker) return marker.adopted ? { settings: claudeSettings } : {};
	if (!mode?.on) return null;

	await beginRepository(cwd).catch(error => console.error('A repository could not be begun:', error));

	const devServer = Boolean((await readJsonFile(join(cwd, 'package.json'), null).catch(() => null))?.scripts?.dev);
	// Nothing but dotfiles: a project begun from nothing, not one to read before changing
	const empty = !(await readdir(cwd).catch(() => [])).some(name => !name.startsWith('.'));

	return {
		settings: claudeSettings,
		systemPrompt: adoptedInstructions({
			title: basename(cwd),
			player: await ownerName(),
			reading: mode.reading ?? 'reading',
			devServer,
			empty,
			performs: await voicePerforms(),
			sounds: Boolean(await voiceSettings()) && devServer,
			...(await iconState(cwd)),
		}),
	};
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

// Where the game's own server asks for lines said aloud, for a copy run without paude's environment (the house's,
// run from this same folder): a file of paude's beside the game, ignored, gone when there's no voice to ask
const writeSpeechAddress = async cwd => {
	const address = (await voiceSettings()) ? gameSpeechAddress(knownProject(cwd), cwd) : null;

	if (address) await writeFile(join(cwd, SPEECH_FILE), `${address}\n`);
	else await rm(join(cwd, SPEECH_FILE), { force: true });
};

// paude's files in a game it made: ignored, and taken out of the repository where an older scaffold committed them
// (they're rewritten each sitting, so every turn's snapshot would carry them), in a commit of their own
const IGNORED = ['.claude/', 'CLAUDE.local.md', RULES, SPEECH_FILE];

const untrackOurs = async cwd => {
	if (!(await exists(join(cwd, '.git')))) return;

	const ignoreFile = join(cwd, '.gitignore');
	const ignore = await readFile(ignoreFile, 'utf8').catch(() => '');
	const missing = IGNORED.filter(line => !ignore.split('\n').includes(line));
	const tracked = (await gitOut(cwd, ['ls-files', '--', '.claude/settings.json', 'CLAUDE.local.md', RULES])).out
		.split('\n')
		.filter(Boolean);

	if (!missing.length && !tracked.length) return;
	// Something else staged already is someone's work in progress: this waits for a sitting when it isn't
	if (!(await git(cwd, ['diff', '--cached', '--quiet']))) return;
	if (missing.length)
		await writeFile(
			ignoreFile,
			`${ignore}${ignore && !ignore.endsWith('\n') ? '\n' : ''}\n# paude's files, written again each time Claude starts here\n${missing.join('\n')}\n`,
		);
	if (tracked.length) await git(cwd, ['rm', '-q', '--cached', '--', ...tracked]);
	await git(cwd, ['add', '--', '.gitignore']);

	// What's staged is only this: the files let go and the ignore file
	const message = "paude's session files stay out of the repo";

	(await git(cwd, ['commit', '-q', '-m', message])) ||
		(await git(cwd, ['-c', 'user.name=paude', '-c', 'user.email=paude@localhost', 'commit', '-q', '-m', message]));
};

// Whether a project's page links an icon of its own: { icon, page }, icon null when it has no page to give one
const PAGES = ['client/index.html', 'index.html', 'public/index.html', 'src/index.html'];

export const iconState = async cwd => {
	for (const page of PAGES) {
		const html = await readFile(join(cwd, page), 'utf8').catch(() => null);

		if (html !== null) return { icon: /<link[^>]+rel=["'](?:shortcut )?icon["']/i.test(html), page };
	}

	return { icon: null };
};

// Paude's files in a game, written again from its marker: Claude's rules and its permissions, so a game made before
// either changed (or copied from another machine) runs under the current ones each time Claude starts there.
// CLAUDE.local.md imports the rules; one paude wrote whole in an earlier version (its own heading first) is replaced
// by the import, and one with a person's own words keeps them, the import put first. True when `cwd` is an arcade.
export const refreshArcade = async cwd => {
	const marker = await arcadeOf(cwd);

	if (!marker) return false;
	if (marker.adopted) return refreshAdopted(cwd, marker);

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
			performs: await voicePerforms(),
			sounds: Boolean(await voiceSettings()),
			icon: (await iconState(cwd)).icon,
		}),
	);
	await mkdir(join(cwd, '.claude'), { recursive: true });
	await writeFile(join(cwd, '.claude', 'settings.json'), `${JSON.stringify(claudeSettings, null, '\t')}\n`);
	await writeSpeechAddress(cwd);
	await restartOnSave(cwd);
	await untrackOurs(cwd).catch(error =>
		console.warn(`paude's files could not be untracked in ${cwd}: ${error.message}`),
	);

	const local = join(cwd, 'CLAUDE.local.md');
	const current = await readFile(local, 'utf8').catch(() => null);

	if (current === null || current.startsWith('# Building ')) await writeFile(local, LOCAL_STUB);
	else if (!current.includes(RULES_IMPORT)) await writeFile(local, `${RULES_IMPORT}\n\n${current}`);

	return true;
};

// What paude writes into a project it didn't make, kept out of the project's own git status by the repository's local
// exclude file (never its .gitignore, which is the project's)
const PAUDE_FILES = [MARKER, RULES, 'CLAUDE.local.md'];

const excludeOurs = async cwd => {
	const where = await gitOut(cwd, ['rev-parse', '--git-path', 'info/exclude']);

	if (!where.ok) return;

	const file = resolve(cwd, where.out);
	const current = await readFile(file, 'utf8').catch(() => '');
	const missing = PAUDE_FILES.filter(name => !current.split('\n').includes(`/${name}`));

	if (!missing.length) return;
	await mkdir(join(file, '..'), { recursive: true });
	await writeFile(
		file,
		`${current}${current && !current.endsWith('\n') ? '\n' : ''}${missing.map(name => `/${name}`).join('\n')}\n`,
	);
};

const hasDevScript = async cwd =>
	Boolean((await readJsonFile(join(cwd, 'package.json'), null).catch(() => null))?.scripts?.dev);

// A project brought into the arcade gets its rules and the import of them, and nothing of its own changed: its
// .claude settings stay its own (the arcade's permissions come with paude's launch of Claude instead), its README too
const refreshAdopted = async (cwd, marker) => {
	const devServer = await hasDevScript(cwd);
	const voice = await voiceSettings();

	await excludeOurs(cwd);
	await writeFile(
		join(cwd, RULES),
		adoptedInstructions({
			title: marker.title,
			player: marker.player,
			reading: marker.reading,
			devServer,
			performs: await voicePerforms(),
			sounds: Boolean(voice) && devServer,
			...(await iconState(cwd)),
		}),
	);

	const local = join(cwd, 'CLAUDE.local.md');
	const current = await readFile(local, 'utf8').catch(() => null);

	if (current === null) await writeFile(local, LOCAL_STUB);
	else if (!current.includes(RULES_IMPORT)) await writeFile(local, `${RULES_IMPORT}\n\n${current}`);

	return true;
};

// Brings a project that was already here into the arcade: its marker written (named for its package or its folder,
// marked as adopted, so it isn't treated as one of paude's games), and its rules. A project already in the arcade is
// left as it is. Resolves to the marker.
export const adoptArcade = async (cwd, { player, reading }) => {
	const known = await arcadeOf(cwd);

	if (known) return known;
	if (!(reading in READING))
		throw new ArcadeError(`Pick how Claude writes to them: ${Object.keys(READING).join(', ')}.`);

	const named = (await readJsonFile(join(cwd, 'package.json'), null).catch(() => null))?.name;
	const marker = {
		title: String(named || basename(cwd)).slice(0, NAME_LENGTH),
		named: true,
		player: String(player ?? '')
			.trim()
			.slice(0, 40),
		reading,
		adopted: true,
		made: new Date().toISOString(),
	};

	await beginRepository(cwd);
	await excludeOurs(cwd);
	await writeJsonFile(join(cwd, MARKER), () => marker);
	arcadeKnown.delete(cwd);
	await refreshArcade(cwd);

	return marker;
};

// A project brought into the arcade, let go: its marker and rules gone, and the import of them taken out of its
// CLAUDE.local.md (the file itself gone when it held nothing else). A game paude made isn't let go. Resolves to whether
// it was.
export const releaseArcade = async cwd => {
	const marker = await arcadeOf(cwd);

	if (!marker?.adopted) return false;

	const { rm } = await import('fs/promises');
	const local = join(cwd, 'CLAUDE.local.md');
	const current = await readFile(local, 'utf8').catch(() => null);

	await rm(join(cwd, MARKER), { force: true });
	await rm(join(cwd, RULES), { force: true });
	if (current !== null) {
		const rest = current.replace(LOCAL_STUB, '').replace(`${RULES_IMPORT}\n\n`, '').replace(RULES_IMPORT, '');

		if (rest.trim()) await writeFile(local, rest);
		else await rm(local, { force: true });
	}
	arcadeKnown.delete(cwd);

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

// What the steward changed in the files it keeps, committed on its own, as paude: only those paths, whatever else
// is half done beside them. Whether anything was committed.
export const commitOwned = async (cwd, paths, message) => {
	const there = [];

	for (const owned of paths) if (await exists(join(cwd, owned))) there.push(owned);
	if (!there.length) return false;
	await gitOut(cwd, ['add', '--', ...there]);
	if ((await gitOut(cwd, ['diff', '--cached', '--quiet', '--', ...there])).ok) return false;

	return (await gitOut(cwd, [...asPaude, 'commit', '-q', '-m', message, '--', ...there])).ok;
};

// Put it back needs history to put back to: a folder in no repository is made one when it comes into the arcade, its
// files as they were then its first commit (dependencies and secrets ignored when it says nothing of its own). One
// inside a repository already is left as it is. Whether one was begun.
const STARTING_IGNORES = 'node_modules/\n.env\n.env.*\n';

export const beginRepository = async cwd => {
	if ((await gitOut(cwd, ['rev-parse', '--git-dir'])).ok) return false;
	if (!(await gitOut(cwd, ['init', '-q'])).ok) return false;
	if (!(await exists(join(cwd, '.gitignore')))) await writeFile(join(cwd, '.gitignore'), STARTING_IGNORES);
	await gitOut(cwd, ['add', '-A']);
	await gitOut(cwd, [...asPaude, 'commit', '-q', '--allow-empty', '-m', 'As it was when it came into the arcade']);

	return true;
};

// After each of Claude's turns in an arcade, what the turn left in the game is committed as one snapshot named for
// what was asked, so "put it back" has something to put back and the game's history reads as what was
// asked for. A turn Claude committed itself, or that changed nothing, leaves no snapshot. Resolves to the subject,
// or null.
export const snapshotTurn = async (sessionId, cwd) => {
	if (!(await isArcadeSession(sessionId, cwd))) return null;

	const marker = await arcadeOf(cwd);

	// Whatever the turn left (a snapshot here, or a commit Claude made itself), the house's copy of a game paude made
	// follows it
	if (marker && !marker.adopted) keepHosted(cwd);

	await gitOut(cwd, ['add', '-A']);
	if ((await gitOut(cwd, ['diff', '--cached', '--quiet'])).ok) return null;

	const entries = await transcriptLines(sessionId, cwd)
		.then(lines => feedFrom(lines, cwd))
		.catch(() => []);
	const subject = `${SNAPSHOT}${turnName(entries)}`;
	const committed = await gitOut(cwd, [...asPaude, 'commit', '-q', '-m', subject]);

	return committed.ok ? subject : null;
};

// Where each arcade turn left the repository, per session: the commit before the last turn and the one it ended on,
// so Put it back undoes the whole turn, a snapshot of paude's or commits Claude made itself (a person's own rules
// may have it commit every turn). Kept across hot reloads; a server restarted falls back to the newest snapshot alone.
const turnEnds = (globalThis.paudeArcadeTurnEnds ??= new Map());

export const noteTurnEnd = async (sessionId, cwd) => {
	const head = await gitOut(cwd, ['rev-parse', 'HEAD']);

	if (!head.ok) return;

	const ends = turnEnds.get(sessionId);

	if (ends?.at(-1) !== head.out) turnEnds.set(sessionId, [ends?.at(-1) ?? null, head.out]);
};

// What Put it back would undo: { from, to, name } for the last turn's commits (from exclusive), or null
const lastTurn = async (sessionId, cwd) => {
	const head = await gitOut(cwd, ['rev-parse', 'HEAD']);
	const [from, to] = turnEnds.get(sessionId) ?? [];

	if (head.ok && from && to === head.out) {
		const subjects = (await gitOut(cwd, ['log', '--format=%s', `${from}..${to}`])).out.split('\n').filter(Boolean);
		const snapshot = subjects.find(subject => subject.startsWith(SNAPSHOT));

		if (subjects.length) return { from, to, name: snapshot ? snapshot.slice(SNAPSHOT.length) : subjects.at(-1) };
	}

	const newest = await gitOut(cwd, ['log', '-1', '--format=%s']);

	return newest.ok && newest.out.startsWith(SNAPSHOT)
		? { from: 'HEAD~1', to: 'HEAD', name: newest.out.slice(SNAPSHOT.length) }
		: null;
};

// The last turn undone: the game goes back to how it was before that turn, as one new commit, so nothing is lost and
// it can be put forward again by hand. Refused while Claude is working (its edits would land on the revert) and when
// there's no turn to undo (the scaffold's first commit, or a turn already put back). { undone } or throws.
export const undoLastTurn = async (sessionId, cwd) => {
	if (!(await isArcadeSession(sessionId, cwd))) throw new ArcadeError('This session is not in the arcade.');
	if (statusOf(sessionId) === 'working') throw new ArcadeError('Claude is still working. Wait for it to finish.');

	const turn = await lastTurn(sessionId, cwd);

	if (!turn) throw new ArcadeError("There is nothing of Claude's to put back.");
	if ((await gitOut(cwd, ['status', '--porcelain'])).out)
		throw new ArcadeError('Something is half changed. Try again in a moment.');

	const reverted = await gitOut(cwd, ['revert', '--no-commit', `${turn.from}..${turn.to}`]);
	const committed =
		reverted.ok && (await gitOut(cwd, [...asPaude, 'commit', '-q', '--allow-empty', '-m', `Put back: ${turn.name}`]));

	if (!committed?.ok) {
		await gitOut(cwd, ['revert', '--abort']);
		throw new ArcadeError('It could not be put back cleanly.');
	}

	const undone = turn.name;

	// Put back once: pressed again, there's no turn before it to undo
	turnEnds.delete(sessionId);

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
			// A project brought into the arcade isn't one of paude's games: the hub doesn't host it
			if ((await arcadeOf(cwd))?.adopted) return;

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

		const marker = cwd && (await arcadeOf(cwd));

		if (!marker || marker.adopted || (await hostingOf(cwd))) continue;

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
