import { createHash } from 'crypto';
import { mkdir, readFile } from 'fs/promises';
import { join } from 'path';

import readJsonFile from '../shared/readJsonFile';
import { wordsOf } from '../shared/spoken';
import writeJsonFile from '../shared/writeJsonFile';
import { configFile, serverSettings } from './serverSettings';

// Reading aloud with ElevenLabs, for the arcade: the key stays here, the audio is fetched once per text and kept (a
// player plays a line again), and the voice's character timings become a start time per word, for the page to light
// the word being said. Without a key the page uses the browser's own voice.
const API = 'https://api.elevenlabs.io/v1';
// ElevenLabs' Rachel, one of its own voices, so a key alone is enough to start
const DEFAULT_VOICE = '21m00Tcm4TlvDq8ikWAM'; // eslint-disable-line spellcheck/spell-checker
const DEFAULT_MODEL = 'eleven_flash_v2_5';
const OUTPUT = 'mp3_44100_128';
const MAX_CHARACTERS = 2500;
const TIMEOUT_MS = 30_000;
const EAR_MODEL = 'scribe_v1';
const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const EAR_TIMEOUT_MS = 60_000;

let folder = null;

export class SpeechError extends Error {
	constructor(message, status = 502) {
		super(message);
		this.status = status;
	}
}

export const initSpeech = async dataDir => {
	folder = join(dataDir, 'speech');
	await mkdir(folder, { recursive: true });
};

// The key this machine's other ElevenLabs tools read, so one key serves them all
const sharedKeyFile = () => join(configFile(''), '..', 'elevenlabs', 'key');

const sharedKey = async () => (await readFile(sharedKeyFile(), 'utf8').catch(() => '')).trim() || null;

// The voice this paude reads with: the key from ELEVENLABS_API_KEY, `elevenLabs.apiKey` in
// ~/.config/paude/server.json, or ~/.config/elevenlabs/key; the voice and model from that same `elevenLabs` setting
// ({ "voiceId": "...", "modelId": "..." }). null for no key
export const voiceSettings = async () => {
	const { elevenLabs = {} } = await serverSettings();
	const apiKey = process.env.ELEVENLABS_API_KEY || elevenLabs.apiKey || (await sharedKey());

	if (!apiKey) return null;

	return {
		apiKey,
		voiceId: elevenLabs.voiceId || DEFAULT_VOICE,
		modelId: elevenLabs.modelId || DEFAULT_MODEL,
	};
};

// Each word's start and end, in seconds, from the characters' times; a word whose characters the voice didn't time
// (none expected) takes the time of the one before it
export const wordTimes = (text, alignment) => {
	const starts = alignment?.character_start_times_seconds ?? [];
	const ends = alignment?.character_end_times_seconds ?? [];
	let last = 0;

	return wordsOf(text).map(({ word, at }) => {
		const start = starts[at] ?? last;
		const end = ends[at + word.length - 1] ?? start;

		last = end;

		return { start, end };
	});
};

const keyOf = (text, { voiceId, modelId }) =>
	createHash('sha256').update(`${voiceId}\n${modelId}\n${text}`).digest('hex');

// `text` said by the voice: { audio (base64 MP3), words: [{ start, end }] in the order of wordsOf(text) }. A text said
// before comes from the cache. `fetcher` is fetch, but in tests.
export const readAloud = async (text, { fetcher = fetch } = {}) => {
	const voice = await voiceSettings();

	if (!voice) throw new SpeechError('No voice is set up on this paude', 404);

	const said = String(text ?? '').trim();

	if (!said) throw new SpeechError('Nothing to say', 400);
	if (said.length > MAX_CHARACTERS) throw new SpeechError(`At most ${MAX_CHARACTERS} characters at a time`, 413);

	const file = folder && join(folder, `${keyOf(said, voice)}.json`);
	const kept = file && (await readJsonFile(file, null).catch(() => null));

	if (kept?.audio) return kept;

	const response = await fetcher(
		`${API}/text-to-speech/${encodeURIComponent(voice.voiceId)}/with-timestamps?output_format=${OUTPUT}`,
		{
			method: 'POST',
			headers: { 'xi-api-key': voice.apiKey, 'content-type': 'application/json' },
			body: JSON.stringify({ text: said, model_id: voice.modelId }),
			signal: AbortSignal.timeout(TIMEOUT_MS),
		},
	).catch(error => {
		throw new SpeechError(`ElevenLabs could not be reached: ${error.message}`);
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');

		if (response.status === 401) throw new SpeechError('ElevenLabs refused the key');
		if (response.status === 429) throw new SpeechError('ElevenLabs is out of quota or rate limited for now');
		throw new SpeechError(`ElevenLabs answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
	}

	const { audio_base64: audio, alignment } = await response.json();

	if (!audio) throw new SpeechError('ElevenLabs sent no audio');

	const spoken = { audio, words: wordTimes(said, alignment) };

	if (file) await writeJsonFile(file, () => spoken).catch(() => {});

	return spoken;
};

// What was said in a recording (webm, mp4, ogg or mp3 from a page's microphone): { text }, '' for silence. The same
// key hears as speaks.
export const hear = async (audio, type = 'audio/webm', { fetcher = fetch } = {}) => {
	const voice = await voiceSettings();

	if (!voice) throw new SpeechError('No voice is set up on this paude', 404);
	if (!audio?.byteLength) throw new SpeechError('Nothing was recorded', 400);
	if (audio.byteLength > MAX_AUDIO_BYTES) throw new SpeechError('That recording is too long', 413);

	const form = new FormData();

	form.append('model_id', EAR_MODEL);
	form.append('tag_audio_events', 'false');
	form.append('file', new Blob([audio], { type }), `said.${type.split('/')[1]?.split(';')[0] || 'webm'}`);

	const response = await fetcher(`${API}/speech-to-text`, {
		method: 'POST',
		headers: { 'xi-api-key': voice.apiKey },
		body: form,
		signal: AbortSignal.timeout(EAR_TIMEOUT_MS),
	}).catch(error => {
		throw new SpeechError(`ElevenLabs could not be reached: ${error.message}`);
	});

	if (!response.ok) {
		const detail = await response.text().catch(() => '');

		if (response.status === 401) throw new SpeechError('ElevenLabs refused the key');
		if (response.status === 429) throw new SpeechError('ElevenLabs is out of quota or rate limited for now');
		throw new SpeechError(`ElevenLabs answered ${response.status}${detail ? `: ${detail.slice(0, 200)}` : ''}`);
	}

	const { text } = await response.json();

	return { text: String(text ?? '').trim() };
};
