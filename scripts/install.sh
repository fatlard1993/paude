#!/usr/bin/env sh
# paude installer and updater (the same command does both):
#   curl -fsSL https://raw.githubusercontent.com/fatlard1993/paude/main/scripts/install.sh | sh
#
# Linux (a systemd user service) or macOS (a launchd agent). Installs to ~/.paude-server, runs on 127.0.0.1:8044,
# and serves sessions in the subfolders of ~/Projects. Put HTTPS in front (see the README) before reaching it from
# anywhere else.
#
# From a checkout, `sh scripts/install.sh --dev` runs that checkout as the service instead: as it is (no clone, no
# pull), in development, restarting itself as files change. Running the plain installer again goes back.

set -e

REPO="https://github.com/fatlard1993/paude"
APP="${PAUDE_APP:-$HOME/.paude-server}"
PROJECTS="${PAUDE_PROJECTS:-$HOME/Projects}"
PORT="${PAUDE_PORT:-8044}"
DATA="${PAUDE_DATA:-$HOME/.paude}"
UNIT="$HOME/.config/systemd/user/paude.service"
LABEL="com.github.fatlard1993.paude"
AGENT="$HOME/Library/LaunchAgents/$LABEL.plist"

DEV=no
for arg in "$@"; do [ "$arg" = "--dev" ] && DEV=yes; done
if [ "$DEV" = yes ]; then
	APP="$(cd "$(dirname "$0")/.." && pwd)"
	MODE=development
	WATCH="--watch "
	AGENT_WATCH="
		<string>--watch</string>"
else
	MODE=production
	WATCH=""
	AGENT_WATCH=""
fi

say() { printf '> %s\n' "$*"; }
die() {
	printf 'x %s\n' "$*" >&2
	exit 1
}

case "$(uname -s)" in
Linux)
	PLATFORM=linux
	if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user status >/dev/null 2>&1; then
		die "paude needs a systemd user session on Linux."
	fi
	command -v git >/dev/null 2>&1 || die "git is required: sudo apt install git"
	;;
Darwin)
	PLATFORM=macos
	command -v git >/dev/null 2>&1 || die "git is required: xcode-select --install"
	;;
*) die "paude runs on Linux (systemd) or macOS." ;;
esac

for candidate in "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun" /usr/local/bin/bun /opt/homebrew/bin/bun; do
	if [ -x "$candidate" ] && ! command -v bun >/dev/null 2>&1; then PATH="$(dirname "$candidate"):$PATH"; fi
done

if ! command -v bun >/dev/null 2>&1; then
	say "Installing Bun"
	curl -fsSL https://bun.sh/install | bash
	PATH="$HOME/.bun/bin:$PATH"
fi

BUN="$(command -v bun)"
# Claude's Bash tool loads the shell named here; a service manager's own SHELL can predate a chsh, leaving sessions
# in a shell without the login shell's PATH and tools
if [ "$PLATFORM" = macos ]; then
	LOGIN_SHELL="$(dscl . -read "/Users/$(id -un)" UserShell | awk '{ print $2 }')"
else
	LOGIN_SHELL="$(getent passwd "$(id -un)" | cut -d: -f7)"
fi
BREW_BIN=""
for prefix in /home/linuxbrew/.linuxbrew /opt/homebrew /usr/local; do
	if [ -x "$prefix/bin/brew" ]; then BREW_BIN="$BREW_BIN$prefix/bin:"; fi
done
# Services don't read the login shell's PATH, and sessions need claude (and dtach, and the person's tools) on it
SERVICE_PATH="$HOME/.local/bin:$(dirname "$BUN"):$BREW_BIN/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

if ! command -v claude >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/claude" ]; then
	say "Claude Code isn't installed for this user; sessions need it: curl -fsSL https://claude.ai/install.sh | bash"
fi

if [ "$DEV" = yes ]; then
	[ -f "$APP/server/index.js" ] || die "--dev runs from a paude checkout: sh scripts/install.sh --dev"
	say "Running the checkout at $APP, in development"
	changed=no
elif [ -d "$APP/.git" ]; then
	before="$(git -C "$APP" rev-parse HEAD)"
	say "Updating $APP"
	git -C "$APP" pull --ff-only --quiet
	changed=$([ "$before" != "$(git -C "$APP" rev-parse HEAD)" ] && echo yes || echo no)
else
	say "Cloning into $APP"
	git clone --quiet --depth=1 "$REPO" "$APP"
	changed=yes
fi

# A run that pulled and then failed left the server on the old code; the commit last started says so
STARTED="$DATA/installed-commit"
if [ "$DEV" = no ] && [ "$(cat "$STARTED" 2>/dev/null)" != "$(git -C "$APP" rev-parse HEAD)" ]; then changed=yes; fi

cd "$APP"
if [ "$DEV" = yes ]; then
	say "Installing dependencies"
	# The development server builds the client itself, and again whenever it changes
	"$BUN" install >/dev/null
else
	say "Installing dependencies and building"
	# Without scripts: the prepare script would build (again) and point git hooks at a checkout nobody commits from
	"$BUN" install --frozen-lockfile --ignore-scripts >/dev/null
	NODE_ENV=production "$BUN" run build >/dev/null
fi

restart_note() {
	if PATH="$SERVICE_PATH" command -v dtach >/dev/null 2>&1; then
		say "Restarting paude (running sessions carry on)"
	else
		say "Restarting paude (running sessions restart and resume when reopened; install dtach and they carry on instead)"
	fi
}

install_systemd() {
	mkdir -p "$(dirname "$UNIT")"
	unit_text="[Unit]
Description=paude: shared Claude Code sessions
After=network.target

[Service]
WorkingDirectory=$APP
ExecStart=$BUN ${WATCH}server/index.js --projects $PROJECTS --host 127.0.0.1 --port $PORT
Environment=NODE_ENV=$MODE
Environment=SHELL=$LOGIN_SHELL
Environment=PATH=$SERVICE_PATH
# A restart stops the server only: sessions held by dtach carry on, and the new server takes them back
KillMode=process
Restart=on-failure
RestartSec=5

[Install]
WantedBy=default.target
"

	# A paude started by hand with systemd-run holds the same name and has to go first
	if [ "$(systemctl --user show paude.service -p Transient --value 2>/dev/null)" = "yes" ]; then
		say "Replacing a hand-started paude"
		systemctl --user stop paude.service
	fi

	if [ ! -f "$UNIT" ] || [ "$(cat "$UNIT")" != "$unit_text" ]; then
		printf '%s' "$unit_text" >"$UNIT"
		systemctl --user daemon-reload
		changed=yes
	fi

	# Keeps the service running with nobody logged in
	command -v loginctl >/dev/null 2>&1 && loginctl enable-linger "$(id -un)" 2>/dev/null || true

	if ! systemctl --user is-active --quiet paude.service; then
		say "Starting paude"
		systemctl --user enable --now paude.service >/dev/null 2>&1
	elif [ "$changed" = yes ]; then
		restart_note
		systemctl --user restart paude.service
	fi
}

install_launchd() {
	mkdir -p "$(dirname "$AGENT")" "$DATA"
	# Started at login, and again after a crash but not after a clean stop (paude stop). A stop ends the server
	# alone: sessions held by dtach carry on, and the next server takes them back.
	agent_text="<?xml version=\"1.0\" encoding=\"UTF-8\"?>
<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">
<plist version=\"1.0\">
<dict>
	<key>Label</key>
	<string>$LABEL</string>
	<key>ProgramArguments</key>
	<array>
		<string>$BUN</string>$AGENT_WATCH
		<string>server/index.js</string>
		<string>--projects</string>
		<string>$PROJECTS</string>
		<string>--host</string>
		<string>127.0.0.1</string>
		<string>--port</string>
		<string>$PORT</string>
	</array>
	<key>WorkingDirectory</key>
	<string>$APP</string>
	<key>EnvironmentVariables</key>
	<dict>
		<key>NODE_ENV</key>
		<string>$MODE</string>
		<key>SHELL</key>
		<string>$LOGIN_SHELL</string>
		<key>PATH</key>
		<string>$SERVICE_PATH</string>
	</dict>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>AbandonProcessGroup</key>
	<true/>
	<key>StandardOutPath</key>
	<string>$DATA/server.log</string>
	<key>StandardErrorPath</key>
	<string>$DATA/server.log</string>
</dict>
</plist>
"
	domain="gui/$(id -u)"

	loaded=$(launchctl print "$domain/$LABEL" >/dev/null 2>&1 && echo yes || echo no)

	# A changed agent is unloaded and loaded again; bootout returns before the service is gone, so it's waited out
	if [ ! -f "$AGENT" ] || [ "$(cat "$AGENT")" != "$agent_text" ]; then
		printf '%s' "$agent_text" >"$AGENT"
		if [ "$loaded" = yes ]; then
			launchctl bootout "$domain/$LABEL" 2>/dev/null || true
			gone=0
			while launchctl print "$domain/$LABEL" >/dev/null 2>&1 && [ "$gone" -lt 20 ]; do
				gone=$((gone + 1))
				sleep 0.5
			done
		fi
		loaded=no
	fi

	if [ "$loaded" = no ]; then
		say "Starting paude"
		launchctl bootstrap "$domain" "$AGENT"
	elif [ "$changed" = yes ]; then
		restart_note
		launchctl kickstart -k "$domain/$LABEL"
	fi

	# The paude command, from this same checkout, so it updates with the server; a paude linked from elsewhere (a
	# checkout someone works on) is left alone
	if ! command -v paude >/dev/null 2>&1; then
		say "Linking the paude command"
		"$BUN" link >/dev/null
	fi
}

if [ "$PLATFORM" = macos ]; then install_launchd; else install_systemd; fi

mkdir -p "$DATA"
if [ "$DEV" = no ]; then git -C "$APP" rev-parse HEAD >"$STARTED"; fi

waited=0
until curl -sf "http://127.0.0.1:$PORT/api/auth" >/dev/null 2>&1; do
	waited=$((waited + 1))
	if [ "$waited" -gt 20 ]; then
		[ "$PLATFORM" = macos ] && die "paude didn't answer on port $PORT; see: tail -n 20 $DATA/server.log"
		die "paude didn't answer on port $PORT; see: journalctl --user -u paude -n 20"
	fi
	sleep 1
done

if [ "$DEV" = yes ]; then
	say "paude is running on 127.0.0.1:$PORT from $APP; it restarts itself as you save, and sessions carry on"
else
	say "paude is running on 127.0.0.1:$PORT"
fi

curl -sf "http://127.0.0.1:$PORT/api/auth" | grep -q '"passwordSet":true' ||
	say "No password yet; only this machine can log in until you run: cd $APP && bun run set-password"
