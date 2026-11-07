// What Claude does, as one glyph and one plain word each, wherever a tool use is shown: the activity panel's rows, the
// arcade's "what Claude did" strip. One vocabulary, so the same act looks the same on every page.
export const TOOL_ICONS = {
	Read: 'eye',
	Edit: 'pen',
	MultiEdit: 'pen',
	Write: 'file-pen',
	NotebookEdit: 'pen',
	Bash: 'terminal',
	Grep: 'magnifying-glass',
	Glob: 'folder-open',
	WebFetch: 'globe',
	WebSearch: 'globe',
	Task: 'diagram-project',
	Agent: 'diagram-project',
	TodoWrite: 'list-check',
	AskUserQuestion: 'circle-question',
};

export const TOOL_WORDS = {
	Read: 'looked',
	Edit: 'changed',
	MultiEdit: 'changed',
	Write: 'made',
	NotebookEdit: 'changed',
	Bash: 'ran',
	Grep: 'searched',
	Glob: 'searched',
	WebFetch: 'looked up',
	WebSearch: 'looked up',
	Task: 'got help',
	Agent: 'got help',
	TodoWrite: 'planned',
	AskUserQuestion: 'asked',
};

export const toolIcon = name => TOOL_ICONS[name] ?? 'wrench';

export const toolWord = name => TOOL_WORDS[name] ?? 'worked';
