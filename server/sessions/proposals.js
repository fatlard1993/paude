// The edits Claude has asked to make and not made yet, from its PreToolUse hook: while a permission prompt waits on
// one, the transcript doesn't have it, since Claude Code records a tool call only once it has run.
export const PROPOSING_TOOLS = ['Edit', 'MultiEdit', 'Write'];
const MAX_INPUT = 2 * 1024 * 1024;
const DONE = ['PostToolUse', 'PostToolUseFailure', 'PermissionDenied'];
const TURN_EDGES = ['UserPromptSubmit', 'Stop', 'StopFailure'];

const pending = new Map();

export const trackProposals = (sessionId, payload) => {
	const event = payload?.hook_event_name;
	const calls = pending.get(sessionId) ?? new Map();

	if (event === 'PreToolUse' && PROPOSING_TOOLS.includes(payload.tool_name)) {
		if (!payload.tool_input || JSON.stringify(payload.tool_input).length > MAX_INPUT) return;

		calls.set(payload.tool_use_id ?? crypto.randomUUID(), { tool: payload.tool_name, input: payload.tool_input });
		pending.set(sessionId, calls);
	} else if (DONE.includes(event)) {
		if (payload.tool_use_id) calls.delete(payload.tool_use_id);
		else for (const [id, call] of calls) if (call.tool === payload.tool_name) calls.delete(id);
	} else if (TURN_EDGES.includes(event)) pending.delete(sessionId);
};

export const proposalsOf = sessionId => [...(pending.get(sessionId)?.values() ?? [])];

export const forgetProposals = sessionId => pending.delete(sessionId);
