import { createHash, createHmac } from 'crypto';
import { mkdir, readFile, realpath, writeFile } from 'fs/promises';
import path from 'path';

import { SpeechError, voiceSettings } from './speech';

// Sound effects for the games an arcade builds, made with ElevenLabs' sound generation from a description and written
// into the game as a file, the key kept here. Each session reaches this through an address of its own (an HMAC of its
// id), given in its environment. A sound made before comes from the cache; new ones are held to a few seconds each
// and a budget a day, since they're paid by the second.
const API = 'https://api.elevenlabs.io/v1/sound-generation';
const MODEL = 'eleven_text_to_sound_v3';
const OUTPUT = 'mp3_44100_128';
const SHORTEST = 0.5;
const LONGEST = 10;
const DEFAULT_SECONDS = 1.5;
const DESCRIPTION_LENGTH = 300;
// Seconds of new sound a session may make in a day
const DAILY_SECONDS = 90;
// Music: a track composed from a description (ElevenLabs' music model, about 30 credits a second), longer than a sound
// and dearer, so its own lengths and its own, tighter budget
const MUSIC_API = 'https://api.elevenlabs.io/v1/music';
const MUSIC_MODEL = 'music_v2_5';
const MUSIC_SHORTEST = 3;
const MUSIC_LONGEST = 120;
const MUSIC_DEFAULT_SECONDS = 45;
const MUSIC_DAILY_SECONDS = 120;
const MUSIC_TIMEOUT_MS = 180_000;
const TIMEOUT_MS = 60_000;

let folder = null;
// What each session has spent today, kept apart for sounds and music: { [kind]: Map(session → { day, seconds }) }
const spent = { sound: new Map(), music: new Map() };
const BUDGETS = { sound: DAILY_SECONDS, music: MUSIC_DAILY_SECONDS };

export const initSounds = async dataDir => {
	folder = path.join(dataDir, 'sounds');
	await mkdir(folder, { recursive: true });
};

// A session's own token: only paude, holding the secret, can make it, and it names that one session
export const soundToken = (secret, sessionId) =>
	createHmac('sha256', secret).update(`sounds\n${sessionId}`).digest('base64url').slice(0, 32);

const today = () => new Date().toISOString().slice(0, 10);

// What a session has left of today's seconds of sound, or of music
export const secondsLeft = (sessionId, kind = 'sound') => {
	const used = spent[kind].get(sessionId);

	return BUDGETS[kind] - (used?.day === today() ? used.seconds : 0);
};

const spend = (sessionId, seconds, kind) =>
	spent[kind].set(sessionId, { day: today(), seconds: BUDGETS[kind] - secondsLeft(sessionId, kind) + seconds });

// The asked-for request made sound and checked: { description, seconds, loop, file } with the file a path inside the
// game ending in .mp3. Throws a SpeechError (400) saying what's wrong.
export const soundRequest = ({ description, seconds, loop, file } = {}) => {
	const said = String(description ?? '')
		.trim()
		.slice(0, DESCRIPTION_LENGTH);
	const length = seconds === undefined ? DEFAULT_SECONDS : Number(seconds);

	if (!said) throw new SpeechError('Describe the sound: "description"', 400);
	if (!Number.isFinite(length) || length < SHORTEST || length > LONGEST)
		throw new SpeechError(`"seconds" is ${SHORTEST} to ${LONGEST}`, 400);

	return { description: said, seconds: Math.round(length * 10) / 10, loop: Boolean(loop), file: gameFile(file) };
};

const within = (root, real) => real === root || real.startsWith(root + path.sep);

const nearestReal = async folder => {
	for (let at = folder; ; at = path.dirname(at)) {
		const real = await realpath(at).catch(() => null);

		if (real || at === path.dirname(at)) return real ?? at;
	}
};

// A file inside the game, for a sound or a track: a path ending in .mp3, not absolute, not climbing out by its spelling
const gameFile = file => {
	const where = String(file ?? '').trim();

	if (!where.endsWith('.mp3') || path.isAbsolute(where) || where.split(/[\\/]/).includes('..'))
		throw new SpeechError('"file" is a path inside the game ending in .mp3, like client/sounds/zap.mp3', 400);

	return where;
};

// The asked-for track made music and checked: { music, seconds, instrumental, file }. Instrumental unless asked
// otherwise: it plays under a game.
export const musicRequest = ({ music, seconds, instrumental, file } = {}) => {
	const said = String(music ?? '')
		.trim()
		.slice(0, DESCRIPTION_LENGTH);
	const length = seconds === undefined ? MUSIC_DEFAULT_SECONDS : Number(seconds);

	if (!said) throw new SpeechError('Describe the music: "music"', 400);
	if (!Number.isFinite(length) || length < MUSIC_SHORTEST || length > MUSIC_LONGEST)
		throw new SpeechError(`"seconds" is ${MUSIC_SHORTEST} to ${MUSIC_LONGEST} for music`, 400);

	return { music: said, seconds: Math.round(length), instrumental: instrumental !== false, file: gameFile(file) };
};

// The two kinds paude makes, each with how it's asked of ElevenLabs and what a cached one is known by
const KINDS = {
	sound: {
		request: soundRequest,
		key: ({ description, seconds, loop }) => `${MODEL}\n${seconds}\n${loop}\n${description}`,
		ask: ({ description, seconds, loop }) => ({
			url: `${API}?output_format=${OUTPUT}`,
			body: { text: description, duration_seconds: seconds, loop, model_id: MODEL },
			timeout: TIMEOUT_MS,
		}),
		spentMessage: `Today's sound budget for this game is spent (${DAILY_SECONDS} seconds a day); reuse a sound already made`,
	},
	music: {
		request: musicRequest,
		key: ({ music, seconds, instrumental }) => `${MUSIC_MODEL}\n${seconds}\n${instrumental}\n${music}`,
		ask: ({ music, seconds, instrumental }) => ({
			url: MUSIC_API,
			body: { prompt: music, music_length_ms: seconds * 1000, force_instrumental: instrumental, model_id: MUSIC_MODEL },
			timeout: MUSIC_TIMEOUT_MS,
		}),
		spentMessage: `Today's music budget for this game is spent (${MUSIC_DAILY_SECONDS} seconds a day); reuse a track already made`,
	},
};

// A sound or a track written into the game at `cwd`: { file, seconds, cached, left }. Asked for with "music", it's a
// track; otherwise a sound. `fetcher` is fetch, but in tests.
export const makeSound = async (sessionId, cwd, asked = {}, { fetcher = fetch } = {}) => {
	const kind = asked.music === undefined ? 'sound' : 'music';
	const { request, key, ask, spentMessage } = KINDS[kind];
	const wanted = request(asked);
	const { file, seconds } = wanted;
	const voice = await voiceSettings();

	if (!voice) throw new SpeechError('No ElevenLabs key is set up on this paude', 404);

	const root = await realpath(cwd);
	const target = path.resolve(root, file);
	const parent = path.dirname(target);

	// The nearest folder that exists, links followed, must be the game's, before anything is made under it
	if (!within(root, await nearestReal(parent))) throw new SpeechError('That is outside the game', 400);
	await mkdir(parent, { recursive: true });

	const kept = folder && path.join(folder, `${createHash('sha256').update(key(wanted)).digest('hex')}.mp3`);
	const cached = kept && (await readFile(kept).catch(() => null));

	if (cached) {
		await writeFile(target, cached);

		return { file, seconds, cached: true, left: secondsLeft(sessionId, kind) };
	}
	if (secondsLeft(sessionId, kind) < seconds) throw new SpeechError(spentMessage, 429);

	const { url, body, timeout } = ask(wanted);
	const response = await fetcher(url, {
		method: 'POST',
		headers: { 'xi-api-key': voice.apiKey, 'content-type': 'application/json' },
		body: JSON.stringify(body),
		signal: AbortSignal.timeout(timeout),
	}).catch(error => {
		throw new SpeechError(`ElevenLabs could not be reached: ${error.message}`);
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');

		if (response.status === 429) throw new SpeechError('ElevenLabs is out of quota or rate limited for now', 429);
		throw new SpeechError(`ElevenLabs answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
	}

	const audio = Buffer.from(await response.arrayBuffer());

	spend(sessionId, seconds, kind);
	await writeFile(target, audio);
	if (kept) await writeFile(kept, audio).catch(() => {});

	return { file, seconds, cached: false, left: secondsLeft(sessionId, kind) };
};
