import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { SpeechError, hear, initSpeech, readAloud, voiceSettings, wordTimes } from './speech';

// "Tap the star", each character 0.1s apart
const TEXT = 'Tap the star';
const alignment = {
	characters: [...TEXT],
	character_start_times_seconds: [...TEXT].map((_, index) => index / 10),
	character_end_times_seconds: [...TEXT].map((_, index) => (index + 1) / 10),
};

const answering = (status, body) => {
	const calls = [];
	const fetcher = async (url, options) => {
		calls.push({ url, options });

		return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
	};

	return { calls, fetcher };
};

let dir;
const hadKey = process.env.ELEVENLABS_API_KEY;
const hadConfig = process.env.XDG_CONFIG_HOME;

// A config home of the test's own, so neither this machine's paude settings nor its shared key are read
beforeEach(async () => {
	dir = await mkdtemp(join(tmpdir(), 'speech-'));
	await initSpeech(dir);
	process.env.XDG_CONFIG_HOME = join(dir, 'config');
	process.env.ELEVENLABS_API_KEY = 'test-key';
});
afterEach(async () => {
	if (hadKey === undefined) delete process.env.ELEVENLABS_API_KEY;
	else process.env.ELEVENLABS_API_KEY = hadKey;
	if (hadConfig === undefined) delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = hadConfig;
	await rm(dir, { recursive: true, force: true });
});

describe('voiceSettings', () => {
	test("reads the key this machine's other ElevenLabs tools share, and the voice from paude's own settings", async () => {
		delete process.env.ELEVENLABS_API_KEY;
		await mkdir(join(dir, 'config', 'elevenlabs'), { recursive: true });
		await writeFile(join(dir, 'config', 'elevenlabs', 'key'), 'shared-key\n');
		await mkdir(join(dir, 'config', 'paude'), { recursive: true });
		await writeFile(
			join(dir, 'config', 'paude', 'server.json'),
			JSON.stringify({ elevenLabs: { voiceId: 'jessica' } }),
		);

		expect(await voiceSettings()).toEqual({ apiKey: 'shared-key', voiceId: 'jessica', modelId: 'eleven_flash_v2_5' });
	});

	test('is nothing without a key anywhere', async () => {
		delete process.env.ELEVENLABS_API_KEY;
		expect(await voiceSettings()).toBeNull();
	});
});

describe('wordTimes', () => {
	test("times each word from its characters' times", () => {
		expect(wordTimes(TEXT, alignment)).toEqual([
			{ start: 0, end: 0.3 },
			{ start: 0.4, end: 0.7 },
			{ start: 0.8, end: 1.2 },
		]);
	});

	test('carries the last time over a word the voice did not time', () => {
		expect(wordTimes('a b', { character_start_times_seconds: [0.5], character_end_times_seconds: [0.6] })).toEqual([
			{ start: 0.5, end: 0.6 },
			{ start: 0.6, end: 0.6 },
		]);
	});
});

describe('readAloud', () => {
	test('asks ElevenLabs with the key, and answers the audio with a time per word', async () => {
		const { calls, fetcher } = answering(200, { audio_base64: 'QUJD', alignment });
		const spoken = await readAloud(TEXT, { fetcher });

		expect(spoken).toEqual({
			audio: 'QUJD',
			words: [
				{ start: 0, end: 0.3 },
				{ start: 0.4, end: 0.7 },
				{ start: 0.8, end: 1.2 },
			],
		});
		expect(calls[0].url).toContain('/text-to-speech/21m00Tcm4TlvDq8ikWAM/with-timestamps');
		expect(calls[0].options.headers['xi-api-key']).toBe('test-key');
		expect(JSON.parse(calls[0].options.body)).toEqual({ text: TEXT, model_id: 'eleven_flash_v2_5' });
	});

	test('says a text it has said before from the cache, without asking again', async () => {
		const { calls, fetcher } = answering(200, { audio_base64: 'QUJD', alignment });

		await readAloud(TEXT, { fetcher });
		const again = await readAloud(TEXT, { fetcher });

		expect(again.audio).toBe('QUJD');
		expect(calls).toHaveLength(1);
	});

	test('names what went wrong upstream', async () => {
		await expect(readAloud(TEXT, { fetcher: answering(401, 'nope').fetcher })).rejects.toThrow('refused the key');
		await expect(readAloud(TEXT, { fetcher: answering(429, '').fetcher })).rejects.toThrow('quota');
		await expect(readAloud(TEXT, { fetcher: answering(500, 'boom').fetcher })).rejects.toThrow('answered 500: boom');
	});

	test('without a key there is no voice, and the page knows to use its own', async () => {
		delete process.env.ELEVENLABS_API_KEY;

		const failure = await readAloud(TEXT, { fetcher: answering(200, {}).fetcher }).catch(error => error);

		expect(failure).toBeInstanceOf(SpeechError);
		expect(failure.status).toBe(404);
	});
});

describe('hear', () => {
	test('sends the recording to Scribe and answers its text', async () => {
		const calls = [];
		const fetcher = async (url, options) => {
			calls.push({ url, options });

			return Response.json({ text: ' Make the frog green. ' });
		};

		expect(await hear(new Uint8Array([1, 2, 3]).buffer, 'audio/webm;codecs=opus', { fetcher })).toEqual({
			text: 'Make the frog green.',
		});
		expect(calls[0].url).toContain('/speech-to-text');
		expect(calls[0].options.body.get('model_id')).toBe('scribe_v1');
		expect(calls[0].options.body.get('file').name).toBe('said.webm');
	});

	test('an empty recording is refused before it goes anywhere', async () => {
		await expect(hear(new ArrayBuffer(0), 'audio/webm', { fetcher: async () => Response.json({}) })).rejects.toThrow(
			'Nothing was recorded',
		);
	});
});
