#!/usr/bin/env bash
#
# check-updates.sh — watch docs/dev/communication.md for updates between Agent 1 & Agent 2.
#
# Polls the comms file on an interval and prints a notice whenever it changes,
# showing the newly appended lines. Ctrl-C to stop.
#
# Usage:
#   ./check-updates.sh                 # watch ./docs/dev/communication.md every 5s
#   ./check-updates.sh -f FILE         # watch a different file
#   ./check-updates.sh -i 10           # poll every 10 seconds
#   ./check-updates.sh -i 10 -f x.md   # combine

set -euo pipefail

FILE="docs/dev/communication.md"
INTERVAL=5

while getopts "f:i:h" opt; do
  case "$opt" in
    f) FILE="$OPTARG" ;;
    i) INTERVAL="$OPTARG" ;;
    h)
      grep '^#' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *) echo "Invalid option. Use -h for help." >&2; exit 1 ;;
  esac
done

# Resolve to an absolute path so the watcher is unaffected by cwd changes.
DIR="$(cd "$(dirname "$FILE")" && pwd)"
FILE="$DIR/$(basename "$FILE")"

if [[ ! -f "$FILE" ]]; then
  echo "Error: file not found: $FILE" >&2
  exit 1
fi

# Cross-platform mtime + line count helpers (macOS/BSD stat vs GNU stat).
get_mtime() {
  stat -f %m "$FILE" 2>/dev/null || stat -c %Y "$FILE"
}
line_count() { wc -l < "$FILE" | tr -d ' '; }

ts() { date '+%Y-%m-%d %H:%M:%S'; }

echo "[$(ts)] Watching $FILE (every ${INTERVAL}s). Ctrl-C to stop."
echo "[$(ts)] Current size: $(line_count) lines."

last_mtime="$(get_mtime)"
last_lines="$(line_count)"

while true; do
  sleep "$INTERVAL"
  cur_mtime="$(get_mtime)"

  if [[ "$cur_mtime" != "$last_mtime" ]]; then
    cur_lines="$(line_count)"
    echo ""
    echo "==================================================================="
    echo "[$(ts)] 🔔 UPDATE DETECTED in $(basename "$FILE")"

    if (( cur_lines > last_lines )); then
      added=$(( cur_lines - last_lines ))
      echo "[$(ts)] +${added} new line(s):"
      tail -n "$added" "$FILE" | sed 's/^/    | /'
    else
      echo "[$(ts)] File changed (edited in place, no net new lines)."
    fi
    echo "==================================================================="

    last_mtime="$cur_mtime"
    last_lines="$cur_lines"
  fi
done
