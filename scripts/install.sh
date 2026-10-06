#!/usr/bin/env sh
# paude installer and updater (the same command does both):
#   curl -fsSL https://raw.githubusercontent.com/fatlard1993/paude/main/scripts/install.sh | sh
#
# Linux with a systemd user session. Installs to ~/.paude-server, runs as a user service on 127.0.0.1:8044, and
# serves sessions in the subfolders of ~/Projects. Put HTTPS in front (see the README) before exposing it.

set -e

REPO="https://github.com/fatlard1993/paude"
APP="${PAUDE_APP:-$HOME/.paude-server}"
PROJECTS="${PAUDE_PROJECTS:-$HOME/Projects}"
PORT="${PAUDE_PORT:-8044}"
UNIT="$HOME/.config/systemd/user/paude.service"

say() { printf '> %s\n' "$*"; }
die() {
	printf 'x %s\n' "$*" >&2
	exit 1
}

if ! command -v systemctl >/dev/null 2>&1 || ! systemctl --user status >/dev/null 2>&1; then
	die "paude needs a systemd user session (Linux)."
fi
command -v git >/dev/null 2>&1 || die "git is required: sudo apt install git"

for candidate in "$HOME/.bun/bin/bun" "$HOME/.local/bin/bun" /usr/local/bin/bun; do
	if [ -x "$candidate" ] && ! command -v bun >/dev/null 2>&1; then PATH="$(dirname "$candidate"):$PATH"; fi
done

if ! command -v bun >/dev/null 2>&1; then
	say "Installing Bun"
	curl -fsSL https://bun.sh/install | bash
	PATH="$HOME/.bun/bin:$PATH"
fi

BUN="$(command -v bun)"
# Claude's Bash tool loads the shell named here; systemd's own SHELL can predate a chsh, leaving sessions in bash
# without the login shell's PATH and tools
LOGIN_SHELL="$(getent passwd "$(id -un)" | cut -d: -f7)"

if ! command -v claude >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/claude" ]; then
	say "Claude Code isn't installed for this user; sessions need it: curl -fsSL https://claude.ai/install.sh | bash"
fi

if [ -d "$APP/.git" ]; then
	before="$(git -C "$APP" rev-parse HEAD)"
	say "Updating $APP"
	git -C "$APP" pull --ff-only --quiet
	changed=$([ "$before" != "$(git -C "$APP" rev-parse HEAD)" ] && echo yes || echo no)
else
	say "Cloning into $APP"
	git clone --quiet --depth=1 "$REPO" "$APP"
	changed=yes
fi

cd "$APP"
say "Installing dependencies and building"
# Without scripts: the prepare script would build (again) and point git hooks at a checkout nobody commits from
"$BUN" install --frozen-lockfile --ignore-scripts >/dev/null
NODE_ENV=production "$BUN" run build >/dev/null

# The unit names absolute paths: systemd doesn't read the login shell's PATH, and sessions need claude on it
mkdir -p "$(dirname "$UNIT")"
unit_text="[Unit]
Description=paude: shared Claude Code sessions
After=network.target

[Service]
WorkingDirectory=$APP
ExecStart=$BUN server/index.js --projects $PROJECTS --host 127.0.0.1 --port $PORT
Environment=NODE_ENV=production
Environment=SHELL=$LOGIN_SHELL
Environment=PATH=$HOME/.local/bin:$(dirname "$BUN"):/usr/local/bin:/usr/bin:/bin
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
	say "Restarting paude (running sessions restart; they resume when reopened)"
	systemctl --user restart paude.service
fi

waited=0
until curl -sf "http://127.0.0.1:$PORT/api/auth" >/dev/null 2>&1; do
	waited=$((waited + 1))
	[ "$waited" -le 20 ] || die "paude didn't answer on port $PORT; see: journalctl --user -u paude -n 20"
	sleep 1
done

say "paude is running on 127.0.0.1:$PORT"

curl -sf "http://127.0.0.1:$PORT/api/auth" | grep -q '"passwordSet":true' ||
	say "No password yet; nobody can log in until you run: cd $APP && bun run set-password"
