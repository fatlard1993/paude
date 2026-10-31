// The universe view's facilities: the room aboard a machine's ship where each of Claude's tools is used. Every Claude
// Code has the core ones; an MCP server has an uplink of its own, there only on the machines whose Claude has used it.
export const CORE_FACILITIES = [
	{ key: 'library', label: 'Archive', about: 'reading and searching files' },
	{ key: 'forge', label: 'Fabricator', about: 'writing and editing files' },
	{ key: 'reactor', label: 'Reactor', about: 'running commands' },
	{ key: 'dish', label: 'Comms', about: 'reaching the web' },
	{ key: 'hatchery', label: 'Drone bay', about: 'sending out agents' },
	{ key: 'tower', label: 'Nav room', about: 'planning and tracking tasks' },
];

const BY_TOOL = {
	library: ['Read', 'Glob', 'Grep', 'LS', 'NotebookRead', 'LSP', 'Skill', 'ToolSearch'],
	forge: ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'],
	reactor: ['Bash', 'BashOutput', 'KillShell', 'KillBash', 'Monitor', 'PowerShell'],
	dish: ['WebFetch', 'WebSearch'],
	hatchery: ['Task', 'Agent', 'Workflow', 'SendMessage', 'TaskStop'],
	tower: ['TodoWrite', 'TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet', 'EnterPlanMode', 'ExitPlanMode'],
};
const FACILITY_OF = new Map(Object.entries(BY_TOOL).flatMap(([key, names]) => names.map(name => [name, key])));

// mcp__<server>__<tool>; the server's name may have underscores of its own
const mcpServer = tool => tool.match(/^mcp__(.+?)__/)?.[1];

// The facility a tool is used at; one nothing names goes to cargo
export const facilityOf = tool => {
	if (!tool) return null;

	const server = mcpServer(tool);

	return server ? `mcp:${server}` : (FACILITY_OF.get(tool) ?? 'outpost');
};

// A machine's facilities, from every tool its Claude has used: the core ones, then each MCP server's, then cargo
// once a tool nothing names has been used
export const facilitiesFor = tools => {
	const keys = new Set(tools.map(facilityOf));
	const servers = [...keys].filter(key => key?.startsWith('mcp:')).sort();

	return [
		...CORE_FACILITIES,
		...servers.map(key => ({ key, label: `${key.slice(4)} uplink`, about: 'an MCP server', mcp: true })),
		...(keys.has('outpost') ? [{ key: 'outpost', label: 'Cargo', about: 'tools of other kinds' }] : []),
	];
};
