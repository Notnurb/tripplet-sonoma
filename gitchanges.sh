#!/usr/bin/env bash
# gitchanges.sh — terminal UI for browsing git changes in the current repo.
set -uo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo .)" || exit 1

if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  echo "Not inside a git repository." >&2
  exit 1
fi

# ---- palette ----------------------------------------------------------
RED=$'\033[38;5;203m'
GREEN=$'\033[38;5;114m'
YELLOW=$'\033[38;5;221m'
CYAN=$'\033[38;5;80m'
BLUE=$'\033[38;5;111m'
MAGENTA=$'\033[38;5;176m'
GRAY=$'\033[38;5;244m'
DGRAY=$'\033[38;5;238m'
DIM=$'\033[2m'
BOLD=$'\033[1m'
ITAL=$'\033[3m'
RESET=$'\033[0m'

term_width() { tput cols 2>/dev/null || echo 80; }

hline() {
  local w char="${1:-─}"
  w=$(term_width)
  printf "%s" "$DGRAY"
  printf "%${w}s" "" | tr ' ' "$char"
  printf "%s\n" "$RESET"
}

center_pad() {
  # center_pad "plain_text" total_width -> left/right pad counts for plain_text (no ANSI codes)
  local text="$1" width="$2" tlen lpad rpad
  tlen=${#text}
  if (( tlen >= width )); then printf "0 0"; return; fi
  lpad=$(( (width - tlen) / 2 ))
  rpad=$(( width - tlen - lpad ))
  printf "%d %d" "$lpad" "$rpad"
}

header() {
  # header "plain title" "plain subtitle"
  local title="$1" sub="$2"
  local w; w=$(term_width)
  local inner=$((w - 2))
  local lp rp
  printf "%s╭%s╮%s\n" "$DGRAY" "$(printf '%*s' "$inner" '' | tr ' ' '─')" "$RESET"
  read -r lp rp <<< "$(center_pad "$title" "$inner")"
  printf "%s│%*s%s%s%s%*s│%s\n" "$DGRAY" "$lp" "" "$CYAN$BOLD" "$title" "$RESET" "$rp" "" "$DGRAY$RESET"
  if [[ -n "$sub" ]]; then
    read -r lp rp <<< "$(center_pad "$sub" "$inner")"
    printf "%s│%*s%s%s%s%*s│%s\n" "$DGRAY" "$lp" "" "$DIM" "$sub" "$RESET" "$rp" "" "$DGRAY$RESET"
  fi
  printf "%s╰%s╯%s\n" "$DGRAY" "$(printf '%*s' "$inner" '' | tr ' ' '─')" "$RESET"
}

pause() {
  printf "\n  ${DIM}↵  Press Enter to continue...${RESET}"
  read -r _
}

pager() {
  if command -v less >/dev/null 2>&1; then
    less -R -F -X
  else
    cat
  fi
}

status_meta() {
  # $1 = two-char porcelain code -> "color|label"
  local code="$1"
  case "$code" in
    "M "|" M"|"MM") printf "%s|modified" "$YELLOW" ;;
    "A "|" A") printf "%s|added" "$GREEN" ;;
    "D "|" D") printf "%s|deleted" "$RED" ;;
    R*)        printf "%s|renamed" "$BLUE" ;;
    "??")      printf "%s|untracked" "$MAGENTA" ;;
    "!!")      printf "%s|ignored" "$GRAY" ;;
    *)         printf "%s|%s" "$GRAY" "$code" ;;
  esac
}

get_entry() {
  git -c color.status=false status --porcelain=v1 | sed -n "${1}p"
}

diffstat_for() {
  local path="$1" stat
  stat=$(git diff --numstat -- "$path" 2>/dev/null | awk '{a=$1;d=$2} END{if(a!="") printf "%s %s", a, d}')
  if [[ -z "$stat" ]]; then
    stat=$(git diff --cached --numstat -- "$path" 2>/dev/null | awk '{a=$1;d=$2} END{if(a!="") printf "%s %s", a, d}')
  fi
  printf "%s" "$stat"
}

diff_bar() {
  # renders a small +/- proportion bar, e.g. ++++---- given add/del counts
  local add="$1" del="$2" width=10
  if [[ -z "$add" || "$add" == "-" ]]; then printf ""; return; fi
  local total=$((add + del))
  if (( total == 0 )); then printf ""; return; fi
  local abar=$(( add * width / total ))
  local dbar=$(( width - abar ))
  (( abar == 0 && add > 0 )) && abar=1 && dbar=$((width-1))
  (( dbar == 0 && del > 0 )) && dbar=1 && abar=$((width-1))
  printf "%s" "$GREEN"; printf '%*s' "$abar" '' | tr ' ' '+'
  printf "%s" "$RED"; printf '%*s' "$dbar" '' | tr ' ' '-'
  printf "%s" "$RESET"
}

truncate_path() {
  local path="$1" max="$2" len=${#1}
  if (( len <= max )); then printf "%s" "$path"; return; fi
  local keep=$(( max - 1 ))
  printf "…%s" "${path: -$keep}"
}

show_diff_for_entry() {
  local line="$1"
  local xy="${line:0:2}"
  local path="${line:3}"
  if [[ "$path" == *" -> "* ]]; then
    path="${path##* -> }"
  fi

  {
    if [[ "$xy" == "??" ]]; then
      printf "%s%s ● Untracked file%s  %s%s%s\n" "$MAGENTA" "$BOLD" "$RESET" "$DIM" "$path" "$RESET"
      hline
      cat -- "$path" 2>/dev/null
    else
      printf "%s%s ● Diff%s  %s%s%s\n" "$CYAN" "$BOLD" "$RESET" "$DIM" "$path" "$RESET"
      hline
      git diff --color=always -- "$path"
      local staged
      staged=$(git diff --cached --color=always -- "$path")
      if [[ -n "$staged" ]]; then
        echo
        printf "%s%s ● Staged diff%s  %s%s%s\n" "$GREEN" "$BOLD" "$RESET" "$DIM" "$path" "$RESET"
        hline
        echo "$staged"
      fi
    fi
  } | pager
}

view_full_diff() { { printf "%s%s ● Full unstaged diff%s\n" "$CYAN" "$BOLD" "$RESET"; hline; git diff --color=always -- .; } | pager; }
view_staged_diff() { { printf "%s%s ● Full staged diff%s\n" "$GREEN" "$BOLD" "$RESET"; hline; git diff --cached --color=always -- .; } | pager; }
view_log() { { printf "%s%s ● Recent history%s\n" "$BLUE" "$BOLD" "$RESET"; hline; git log --color=always --oneline --graph --decorate -n 40; } | pager; }

print_summary_counts() {
  local rows m=0 a=0 d=0 r=0 u=0
  rows="$(git -c color.status=false status --porcelain=v1)"
  while IFS= read -r row; do
    [[ -z "$row" ]] && continue
    case "${row:0:2}" in
      "M "|" M"|"MM") m=$((m+1)) ;;
      "A "|" A") a=$((a+1)) ;;
      "D "|" D") d=$((d+1)) ;;
      R*) r=$((r+1)) ;;
      "??") u=$((u+1)) ;;
    esac
  done <<< "$rows"
  printf "  "
  (( m > 0 )) && printf "%s● %d modified  %s" "$YELLOW" "$m" "$RESET"
  (( a > 0 )) && printf "%s● %d added  %s" "$GREEN" "$a" "$RESET"
  (( d > 0 )) && printf "%s● %d deleted  %s" "$RED" "$d" "$RESET"
  (( r > 0 )) && printf "%s● %d renamed  %s" "$BLUE" "$r" "$RESET"
  (( u > 0 )) && printf "%s● %d untracked  %s" "$MAGENTA" "$u" "$RESET"
  printf "\n"
}

print_file_list() {
  local rows count idx code path label color meta w path_w
  rows="$(git -c color.status=false status --porcelain=v1)"
  count=$(printf "%s\n" "$rows" | sed '/^$/d' | wc -l | tr -d ' ')
  w=$(term_width)

  if [[ "$count" == "0" ]]; then
    printf "\n  %s✓ Working tree clean.%s\n\n" "$GREEN" "$RESET"
    return
  fi

  echo
  print_summary_counts
  echo
  path_w=$(( w - 38 ))
  (( path_w < 20 )) && path_w=20

  idx=0
  while IFS= read -r row; do
    [[ -z "$row" ]] && continue
    idx=$((idx+1))
    code="${row:0:2}"
    path="${row:3}"
    meta="$(status_meta "$code")"
    color="${meta%%|*}"
    label="${meta#*|}"; label="${label%%|*}"
    stat=""
    bar=""
    if [[ "$code" != "??" && "$code" != "!!" ]]; then
      stat="$(diffstat_for "${path%% -> *}")"
      [[ -z "$stat" ]] && stat="$(diffstat_for "${path##* -> }")"
      if [[ -n "$stat" ]]; then
        read -r sa sd <<< "$stat"
        bar="$(diff_bar "$sa" "$sd")"
      fi
    fi
    printf "  %s%2d%s  %s● %-9s%s  %-*s  %s\n" \
      "$DGRAY" "$idx" "$RESET" \
      "$color" "$label" "$RESET" \
      "$path_w" "$(truncate_path "$path" "$path_w")" \
      "$bar"
  done <<< "$rows"
  echo
}

main_menu() {
  while true; do
    clear
    header "GIT CHANGES · $(basename "$(pwd)")" "branch $(git branch --show-current 2>/dev/null || echo 'detached') · $(date '+%H:%M:%S')"
    print_file_list
    hline
    printf "  %s%s#%s%s view diff   %s%sa%s%s all unstaged   %s%ss%s%s staged   %s%sl%s%s log   %s%sr%s%s refresh   %s%sq%s%s quit\n" \
      "$CYAN" "$BOLD" "$RESET" "$DIM" \
      "$CYAN" "$BOLD" "$RESET" "$DIM" \
      "$CYAN" "$BOLD" "$RESET" "$DIM" \
      "$CYAN" "$BOLD" "$RESET" "$DIM" \
      "$CYAN" "$BOLD" "$RESET" "$DIM" \
      "$CYAN" "$BOLD" "$RESET" "$RESET"
    hline
    printf "  %s❯%s " "$MAGENTA$BOLD" "$RESET"
    read -r choice

    case "$choice" in
      q|Q) clear; exit 0 ;;
      r|R) continue ;;
      a|A) view_full_diff ;;
      s|S) view_staged_diff ;;
      l|L) view_log ;;
      ''|*[!0-9]*)
        printf "\n  %s✗ Invalid choice.%s" "$RED" "$RESET"
        pause
        ;;
      *)
        entry="$(get_entry "$choice")"
        if [[ -z "$entry" ]]; then
          printf "\n  %s✗ No such entry.%s" "$RED" "$RESET"
          pause
        else
          show_diff_for_entry "$entry"
        fi
        ;;
    esac
  done
}

main_menu
