import { listSessions } from '@anthropic-ai/claude-agent-sdk';

// Lists the saved sessions off the server's thread: the SDK reads and parses the head and tail of every transcript.
// The Claude folder is the asker's, as it was when it asked.
self.onmessage = async ({ data: { id, configDir } }) => {
	if (configDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
	else process.env.CLAUDE_CONFIG_DIR = configDir;

	try {
		postMessage({ id, sessions: await listSessions() });
	} catch (error) {
		postMessage({ id, error: error.message });
	}
};
