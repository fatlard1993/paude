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
const TIMEOUT_MS = 60_000;

let folder = null;
const spent = new Map();

export const initSounds = async dataDir => {
	folder = path.join(dataDir, 'sounds');
	await mkdir(folder, { recursive: true });
};

// A session's own token: only paude, holding the secret, can make it, and it names that one session
export const soundToken = (secret, sessionId) =>
	createHmac('sha256', secret).update(`sounds\n${sessionId}`).digest('base64url').slice(0, 32);

const today = () => new Date().toISOString().slice(0, 10);

// What a session has left of today's seconds
export const secondsLeft = sessionId => {
	const used = spent.get(sessionId);

	return DAILY_SECONDS - (used?.day === today() ? used.seconds : 0);
};

const spend = (sessionId, seconds) =>
	spent.set(sessionId, { day: today(), seconds: DAILY_SECONDS - secondsLeft(sessionId) + seconds });

// The asked-for request made sound and checked: { description, seconds, loop, file } with the file a path inside the
// game ending in .mp3. Throws a SpeechError (400) saying what's wrong.
export const soundRequest = ({ description, seconds, loop, file } = {}) => {
	const said = String(description ?? '')
		.trim()
		.slice(0, DESCRIPTION_LENGTH);
	const length = seconds === undefined ? DEFAULT_SECONDS : Number(seconds);
	const where = String(file ?? '').trim();

	if (!said) throw new SpeechError('Describe the sound: "description"', 400);
	if (!Number.isFinite(length) || length < SHORTEST || length > LONGEST)
		throw new SpeechError(`"seconds" is ${SHORTEST} to ${LONGEST}`, 400);
	if (!where.endsWith('.mp3') || path.isAbsolute(where) || where.split(/[\\/]/).includes('..'))
		throw new SpeechError('"file" is a path inside the game ending in .mp3, like client/sounds/zap.mp3', 400);

	return { description: said, seconds: Math.round(length * 10) / 10, loop: Boolean(loop), file: where };
};

const within = (root, real) => real === root || real.startsWith(root + path.sep);

const nearestReal = async folder => {
	for (let at = folder; ; at = path.dirname(at)) {
		const real = await realpath(at).catch(() => null);

		if (real || at === path.dirname(at)) return real ?? at;
	}
};

// The sound written into the game at `cwd`: { file, seconds, cached, left }. `fetcher` is fetch, but in tests.
export const makeSound = async (sessionId, cwd, asked, { fetcher = fetch } = {}) => {
	const { description, seconds, loop, file } = soundRequest(asked);
	const voice = await voiceSettings();

	if (!voice) throw new SpeechError('No ElevenLabs key is set up on this paude', 404);

	const root = await realpath(cwd);
	const target = path.resolve(root, file);
	const parent = path.dirname(target);

	// The nearest folder that exists, links followed, must be the game's, before anything is made under it
	if (!within(root, await nearestReal(parent))) throw new SpeechError('That is outside the game', 400);
	await mkdir(parent, { recursive: true });

	const key = createHash('sha256').update(`${MODEL}\n${seconds}\n${loop}\n${description}`).digest('hex');
	const kept = folder && path.join(folder, `${key}.mp3`);
	const cached = kept && (await readFile(kept).catch(() => null));

	if (cached) {
		await writeFile(target, cached);

		return { file, seconds, cached: true, left: secondsLeft(sessionId) };
	}
	if (secondsLeft(sessionId) < seconds)
		throw new SpeechError(
			`Today's sound budget for this game is spent (${DAILY_SECONDS} seconds a day); reuse a sound already made`,
			429,
		);

	const response = await fetcher(`${API}?output_format=${OUTPUT}`, {
		method: 'POST',
		headers: { 'xi-api-key': voice.apiKey, 'content-type': 'application/json' },
		body: JSON.stringify({ text: description, duration_seconds: seconds, loop, model_id: MODEL }),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	}).catch(error => {
		throw new SpeechError(`ElevenLabs could not be reached: ${error.message}`);
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');

		if (response.status === 429) throw new SpeechError('ElevenLabs is out of quota or rate limited for now', 429);
		throw new SpeechError(`ElevenLabs answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
	}

	const audio = Buffer.from(await response.arrayBuffer());

	spend(sessionId, seconds);
	await writeFile(target, audio);
	if (kept) await writeFile(kept, audio).catch(() => {});

	return { file, seconds, cached: false, left: secondsLeft(sessionId) };
};
