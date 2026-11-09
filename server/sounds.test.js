import { mkdir, mkdtemp, readFile, rm, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import { initSounds, makeSound, musicRequest, secondsLeft, soundRequest, soundToken } from './sounds';

let dir;
let game;
const hadKey = process.env.ELEVENLABS_API_KEY;

const answering = () => {
	const calls = [];

	return {
		calls,
		fetcher: async (url, options) => {
			calls.push({ url, options });

			return new Response(new Uint8Array([1, 2, 3]));
		},
	};
};

beforeAll(async () => {
	dir = await mkdtemp(join(tmpdir(), 'paude-sounds-'));
	game = join(dir, 'game');
	await mkdir(game);
	await initSounds(join(dir, 'data'));
	process.env.ELEVENLABS_API_KEY = 'test-key';
});

afterAll(async () => {
	if (hadKey === undefined) delete process.env.ELEVENLABS_API_KEY;
	else process.env.ELEVENLABS_API_KEY = hadKey;
	await rm(dir, { recursive: true, force: true });
});

describe('soundRequest', () => {
	test('takes a description, a length and a file inside the game', () => {
		expect(soundRequest({ description: ' zap ', file: 'client/sounds/zap.mp3' })).toEqual({
			description: 'zap',
			seconds: 1.5,
			loop: false,
			file: 'client/sounds/zap.mp3',
		});
	});

	test('refuses no description, a length out of range, and a file outside the game or not an mp3', () => {
		expect(() => soundRequest({ file: 'a.mp3' })).toThrow('Describe');
		expect(() => soundRequest({ description: 'x', seconds: 30, file: 'a.mp3' })).toThrow('seconds');
		for (const file of ['../a.mp3', '/tmp/a.mp3', 'a.wav', 'client/../../a.mp3'])
			expect(() => soundRequest({ description: 'x', file })).toThrow('"file"');
	});
});

describe('makeSound', () => {
	test('asks ElevenLabs for the sound, writes it into the game, and spends its seconds', async () => {
		const { calls, fetcher } = answering();
		const made = await makeSound(
			's1',
			game,
			{ description: 'coin', seconds: 0.6, file: 'client/sounds/coin.mp3' },
			{ fetcher },
		);

		expect(made).toMatchObject({ file: 'client/sounds/coin.mp3', seconds: 0.6, cached: false });
		expect(calls[0].url).toContain('/sound-generation');
		expect(JSON.parse(calls[0].options.body)).toMatchObject({ text: 'coin', duration_seconds: 0.6, loop: false });
		expect([...(await readFile(join(game, 'client/sounds/coin.mp3')))]).toEqual([1, 2, 3]);
		expect(secondsLeft('s1')).toBeCloseTo(89.4);
	});

	test('the same sound again comes from the cache, free', async () => {
		const { calls, fetcher } = answering();
		const made = await makeSound(
			's1',
			game,
			{ description: 'coin', seconds: 0.6, file: 'client/coin2.mp3' },
			{ fetcher },
		);

		expect(made.cached).toBe(true);
		expect(calls).toHaveLength(0);
		expect(secondsLeft('s1')).toBeCloseTo(89.4);
	});

	test("refuses a new sound past the day's budget", async () => {
		const { fetcher } = answering();

		for (let made = 0; made < 9; made++)
			await makeSound('s2', game, { description: `boom ${made}`, seconds: 10, file: `b${made}.mp3` }, { fetcher });

		await expect(
			makeSound('s2', game, { description: 'one more', seconds: 1, file: 'c.mp3' }, { fetcher }),
		).rejects.toThrow('budget');
	});

	test('refuses a folder that leads out of the game through a link', async () => {
		await symlink(dir, join(game, 'out'));

		await expect(makeSound('s3', game, { description: 'x', file: 'out/x.mp3' }, answering())).rejects.toThrow(
			'outside',
		);
	});
});

test("a session's token is its own", () => {
	expect(soundToken('secret', 'a')).toBe(soundToken('secret', 'a'));
	expect(soundToken('secret', 'a')).not.toBe(soundToken('secret', 'b'));
	expect(soundToken('other', 'a')).not.toBe(soundToken('secret', 'a'));
});

describe('music', () => {
	test('a track is instrumental unless asked otherwise, 3 to 120 seconds, into a file inside the game', () => {
		expect(musicRequest({ music: 'calm harp', file: 'client/sounds/menu.mp3' })).toEqual({
			music: 'calm harp',
			seconds: 45,
			instrumental: true,
			file: 'client/sounds/menu.mp3',
		});
		expect(musicRequest({ music: 'x', instrumental: false, seconds: 60, file: 'a.mp3' }).instrumental).toBe(false);
		expect(() => musicRequest({ file: 'a.mp3' })).toThrow('Describe the music');
		expect(() => musicRequest({ music: 'x', seconds: 600, file: 'a.mp3' })).toThrow('120');
		expect(() => musicRequest({ music: 'x', file: '../a.mp3' })).toThrow('"file"');
	});

	test('composes with the music model, from its own budget, apart from sounds', async () => {
		const { calls, fetcher } = answering();
		const made = await makeSound(
			'm1',
			game,
			{ music: 'chiptune desert level', seconds: 60, file: 'client/sounds/level.mp3' },
			{ fetcher },
		);

		expect(made).toMatchObject({ file: 'client/sounds/level.mp3', seconds: 60, cached: false, left: 60 });
		expect(calls[0].url).toBe('https://api.elevenlabs.io/v1/music');
		expect(JSON.parse(calls[0].options.body)).toEqual({
			prompt: 'chiptune desert level',
			music_length_ms: 60_000,
			force_instrumental: true,
			model_id: 'music_v2_5',
		});
		expect(secondsLeft('m1')).toBe(90);
		await expect(
			makeSound('m1', game, { music: 'another long one', seconds: 61, file: 'b.mp3' }, { fetcher }),
		).rejects.toThrow('music budget');
	});
});
