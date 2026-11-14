import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, expect, test } from 'bun:test';

import { charactersLeft, gameSpeechToken, initGameSpeech, lineRequest, speakForGame } from './gameSpeech';

let dir;
const hadKey = process.env.ELEVENLABS_API_KEY;

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'paude-game-speech-'));
	await initGameSpeech(dir);
	process.env.ELEVENLABS_API_KEY = 'test-key';
});

afterAll(async () => {
	if (hadKey === undefined) delete process.env.ELEVENLABS_API_KEY;
	else process.env.ELEVENLABS_API_KEY = hadKey;
	await rm(dir, { recursive: true, force: true });
});

test('a line is words, with a voice and model named by their ids when named at all', () => {
	expect(lineRequest({ text: ' yo ' })).toEqual({ text: 'yo', voice: undefined, model: undefined });
	expect(() => lineRequest({ text: '' })).toThrow('"text"');
	expect(() => lineRequest({ text: 'x'.repeat(1001) })).toThrow('1000');
	expect(() => lineRequest({ text: 'yo', voice: '../key' })).toThrow('voice');
});

test('a game is named by its folder, and each folder has its own token', () => {
	expect(gameSpeechToken('s', '/a')).not.toBe(gameSpeechToken('s', '/b'));
	expect(gameSpeechToken('s', '/a')).toHaveLength(32);
});

test("a line is said once, paid from the game's characters, and comes from the cache after", async () => {
	const calls = [];
	const fetcher = async (url, options) => {
		calls.push({ url, body: JSON.parse(options.body), key: options.headers['xi-api-key'] });

		return new Response(new Uint8Array([7, 8]));
	};
	const before = charactersLeft('/game');
	const said = await speakForGame('/game', { text: 'mic drop', voice: 'abcdefgh12' }, { fetcher });

	expect([...said.audio]).toEqual([7, 8]);
	expect(said.cached).toBe(false);
	expect(calls[0].url).toContain('/text-to-speech/abcdefgh12?');
	expect(calls[0].key).toBe('test-key');
	expect(charactersLeft('/game')).toBe(before - 'mic drop'.length);

	const again = await speakForGame('/game', { text: 'mic drop', voice: 'abcdefgh12' }, { fetcher });

	expect(again.cached).toBe(true);
	expect(calls).toHaveLength(1);
});

test('what ElevenLabs said comes back with its refusal, so a lapsed payment shows', async () => {
	const fetcher = async () => new Response('{"detail":{"status":"payment_issue"}}', { status: 401 });

	await expect(speakForGame('/game', { text: 'unpaid' }, { fetcher })).rejects.toThrow('payment_issue');
});
