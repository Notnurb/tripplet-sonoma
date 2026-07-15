#!/bin/bash
# Interactive TUI for adjusting the loudding / quietding volumes.
# Run directly in a real terminal: bash .claude/hooks/ding-volume-tui.sh

set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" >/dev/null 2>&1 && pwd)"
CONFIG_FILE="$SCRIPT_DIR/../ding-config"

LOUD_VOLUME="2"
QUIET_VOLUME="0.15"
[ -f "$CONFIG_FILE" ] && source "$CONFIG_FILE" 2>/dev/null

save() {
  cat > "$CONFIG_FILE" <<EOF
LOUD_VOLUME=$LOUD_VOLUME
QUIET_VOLUME=$QUIET_VOLUME
EOF
}

clamp() {
  # clamp $1 into [0, 2]
  awk -v v="$1" 'BEGIN {
    if (v < 0) v = 0;
    if (v > 2) v = 2;
    printf "%.2f", v;
  }'
}

preview() {
  local sound="$1" vol="$2"
  if command -v afplay >/dev/null 2>&1; then
    afplay -v "$vol" "$sound" >/dev/null 2>&1
  elif command -v osascript >/dev/null 2>&1; then
    osascript -e 'beep' >/dev/null 2>&1
  else
    printf '\a'
  fi
}

bar() {
  # render a simple 0..2 volume bar
  local vol="$1" filled empty i
  filled=$(awk -v v="$vol" 'BEGIN { n = int((v/2)*20 + 0.5); print n }')
  empty=$((20 - filled))
  local out=""
  for ((i = 0; i < filled; i++)); do out="${out}#"; done
  for ((i = 0; i < empty; i++)); do out="${out}-"; done
  echo "$out"
}

adjust() {
  local label="$1" sound="$2" varname="$3"
  local vol="${!varname}"

  while true; do
    clear
    echo "=== Ding Volume — $label ==="
    echo
    printf "Volume: %-5s [%s] (range 0.00 - 2.00)\n" "$vol" "$(bar "$vol")"
    echo
    echo "  +      raise 0.1"
    echo "  -      lower 0.1"
    echo "  <num>  set exact value (e.g. 0.5)"
    echo "  p      preview at current volume"
    echo "  s      save and return to menu"
    echo "  q      discard changes and return to menu"
    echo
    read -r -p "> " input

    case "$input" in
      +) vol="$(clamp "$(awk -v v="$vol" 'BEGIN{print v+0.1}')")" ;;
      -) vol="$(clamp "$(awk -v v="$vol" 'BEGIN{print v-0.1}')")" ;;
      p|P) preview "$sound" "$vol" ;;
      s|S)
        printf -v "$varname" '%s' "$vol"
        save
        echo "Saved."
        sleep 0.6
        return
        ;;
      q|Q) return ;;
      *)
        if [[ "$input" =~ ^[0-9]*\.?[0-9]+$ ]]; then
          vol="$(clamp "$input")"
        else
          echo "Unrecognized input."
          sleep 0.6
        fi
        ;;
    esac
  done
}

while true; do
  clear
  echo "=== Ding Volume Control ==="
  echo
  echo "  1) Loud ding volume   (currently $LOUD_VOLUME)"
  echo "  2) Quiet ding volume  (currently $QUIET_VOLUME)"
  echo "  q) Quit"
  echo
  read -r -p "> " choice

  case "$choice" in
    1) adjust "Loud Ding" "/System/Library/Sounds/Glass.aiff" LOUD_VOLUME ;;
    2) adjust "Quiet Ding" "/System/Library/Sounds/Tink.aiff" QUIET_VOLUME ;;
    q|Q) clear; echo "Done. loud=$LOUD_VOLUME quiet=$QUIET_VOLUME"; exit 0 ;;
    *) ;;
  esac
done
