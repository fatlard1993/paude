# paude

Long-lived Claude Code sessions on a server, shared between terminals and browsers.

Every session is the real `claude` CLI running in a pseudo-terminal on the server. Everyone attached sees the same screen and can type, from a terminal with the `paude` command or from a browser (phones get a key bar). Walk away from one device and pick up on another: the session keeps running.

Beside the terminal, the people in a session have a chat and can comment on selected lines of output. Claude never sees either.

Sessions are ordinary Claude Code sessions, stored under `~/.claude/projects` on the server. `claude --resume <id>` works there too, just not while paude has the session open.

## Trust

There is one password. Anyone who has it can type into any session, which means running commands as the server's user. Share it only with people you'd give that shell to. Changing it (below) signs everyone out, including terminals and open tabs.

## Server

Needs Bun, and Claude Code installed and logged in as the user paude runs as.

```sh
bun install
NODE_ENV=production bun run build
bun run set-password
bun start -- --projects ~/Projects
```

- `--projects`: each subfolder is a project sessions can run in (default `~/Projects`)
- `--host` / `--port`: where paude listens (default `127.0.0.1:8044`)
- `--data`: logins and chat (default `~/.paude`)
- `--claude`: the Claude Code executable (default `claude` on the PATH)

Logins need HTTPS: the login cookie is `Secure`, and browsers only accept it over https or on localhost. Put a TLS proxy in front rather than exposing paude's port. With Caddy and no domain name, Let's Encrypt can certify the server's IP address:

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

Run `bun run set-password` again at any time to change the password; a running server picks it up and signs everyone out.

A session nobody is attached to exits after an hour (later, if Claude is still working). Opening it again resumes it.

## Terminal

```sh
bun link                          # once, in this repo: puts `paude` on your PATH
paude login https://your-server   # trades the password for a token kept in ~/.config/paude
paude                             # pick a session, or a project and then New session
```

Inside a session everything goes to Claude except `Ctrl+]`, which floats paude's box over Claude's screen (which keeps updating behind it): who's here, the chat, open comments, and:

- **c**: send a chat message
- **m**: comment on the text you've selected. Shift+drag over it in Claude first (a plain drag goes to Claude); on macOS, copy it instead.
- a comment's number: read its thread, then **r** to reply or **x** to resolve
- **f**: the project's files. Arrows (or j/k) move, Enter opens a folder or file, **/** filters by name; in a file, **v** marks lines from the cursor and **a** attaches the marked lines (or the whole file) to Claude's prompt without sending
- **s**: switch session; **d**: detach; **Esc**: back to Claude

`PAUDE_NAME` sets the name others see (default: your username). `paude logout` revokes this machine's token on the server.

## Browser

Open the server's address and log in. Set your name at the top of the chat panel.

- **Size:** the session has one size, set by whoever typed last. Typing takes it over; everyone else sees it scaled to fit.
- **Comments:** drag over the terminal to select text (on a phone, press **Select** on the key bar and tap the first and last line), then press **Comment**. Clicking a comment's quote finds it in the terminal.
- **The side panel** (💬) floats over the terminal; drag its left edge to resize it.
- **Project files** (📁): browse, search, and read the session's project (what git shows, so ignored files stay out). Search by name, or by contents with VS Code's options: match case, whole word, regular expression, and files to include or exclude. Code is syntax highlighted; markdown shows rendered or as source (your choice is remembered); images, audio, video and PDFs open in place. Attach a whole file, or click a line number and Shift+click another to attach those lines; either lands in Claude's prompt without sending. The panel can go full screen, and both side panels resize from their inner edge.
- **Scrolling:** the wheel scrolls Claude's own transcript. Claude keeps one screen for everyone, so it scrolls for everyone watching.
- **Start over from a point:** every `done` line Claude prints after a turn is a link. Clicking it starts a new session holding the conversation up to that turn.
- **Names:** click the session's title to pin a name of your own (📌 in the lists); **Use automatic name** goes back to the one Claude keeps up to date. A session started from a point is named after its source, plus "(fork)".
- **Deleting** (🗑 on the session page, or on a card when you hover it) removes the conversation, its chat and comments, and any invites to it.
