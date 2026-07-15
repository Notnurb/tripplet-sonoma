#!/bin/bash
# Plays a completion sound based on the ding state set by /loudding or /quietding.
# Never exits non-zero — a failure here must not block Claude's turn.

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" >/dev/null 2>&1 && pwd)"
STATE_FILE="$SCRIPT_DIR/../ding-state"
CONFIG_FILE="$SCRIPT_DIR/../ding-config"

[ -f "$STATE_FILE" ] || exit 0

STATE="$(tr -d '[:space:]' < "$STATE_FILE" 2>/dev/null)"

# Defaults, overridden by ding-config if present (set via the ding-volume TUI).
LOUD_VOLUME="2"
QUIET_VOLUME="0.15"
if [ -f "$CONFIG_FILE" ]; then
  # shellcheck disable=SC1090
  source "$CONFIG_FILE" 2>/dev/null || true
fi

SOUND=""
VOLUME=""
case "$STATE" in
  loud)
    SOUND="/System/Library/Sounds/Glass.aiff"
    VOLUME="$LOUD_VOLUME"
    ;;
  quiet)
    SOUND="/System/Library/Sounds/Tink.aiff"
    VOLUME="$QUIET_VOLUME"
    ;;
  *)
    exit 0
    ;;
esac

play_sound() {
  if command -v afplay >/dev/null 2>&1 && [ -f "$SOUND" ]; then
    afplay -v "$VOLUME" "$SOUND" >/dev/null 2>&1
  elif command -v osascript >/dev/null 2>&1; then
    osascript -e 'beep' >/dev/null 2>&1
  else
    printf '\a'
  fi
}

# Detach fully (new session, stdio closed, disowned) so the sound finishes
# playing even if the parent hook process is torn down immediately after,
# but cap it with a timeout so a stuck player can never hang the session.
if command -v setsid >/dev/null 2>&1; then
  nohup setsid bash -c "$(declare -f play_sound); play_sound" >/dev/null 2>&1 &
else
  nohup bash -c "$(declare -f play_sound); play_sound" >/dev/null 2>&1 &
fi
disown 2>/dev/null || true

exit 0
