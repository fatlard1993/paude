#!/bin/sh
# Run every minute by the service manager beside paude (scripts/install.sh sets it up). A paude that's running but
# hasn't answered for two checks in a row is hung, not restarting: what it was doing is kept in $DATA/hangs, then the
# service is restarted. Sessions held by dtach carry on through it. A paude that isn't running is left alone: a crash
# is the service manager's to restart, and a stop (paude stop) was meant.
#   watchdog.sh <port> <data dir>
PORT=${1:-8044}
DATA=${2:-$HOME/.paude}
STRIKE="$DATA/watchdog-strike"
LABEL=com.github.fatlard1993.paude

if curl -sf -m 10 -o /dev/null "http://127.0.0.1:$PORT/api/auth"; then
	rm -f "$STRIKE"
	exit 0
fi

if [ "$(uname)" = Darwin ]; then
	pid=$(launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | awk '/^\tpid = /{print $3}')
else
	pid=$(systemctl --user show paude.service -p MainPID --value 2>/dev/null)
	[ "$pid" = 0 ] && pid=
fi

if [ -z "$pid" ]; then
	rm -f "$STRIKE"
	exit 0
fi

# A first miss may be a restart under way; the strike names the pid, so a new server starts with a clean slate
if [ "$(cat "$STRIKE" 2>/dev/null)" != "$pid" ]; then
	echo "$pid" >"$STRIKE"
	exit 0
fi

mkdir -p "$DATA/hangs"
report="$DATA/hangs/$(date +%Y-%m-%dT%H-%M-%S).txt"
{
	echo "paude (pid $pid) stopped answering on port $PORT; restarted by the watchdog"
	ps -o pid,lstart,etime,rss,%cpu,command -p "$pid"
	echo
	echo "Transcripts written in the last 5 minutes:"
	find "${CLAUDE_CONFIG_DIR:-$HOME/.claude}/projects" -name '*.jsonl' -mmin -5 -exec ls -l {} + 2>/dev/null
	echo
	if [ "$(uname)" = Darwin ]; then
		echo "Last of the server log:"
		tail -n 40 "$DATA/server.log" 2>/dev/null
		echo
		sample "$pid" 3 2>/dev/null
	else
		echo "Last of the server log:"
		journalctl --user -u paude -n 40 --no-pager 2>/dev/null
		echo
		cat "/proc/$pid/status" 2>/dev/null
	fi
} >"$report" 2>&1

rm -f "$STRIKE"
if [ "$(uname)" = Darwin ]; then
	echo "$(date): hung; restarting (see $report)" >>"$DATA/server.log"
	launchctl kickstart -k "gui/$(id -u)/$LABEL"
else
	echo "paude hung; restarting (see $report)" | systemd-cat -t paude-watchdog -p warning 2>/dev/null
	systemctl --user restart paude.service
fi

# Kept to the last few
ls -1t "$DATA/hangs"/*.txt 2>/dev/null | tail -n +21 | while IFS= read -r old; do rm -f "$old"; done
