# paude

Claude Code sessions you can reach from anywhere and work in together: the real `claude` CLI, running on your machine or a server, shared between terminals and browsers.

![A session in the browser: Claude's finished change, and a comment thread beside it](docs/web-session.png)

- **One session, many screens.** Every session is `claude` in a pseudo-terminal. Everyone attached sees the same screen, from a terminal (the `paude` command) or a browser, phones included. Walk away from one device and pick up on another; the session keeps running.
- **Company.** Invite people by link as drivers, commenters or viewers. They get a chat, comments on selected output, and emoji reactions, all between people unless someone presses **Ask Claude**: then it's typed into Claude, and Claude's answer comes back to the chat or the comment's thread.
- **The project at hand.** Browse, search and read the session's files, with syntax highlighting and rendered markdown, and attach a file or a few lines to the prompt.
- **What needs you.** Watched sessions show whether Claude is working, waiting on you, or ready, and how much happened since you last looked, across every paude you use.

Sessions are ordinary Claude Code sessions, stored under `~/.claude/projects`; `claude --resume <id>` opens one directly, though not while paude has it open.

## On your machine

Needs [Bun](https://bun.sh) and Claude Code, logged in.

```sh
git clone https://github.com/fatlard1993/paude && cd paude
bun install && bun link   # puts `paude` on your PATH
cd ~/work/my-app
paude add                 # this folder becomes a project; this machine's paude starts in the background
paude                     # the picker: sessions and projects here and on every paude you're logged into
```

![The picker: watched sessions from two paudes first, then each one's projects](docs/terminal-picker.png)

Working on paude itself? `sh scripts/install.sh --dev` from your checkout runs that checkout as this machine's paude service (systemd, or launchd on macOS): it restarts itself as you save, rebuilds the web client and reloads open pages, and sessions carry on through it. Running the installer without `--dev` goes back to an installed copy.

`bun test` runs the unit tests (the pre-commit hook does too). `bun run test:e2e` drives the web client in Chrome against a fake Claude that draws the way Claude Code does, in three browsers: xterm's DOM renderer, its GPU renderer, and a Mac. `bun run test:claude` does the same against the real Claude Code, at the cost of a few tokens. Both look for Chrome in the usual places, or `CHROME`.

Locally there is no password: the server keeps an owner token in `~/.paude/local-token`, readable only by you, and the `paude` command uses it. `paude web` opens this machine's paude in a browser, already logged in. Folders under `~/Projects` are projects without being added. `paude add` takes several folders, or a pattern: `paude add '~/Projects/minecraft/*'` makes each folder in there a project of its own. `paude remove <name>...` takes projects off the list: an added folder is forgotten, one under `~/Projects` is hidden until you add it again. Nothing on disk changes either way, and the home page's project cards do the same. `paude stop` stops the background server (after pulling an update, say); the next `paude` starts it again. The first session in a folder Claude Code hasn't seen asks, in the session, whether you trust it.

## On a server

The same server, kept running as a service and reachable from elsewhere. On Linux with a systemd user session, or macOS:

```sh
curl -fsSL https://raw.githubusercontent.com/fatlard1993/paude/main/scripts/install.sh | sh
cd ~/.paude-server && bun run set-password
```

That installs to `~/.paude-server` and runs a user service (a launchd agent on macOS, which also links the `paude` command) on `127.0.0.1:8044`, serving the folders in `~/Projects`; running it again updates it. Elsewhere, run it yourself: `bun install`, `NODE_ENV=production bun run build`, `bun run set-password`, then `bun start -- --projects ~/Projects`.

| Option             | Default              |                                            |
| ------------------ | -------------------- | ------------------------------------------ |
| `--projects`       | `~/Projects`         | each subfolder is a project                |
| `--host`, `--port` | `127.0.0.1`, `8044`  | where paude listens                        |
| `--data`           | `~/.paude`           | logins, chat, comments, added folders      |
| `--claude`         | `claude` on the PATH | the Claude Code executable                 |
| `--preview-port`   | `--port` + 1         | where shared services and files are served |

Logins need HTTPS: the login cookie is `Secure`, which browsers accept only over https or on localhost. Put a TLS proxy in front instead of exposing the port. With Caddy and no domain name, Let's Encrypt can certify the server's IP address:

```
203.0.113.7 {
	tls {
		issuer acme {
			profile shortlived
		}
	}
	reverse_proxy 127.0.0.1:8044
}

203.0.113.7:8444 {
	tls {
		issuer acme {
			profile shortlived
		}
	}
	reverse_proxy 127.0.0.1:8045
}
```

The second site is where sessions share their services and files (see [Sharing](#sharing)): port 8444 in front of paude's preview port. It's a separate origin on purpose, so an app shown there can't act as you on paude. Another port in front of it goes in `~/.config/paude/server.json` as `{ "previewPort": 9444 }`.

For a phone on the same network instead, Caddy can sign for the machine's own name with its own certificate authority, which the phone then trusts once (on an iPhone: install the profile, then turn it on under Settings → General → About → Certificate Trust Settings). Caddy keeps that authority's certificate in its data folder as `pki/authorities/local/root.crt`:

```
{
	skip_install_trust
}

workbook.local {
	tls internal
	reverse_proxy 127.0.0.1:8044
}

workbook.local:8444 {
	tls internal
	reverse_proxy 127.0.0.1:8045
}
```

Then, from any machine: `paude login https://203.0.113.7 --name vps` (the name is how the picker shows it; `paude name <url> <name>` renames a login you have). A server can name itself too: `paude name vps` on the server puts the name in its browser tab title and is what other machines show it as, unless they gave it a name of their own. A session nobody is attached to exits after an hour (later if Claude is still working); opening it again resumes it. With [dtach](https://github.com/crigler/dtach) installed (`paude doctor` checks), sessions keep running through a server restart or update, and the new server takes them back.

A paude on your own network behind Caddy's `tls internal` has a certificate from that Caddy's own authority, which nothing trusts yet. Put the authority's root certificate (`root.crt`, under Caddy's `pki/authorities/local`) in `~/.config/paude/certificates.pem` on the machine logging in. That file can hold several, one after another. The paude command and this machine's server then trust them, and a browser needs the same certificate trusted on its own.

## Sharing

What a session runs and makes can be opened from any device logged in to paude, at its own address on the preview port (8444 behind Caddy): `https://<host>:8444/s/<name>/`. The share button in a session's bar lists them, with links to open or copy, and buttons to rename (its address) or stop each. A service is named for its project and port (`shop-5173`) until it's renamed.

- **Services.** A server the session starts (a dev server Claude runs, or one from its terminal) is found once it listens and shared while it does. Any other port on the machine can be forwarded by hand. An app's own absolute paths (`/assets/app.js`) and WebSockets (a dev server's live reload) work without telling it about the `/s/<name>/` prefix.
- **Files.** A file in the project to download, or a folder as a zip.
- **Sites.** A folder served as a website, a built `dist/` say, with no server running.

Only people logged in who can see the session open them: the owner, and that session's invitees. Sharing something new takes the drive role. The preview port is another origin, so a shared app's code can't reach paude's API as whoever is looking at it, and paude's login cookie is never passed on to the app.

## Worktrees

Starting a session in a git project asks where it should go. It shows how many sessions run here and in which checkout, then offers the main checkout, a worktree to join, or a new one. In the browser that's under the prompt on the project page; in the terminal, a step after **＋ New session**.

A new worktree goes in `.paude/worktrees/<name>` inside the project, on a branch of the same name. Left unnamed, it's named after the first words of the prompt. Paude adds `.paude/` to the repo's local exclude file, so the main checkout never lists it as untracked. Every worktree of the repo can be joined, wherever it lives; once joined, it counts as part of the project rather than a project of its own.

Deleting a session also removes the worktree paude made for it, once no other session, running or saved, is in it. A worktree with uncommitted changes is kept, and the page says so. The branch stays.

A repo with its own way of making worktrees (a workspace tool that installs dependencies, say) gets an entry in `~/.config/paude/worktrees.json`. The key is the repo's remote, so one entry works on every machine, or the main checkout's path:

```json
{
	"github.com/org/repo": {
		"create": "yarn tool workspace create {name}",
		"remove": "yarn tool workspace remove {name}"
	}
}
```

The commands run in the main checkout. `{name}` and `{path}` are filled in already quoted, so don't put quotes around them; they're also in `$PAUDE_WORKTREE_NAME` and `$PAUDE_WORKTREE_PATH`. The new worktree is whichever one appears, so the tool can name and place it as it likes. Its output shows on the page, or in the terminal, while it runs. Without `remove`, it's `git worktree remove`.

## Who can do what

The password belongs to the owner, and the owner can type into any session, which means running commands as the server's user. Give it only to someone you'd give that shell.

Everyone else comes in by invite: in a session's **People** tab, name the person, pick a role and an expiry (an hour, a day, a week), and send them the link. It opens that one session, in a browser or with `paude login <link>`.

A Drive invite can type into Claude, which runs commands as the server's user: give it to someone you'd give that shell, as with the password.

| Role    | Can                                                                      |
| ------- | ------------------------------------------------------------------------ |
| Drive   | type into Claude, open a terminal, edit files, and everything below |
| Comment | chat, comment, read the project's files                                  |
| View    | see the terminal                                                         |

Other servers this machine is logged into (with `paude login`) show on the home page only for this machine's own logins: the paude command and `paude web`. A password login from elsewhere doesn't get them, so one server's password doesn't open the rest. On a machine only your own network reaches (a laptop serving your phone), `{ "shareRemotes": true }` in `~/.config/paude/server.json` lists them for the password too. Invites never get them.

In chat and comments the owner goes by this machine's user name, or by `ownerName` in that same file (`{ "ownerName": "Alice" }`) where the user is a service account. The paude command goes by your own user name, or `PAUDE_NAME`. A guest goes by the name on their invite.

Revoking an invite, or changing the password with `bun run set-password` (a running server picks it up), signs those people out everywhere at once.

## In the terminal

Inside a session everything goes to Claude except **Ctrl+]** (**Cmd+]** on a Mac, in a terminal that passes it on, such as kitty), which floats the box over Claude's screen. Claude keeps working behind it. A terminal that keeps Cmd+] for itself (iTerm2, Ghostty) can be set to send Ctrl+] (the byte `0x1d`) for it instead.

![The box over a session: who's here, the chat, an open comment](docs/terminal-box.png)

| Key |  |
| --- | --- |
| **c** | chat |
| **m** | comment on your selection (Shift+drag over Claude's output first; on macOS, copy it) |
| **C** | ask Claude: typed into Claude as a prompt, its answer posted back in the chat |
| **1**-**9** | open a comment's thread; there, **r** replies, **A** asks Claude (its answer lands in the thread), **x** resolves (or reopens), **+** then a number reacts, **D** twice deletes it |
| **f** | the project's files |
| **t** | a terminal: a shell in the session's folder, for a few quick commands. Ctrl+] brings the box back over it: **a** quotes your selection in Claude's prompt, **k** ends it, **Esc** returns to it. It ends when you go back to Claude |
| **s**, **d** | switch session, detach |
| **Esc** | back to Claude |

In **f**, the reader: arrows (or j/k) move and Enter opens; **/** finds a file by name, **?** searches contents, and **c** lists changes: what Claude proposes, what changed since the last commit (the tree marks those files M, A, D, R or U, as VS Code does), and what each of Claude's turns changed. Alt+C, Alt+W and Alt+R toggle match case, whole word and regex, as in VS Code, and Tab moves to the files to include and exclude. Code is highlighted and markdown is rendered (**m** shows the source; the choice is remembered). In kitty, WezTerm or Ghostty, images show in place.

![The reader: a highlighted file with lines marked](docs/terminal-files.png)

| Key   | In a file                                                                                                |
| ----- | -------------------------------------------------------------------------------------------------------- |
| **v** | mark lines from the cursor                                                                               |
| **a** | attach the marked lines, or the whole file, to Claude's prompt (nothing is sent until you press Enter)   |
| **y** | copy them to your clipboard                                                                              |
| **z** | full screen                                                                                              |
| **e** | edit it in your editor, in the terminal; quitting the editor comes back here with the file reloaded |
| **c** | its changes, if it has any                                                                               |

In a diff, **v** marks lines, **a** attaches the marked lines (or all of it) as a diff, **y** copies, **o** opens the file under the cursor and **s** switches between side by side (where the box is wide enough) and unified. **e** uses `$PAUDE_EDITOR`, `$VISUAL` or `$EDITOR` when it names an editor that runs in a terminal, and otherwise the first of nvim, vim, nano and vi that's installed.

In kitty, an attached session tints the window with the session's color, as in the browser, and puts the window's own colors back on leaving. A session that won't start (its folder gone, Claude Code missing) says why instead of waiting.

`PAUDE_NAME` sets the name others see (default: your username). `paude logout` revokes this machine's token on the server.

## In the browser

Open the server's address and log in, or follow an invite link.

![The browser's reader, full screen, with lines marked](docs/web-files.png)

- **Colors.** Each session has a color of its own, from its id: its screen's background, the edge of its bar, and a stripe on its card, so sessions in one project tell apart at a glance. A project's card takes its folder's color instead. The hues and tints are those of kitty-bg, which tints a kitty window by its folder.
- **Dropping files.** Drop a file on the terminal, or paste a screenshot, and it's saved on the session's machine (in `~/.paude/attachments`, outside the project) and its path put in Claude's prompt; an image's path becomes an attached image. It takes the drive role.
- **Size.** A session has one size, set by whoever typed last; everyone else sees it scaled to fit.
- **Scrolling.** The wheel scrolls Claude's transcript, for everyone, since there is one screen.
- **Git.** The branch button in a session's bar opens the Git panel: what's staged and what isn't, with a button to stage, unstage or discard each file (or all), and a commit box (Ctrl+Enter commits; it can amend). **Claude, write it** has a Claude of its own read what's staged and write the message in the repository's style, for you to edit; the session's own conversation is left alone. Its bar names the repository (the session's folder's, which isn't always the one Claude is working in) beside the branch, with fetch, pull (fast-forward only) and push; a first push tracks origin. History lists the commits, and clicking one shows its changes in the files panel. **Review** shows what the branch adds beyond the main line (its commits, and its changes in the files panel) and its pull request through GitHub's `gh`: open one with a title and description Claude drafts, then watch its state and checks. A merge, rebase or cherry-pick that stops on conflicts can be settled from **Changes** (keep mine or theirs for each file) and carried on or given up. Branches makes, switches and deletes them (git keeps one whose work isn't merged, and says so); Stashes stashes the changes and brings them back. Reading takes the comment role; changing anything takes the drive role.
- **Activity.** The clock in a session's bar shows what Claude did, turn by turn: each prompt, how long it took, and the tools Claude used in order (what it read, edited and ran, and whether each worked), with how much context the session is using. An edit opens the turn's changes, a read opens the file, and a command shows what it printed.
- **Links.** The link button gathers every link that came up in the session: in your prompts, Claude's replies, pages it fetched or searched, and the chat and comments, each with who brought it up and how often. Haiku describes each one in a few words from what was said around it, once per link, in the background through your Claude login (until it has, the clearest sentence said about it shows). They're sorted into docs, tickets, repos, servers and the rest, the latest day first and the most mentioned first within a day; pin the ones that matter, hide the noise. Links only a command printed are left out unless you ask for them, and the contents of files Claude read never count. A project's page has the same list across its latest sessions, each link naming the sessions it came up in.
- **Tasks.** The checklist in a session's bar runs the project's own commands: its package.json scripts (with the package manager its lockfile names), Makefile targets, justfile recipes, and Cargo, Go and pytest checks. A run's output streams in; a test run shows its counts; and the problems in what it printed (`file:line` from compilers, linters and test failures) are listed, each opening its file at the line, all of them ready to attach to Claude's prompt. A task can run after each of Claude's turns that edits files, so the problems stay current. The same panel lists what the session is running, with its memory and CPU, and stops any of it.
- **Search and replace.** The files panel's Contents search has a Replace box: every match across the project replaced at once, after asking (a regular expression's replacement can use its groups, `$1`). Regular expressions, in search and replace, are JavaScript's. With nothing typed, it offers the project's to-dos: TODO, FIXME, HACK and XXX.
- **Environment.** The Tasks panel shows what the session's processes see in their environment, and what the project's `.env` files set, never sending a secret's value: a name that sounds secret, and every `.env` value, shows only its length.
- **Finding your way.** In the files panel, **Symbols** finds functions, classes and types across the project, and **Outline** lists the open file's. Ctrl+click (Cmd+click) a name in a file to go where it's defined, with Shift to list everywhere it's used; on a phone, select the name and **Definition** and **Uses** appear. It reads each language's declarations (JavaScript and TypeScript, Python, Go, Rust, Ruby, Java, Kotlin, C#, PHP, C, shell and more) without a language server, so it works in any project at once, if less exactly than a compiler would.
- **A file's past.** In the files panel, **History** lists the commits that changed the file open, and **Blame** shows beside each line who last changed it; either opens that commit.
- **Back.** When other watched sessions are waiting for you, the back arrow counts them, and pressing it offers them: back where you came from, or straight to one of them, on any server.
- **Comments.** Drag over the terminal to select (on a phone, **Select** on the key bar, then tap the first and last line) and press **Comment**. Clicking a comment's quote finds it in the terminal. Reactions work on chat, comments and replies; click one to add or take back yours. **Ask Claude** beside Send (or Ctrl+Enter) sends a chat message, comment or reply to Claude as well, once its prompt box is empty and it isn't asking anything; a comment brings its quoted output along. Only those who may type into Claude see it. Whoever wrote a comment or reply can delete it (a comment takes its replies with it), and the owner can delete any.
- **Files.** The reader, from the folder button in the bar: search by name or contents with the same options as the terminal, and read highlighted code, rendered markdown, images, audio, video and PDFs. Click a line number and Shift+click another (on a phone, tap another) to attach those lines.
- **Changes.** The reader's **Changes** lists what Claude proposes while it waits on a permission prompt, what changed since the last commit (staged or not, and marked in the tree), and what each of Claude's turns changed. **Compare...** on a file you're reading diffs it against another. Every diff reads the same way, side by side where there's room (**Unified** switches, and the choice is remembered): attach a hunk, the lines you pick, or all of it. A turn shows what Claude's own edit tools changed; changes made by commands it ran (`sed`, `rm`) aren't recorded by Claude Code, so they show only against the last commit.
- **Editing.** **Edit** on a file you're reading; Ctrl+S saves. If the file changed since you opened it (Claude saved it, most likely), saving stops and asks whether to save yours anyway or load theirs.
- **Terminal.** The terminal button in the bar opens a shell in the session's folder, yours alone, which ends when you close it. Select some output (on a phone, **Select**, then the first and last line) and **Attach selection** quotes it in Claude's prompt.
- **Start over from a point.** Each `done` line Claude prints after a turn is a link that starts a new session holding the conversation up to there.
- **Finding a session.** Home's search box looks through every session, and a project's through its own: each word you type has to appear in the title, the prompt it began with, the project, branch or worktree. **Show more** pages on. In the terminal, **▸ All sessions** in the picker does the same as you type.
- **Names.** Click a session's title to pin a name (📌); **Use automatic name** goes back to Claude's.

The side panels float over the terminal and resize from their inner edge.

![The Git panel's changes, one of them open in the diff view](docs/web-git.png)

![The Links panel: each link described, with who brought it up](docs/web-links.png)

## Watching

![Home: watched sessions first, with what changed](docs/web-home.png)

A watched session is listed first everywhere, with what it's doing (**working**; **needs you** when Claude is asking for a permission or an answer; **ready** for the next prompt) and how many turns, chat messages and comments landed since you last looked. Watching starts on its own the first time you join a session by invite, post in it, or prompt it; the eye in the session's bar, or **w** in the picker, turns it off and on.

When a watched session starts waiting on you or has news, you get a notification: in the browser once the bell in the chat panel is on (the tab title also counts the sessions waiting on you), and in the terminal through kitty, iTerm2, WezTerm and others that show them. Opened from this machine (the `paude` command, or `paude web`), the home page also lists the sessions on every server your `paude` command is logged into, and opens them there already logged in.

### Keeping a session warm

Claude Code keeps a conversation in its prompt cache for an hour after Claude last did anything; 54 minutes in, it compacts an idle conversation of 200k tokens or more down to a summary, rather than reread all of it uncached when you come back (`"idleCompaction": false` in Claude Code's settings turns that off). **Keep warm** (the coffee cup in the session's bar, for the owner) holds it as it was for 12 hours: whenever Claude has been quiet for 50 minutes, paude types in a ping that Claude answers with a dot, which reads the conversation from the cache and keeps it there. A ping waits while Claude is working, asking something, or has something typed in its prompt box, and its turn isn't counted as news for anyone watching. Each costs a cached read of the whole conversation (about a tenth of reading it fresh), so it's worth it for deep work you'll come back to, not for every session. A session kept warm isn't closed for sitting unattended, and stops being kept warm when it ends.
