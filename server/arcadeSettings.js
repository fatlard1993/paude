import { readFileSync } from 'fs';
import { join } from 'path';

// What Claude works under in a game: auto mode, its classifier answering whatever the allow list doesn't, the deny list
// holding what would reach past the game (root, a push, history rewritten, the disk wiped). No one sits at an arcade
// to answer a permission prompt, so any that would still appear is turned back at once by a hook, with word to find
// another way, and the turn carries on; Claude's own questions to the person aren't permission prompts and pass.
const PROMPTS_ANSWERED = '^(?!AskUserQuestion$|ExitPlanMode$).*';
const TURNED_BACK = JSON.stringify({
	hookSpecificOutput: {
		hookEventName: 'PermissionRequest',
		decision: {
			behavior: 'deny',
			message:
				'Nobody here answers permission prompts, so this was turned back without asking. Do it another way within the project, or leave it out and carry on.',
		},
	},
});

export const claudeSettings = {
	permissions: {
		defaultMode: 'auto',
		allow: [
			'Read',
			'Glob',
			'Grep',
			'Edit',
			'Write',
			'MultiEdit',
			'WebFetch',
			'WebSearch',
			'Bash(ls *)',
			'Bash(cat *)',
			'Bash(head *)',
			'Bash(tail *)',
			'Bash(wc *)',
			'Bash(grep *)',
			'Bash(rg *)',
			'Bash(find *)',
			'Bash(sed *)',
			'Bash(tree *)',
			'Bash(mkdir *)',
			'Bash(touch *)',
			'Bash(cp *)',
			'Bash(mv *)',
			'Bash(ss *)',
			'Bash(curl *)',
			'Bash(bun *)',
			'Bash(git *)',
		],
		deny: ['Bash(sudo *)', 'Bash(git push*)', 'Bash(git reset --hard*)', 'Bash(rm -rf /*)', 'Bash(rm -rf ~*)'],
	},
	hooks: {
		PermissionRequest: [
			{ matcher: PROMPTS_ANSWERED, hooks: [{ type: 'command', command: `printf '%s' '${TURNED_BACK}'` }] },
		],
	},
};

// The arcade's settings for a project brought into the arcade, added to paude's own when it starts Claude there: such
// a project's .claude settings are its owners', so they're never written; and none for any other folder. Read from
// disk at once, since starting a session doesn't wait.
export const launchSettings = cwd => {
	try {
		return JSON.parse(readFileSync(join(cwd, '.paude-arcade.json'), 'utf8'))?.adopted ? claudeSettings : null;
	} catch {
		return null;
	}
};
