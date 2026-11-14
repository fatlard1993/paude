import { requestMatch } from '@vanilla-bean/components/app';

import { arcadeOf } from '../arcade';
import { SpeechError } from '../speech';
import { gameSpeechToken, speakForGame } from '../gameSpeech';
import { hookSecret } from '../hookSettings';
import { projectPath } from '../projects';

// Where an arcade game's own server asks for a line said aloud: the address it was given (its project and a token of
// its folder) is the login, so the ElevenLabs key never reaches the game. Answers the MP3 itself.
const gameSpeechRoutes = async request => {
	const match = requestMatch('POST', '/api/game-speech/:project/:token', request);

	if (!match) return null;

	const cwd = projectPath(match.project);

	if (!cwd || match.token !== gameSpeechToken(hookSecret, cwd)) return new Response('Not Found', { status: 404 });
	if (!(await arcadeOf(cwd))) return new Response('Lines are said for arcade games', { status: 403 });

	try {
		const { audio, cached, left } = await speakForGame(cwd, await request.json().catch(() => ({})));

		return new Response(audio, {
			headers: { 'content-type': 'audio/mpeg', 'x-cached': String(cached), 'x-characters-left': String(left) },
		});
	} catch (error) {
		if (error instanceof SpeechError) return new Response(error.message, { status: error.status });
		throw error;
	}
};

export default gameSpeechRoutes;
