import os from 'os';

import { sessionEnvironment } from './sessions/PtySession';
import { claudeCommand } from './sessions/running';

const TIMEOUT_MS = 120_000;

// One question to Haiku through the Claude Code paude runs, on the owner's login: no tools, no settings, nothing
// saved. Its answer as text, '' when there's none (not logged in, out of usage, too slow).
const askHaiku = async prompt => {
	const child = Bun.spawn(
		[
			claudeCommand(),
			'-p',
			'--model',
			'haiku',
			'--output-format',
			'text',
			'--no-session-persistence',
			'--setting-sources',
			'',
			'--tools',
			'',
		],
		{
			cwd: os.tmpdir(),
			env: sessionEnvironment(),
			stdin: new TextEncoder().encode(prompt),
			stdout: 'pipe',
			stderr: 'ignore',
			timeout: TIMEOUT_MS,
		},
	);
	const out = await new Response(child.stdout).text();

	return (await child.exited) === 0 ? out : '';
};

// The JSON object in a reply, perhaps fenced or with words around it; null for none
export const jsonIn = reply => {
	try {
		return JSON.parse(/\{[\s\S]*\}/.exec(reply)?.[0]);
	} catch {
		return null;
	}
};

export default askHaiku;
