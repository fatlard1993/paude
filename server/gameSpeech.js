import { createHash, createHmac } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

import { SpeechError, voiceSettings } from './speech';

// Lines an arcade game speaks as it's played (a rapper's verse, a narrator, a name called out), said by ElevenLabs for
// the game's own server, which asks paude at an address of its own (an HMAC of its folder) and never holds the key.
// The same line in the same voice comes from the cache; new ones are held to a budget of characters a day per game,
// since they're paid by the character.
const API = 'https://api.elevenlabs.io/v1/text-to-speech';
const OUTPUT = 'mp3_44100_128';
const MAX_CHARACTERS = 1000;
const DAILY_CHARACTERS = 20_000;
const TIMEOUT_MS = 30_000;
// A voice is one of ElevenLabs' ids: letters and digits
const VOICE = /^[A-Za-z0-9]{8,40}$/;
const MODEL = /^[a-z0-9_]{3,40}$/;

let folder = null;
// { [folder]: { day, characters } }
const spent = new Map();

export const initGameSpeech = async dataDir => {
	folder = path.join(dataDir, 'game-speech');
	await mkdir(folder, { recursive: true });
};

// A game's own token: only paude, holding the secret, can make it, and it names that one game folder
export const gameSpeechToken = (secret, cwd) =>
	createHmac('sha256', secret).update(`game speech\n${cwd}`).digest('base64url').slice(0, 32);

const today = () => new Date().toISOString().slice(0, 10);

export const charactersLeft = cwd => {
	const used = spent.get(cwd);

	return DAILY_CHARACTERS - (used?.day === today() ? used.characters : 0);
};

// What a game asked to have said, checked: { text, voice, model }, voice and model paude's own when not named
export const lineRequest = ({ text, voice, model } = {}) => {
	const said = String(text ?? '').trim();

	if (!said) throw new SpeechError('Say what to say: "text"', 400);
	if (said.length > MAX_CHARACTERS) throw new SpeechError(`At most ${MAX_CHARACTERS} characters a line`, 413);
	if (voice !== undefined && !VOICE.test(String(voice)))
		throw new SpeechError('"voice" is an ElevenLabs voice id', 400);
	if (model !== undefined && !MODEL.test(String(model)))
		throw new SpeechError('"model" is an ElevenLabs model id', 400);

	return { text: said, voice, model };
};

// The line said, as MP3 bytes: { audio, cached, left }. `fetcher` is fetch, but in tests.
export const speakForGame = async (cwd, asked = {}, { fetcher = fetch } = {}) => {
	const settings = await voiceSettings();

	if (!settings) throw new SpeechError('No ElevenLabs key is set up on this paude', 404);

	const { text, voice = settings.voiceId, model = settings.modelId } = lineRequest(asked);
	const key = createHash('sha256').update(`${voice}\n${model}\n${text}`).digest('hex');
	const kept = folder && path.join(folder, `${key}.mp3`);
	const cached = kept && (await readFile(kept).catch(() => null));

	if (cached) return { audio: cached, cached: true, left: charactersLeft(cwd) };
	if (charactersLeft(cwd) < text.length)
		throw new SpeechError(
			`Today's speech for this game is spent (${DAILY_CHARACTERS} characters a day); lines said before still play`,
			429,
		);

	const response = await fetcher(`${API}/${encodeURIComponent(voice)}?output_format=${OUTPUT}`, {
		method: 'POST',
		headers: { 'xi-api-key': settings.apiKey, 'content-type': 'application/json' },
		body: JSON.stringify({ text, model_id: model }),
		signal: AbortSignal.timeout(TIMEOUT_MS),
	}).catch(error => {
		throw new SpeechError(`ElevenLabs could not be reached: ${error.message}`);
	});

	if (!response.ok) {
		const detail = (await response.text().catch(() => '')).slice(0, 300);

		if (response.status === 429) throw new SpeechError('ElevenLabs is out of quota or rate limited for now', 429);
		// A lapsed payment comes back as a refusal of the key: what ElevenLabs said is the only place it shows
		throw new SpeechError(`ElevenLabs answered ${response.status}${detail ? `: ${detail}` : ''}`);
	}

	const audio = Buffer.from(await response.arrayBuffer());

	spent.set(cwd, { day: today(), characters: DAILY_CHARACTERS - charactersLeft(cwd) + text.length });
	if (kept) await writeFile(kept, audio).catch(() => {});

	return { audio, cached: false, left: charactersLeft(cwd) };
};
