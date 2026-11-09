import { requestMatch } from '@vanilla-bean/components/app';

import { isArcadeSession } from '../arcade';
import { hookSecret } from '../hookSettings';
import { runningSession } from '../sessions/running';
import { SpeechError } from '../speech';
import { makeSound, soundToken } from '../sounds';

// Where an arcade session's Claude asks for a sound for its game: the address it was given (its id and token) is the
// login, so the ElevenLabs key never reaches the session
const soundsRoutes = async request => {
	const match = requestMatch('POST', '/api/sounds/:session/:token', request);

	if (!match) return null;
	if (match.token !== soundToken(hookSecret, match.session)) return new Response('Not Found', { status: 404 });

	const session = runningSession(match.session);

	if (!session) return new Response('That session is not running', { status: 404 });
	if (!(await isArcadeSession(match.session, session.cwd)))
		return new Response('Sounds are made for sessions in the arcade', { status: 403 });

	try {
		return Response.json(await makeSound(match.session, session.cwd, await request.json().catch(() => ({}))));
	} catch (error) {
		if (error instanceof SpeechError) return new Response(error.message, { status: error.status });
		throw error;
	}
};

export default soundsRoutes;
