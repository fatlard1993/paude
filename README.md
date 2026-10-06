# paude

Claude Code sessions you can reach from anywhere and work in together: the real `claude` CLI, running on your machine or a server, shared between terminals and browsers.

![A session in the browser: Claude's finished change, and a comment thread beside it](docs/web-session.png)

- **One session, many screens.** Every session is `claude` in a pseudo-terminal. Everyone attached sees the same screen, from a terminal (the `paude` command) or a browser, phones included. Walk away from one device and pick up on another; the session keeps running.
- **Company.** Invite people by link as drivers, commenters or watchers. They get a chat, comments on selected output, and emoji reactions, none of which Claude ever sees.
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

Locally there is no password: the server keeps an owner token in `~/.paude/local-token`, readable only by you, and the `paude` command uses it. `paude web` opens this machine's paude in a browser, already logged in. Folders under `~/Projects` are projects without being added; `paude remove <name>` forgets one that was. The first session in a folder Claude Code hasn't seen asks, in the session, whether you trust it.

## On a server

The same server, reachable from anywhere. On Linux with a systemd user session:

```sh
curl -fsSL https://raw.githubusercontent.com/fatlard1993/paude/main/scripts/install.sh | sh
cd ~/.paude-server && bun run set-password
```

That installs to `~/.paude-server` and runs a user service on `127.0.0.1:8044`, serving the folders in `~/Projects`; running it again updates it. Elsewhere, run it yourself: `bun install`, `NODE_ENV=production bun run build`, `bun run set-password`, then `bun start -- --projects ~/Projects`.

| Option             | Default              |                                       |
| ------------------ | -------------------- | ------------------------------------- |
| `--projects`       | `~/Projects`         | each subfolder is a project           |
| `--host`, `--port` | `127.0.0.1`, `8044`  | where paude listens                   |
| `--data`           | `~/.paude`           | logins, chat, comments, added folders |
| `--claude`         | `claude` on the PATH | the Claude Code executable            |

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
```

Then, from any machine: `paude login https://203.0.113.7`. A session nobody is attached to exits after an hour (later if Claude is still working); opening it again resumes it.

## Who can do what

The password belongs to the owner, and the owner can type into any session, which means running commands as the server's user. Give it only to someone you'd give that shell.

Everyone else comes in by invite: in a session's **People** tab, name the person, pick a role and an expiry (an hour, a day, a week), and send them the link. It opens that one session, in a browser or with `paude login <link>`.

| Role    | Can                             |
| ------- | ------------------------------- |
| Drive   | type into Claude, chat, comment |
| Comment | chat and comment                |
| Watch   | read                            |

Revoking an invite, or changing the password with `bun run set-password` (a running server picks it up), signs those people out everywhere at once.

## In the terminal

Inside a session everything goes to Claude except **Ctrl+]**, which floats the box over Claude's screen. Claude keeps working behind it.

![The box over a session: who's here, the chat, an open comment](docs/terminal-box.png)

| Key          |                                                                                           |
| ------------ | ----------------------------------------------------------------------------------------- |
| **c**        | chat                                                                                      |
| **m**        | comment on your selection (Shift+drag over Claude's output first; on macOS, copy it)      |
| **1**-**9**  | open a comment's thread; there, **r** replies, **x** resolves, **+** then a number reacts |
| **f**        | the project's files                                                                       |
| **s**, **d** | switch session, detach                                                                    |
| **Esc**      | back to Claude                                                                            |

In **f**, the reader: arrows (or j/k) move and Enter opens; **/** finds a file by name and **?** searches contents. Alt+C, Alt+W and Alt+R toggle match case, whole word and regex, as in VS Code, and Tab moves to the files to include and exclude. Code is highlighted and markdown is rendered (**m** shows the source; the choice is remembered). In kitty, WezTerm or Ghostty, images show in place.

![The reader: a highlighted file with lines marked](docs/terminal-files.png)

| Key   | In a file                                                                                              |
| ----- | ------------------------------------------------------------------------------------------------------ |
| **v** | mark lines from the cursor                                                                             |
| **a** | attach the marked lines, or the whole file, to Claude's prompt (nothing is sent until you press Enter) |
| **y** | copy them to your clipboard                                                                            |
| **z** | full screen                                                                                            |

`PAUDE_NAME` sets the name others see (default: your username). `paude logout` revokes this machine's token on the server.

## In the browser

Open the server's address and log in, or follow an invite link.

![The browser's reader, full screen, with lines marked](docs/web-files.png)

- **Size.** A session has one size, set by whoever typed last; everyone else sees it scaled to fit.
- **Scrolling.** The wheel scrolls Claude's transcript, for everyone, since there is one screen.
- **Comments.** Drag over the terminal to select (on a phone, **Select** on the key bar, then tap the first and last line) and press **Comment**. Clicking a comment's quote finds it in the terminal. Reactions work on chat, comments and replies; click one to add or take back yours.
- **Files.** The reader, from the folder button in the bar: search by name or contents with the same options as the terminal, and read highlighted code, rendered markdown, images, audio, video and PDFs. Click a line number and Shift+click another to attach those lines.
- **Start over from a point.** Each `done` line Claude prints after a turn is a link that starts a new session holding the conversation up to there.
- **Names.** Click a session's title to pin a name (📌); **Use automatic name** goes back to Claude's.

Both side panels float over the terminal and resize from their inner edge.

## Watching

![Home: watched sessions first, with what changed](docs/web-home.png)

A watched session is listed first everywhere, with what it's doing (**working**; **needs you** when Claude is asking for a permission or an answer; **ready** for the next prompt) and how many turns, chat messages and comments landed since you last looked. Watching starts on its own the first time you join a session by invite, post in it, or prompt it; the eye in the session's bar, or **w** in the picker, turns it off and on.
