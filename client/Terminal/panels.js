// What each of a session's panels is called wherever it's offered: the session page's buttons and phone menu, a
// project's page, and the universe's dock tabs and session menu. The label is the one word on a button or tab; `about`
// is what the panel holds, after a colon in a tooltip.
export const PANELS = {
	terminal: { label: 'Terminal', about: "the session's own screen, live", icon: 'display' },
	git: { label: 'Git', about: 'changes, history, branches', icon: 'code-branch' },
	files: { label: 'Files', about: "the project's files, to read, edit and compare", icon: 'folder-tree' },
	notes: { label: 'Chat', about: 'messages, comments on the code, and who is invited', icon: 'comments' },
	tasks: { label: 'Tasks', about: "the project's checks and tests, problems, and what's running", icon: 'list-check' },
	activity: { label: 'Activity', about: 'what Claude did, turn by turn', icon: 'clock-rotate-left' },
	artifacts: {
		label: 'Artifacts',
		about: 'the screenshots, pages, scripts and data made along the way',
		icon: 'shapes',
	},
	decisions: {
		label: 'Decisions',
		about: "what was settled here, and what isn't recorded anywhere",
		icon: 'scale-balanced',
	},
	links: { label: 'Links', about: 'the docs, tickets, repos and servers that came up', icon: 'link' },
	shares: { label: 'Shared', about: 'services this session runs, files and sites', icon: 'share-nodes' },
	shell: { label: 'Shell', about: 'a terminal in this folder that ends when you close it', icon: 'terminal' },
	arcade: {
		label: 'Arcade',
		about: 'the talk with Claude as a kid has it: big, read aloud, answered by tapping or talking',
		icon: 'gamepad',
	},
	game: { label: 'Game', about: 'the game this session builds, live', icon: 'play' },
};

// A tooltip: the label, then what it holds. The phone menu takes the label back from before the colon.
export const panelTitle = key => `${PANELS[key].label}: ${PANELS[key].about}`;
