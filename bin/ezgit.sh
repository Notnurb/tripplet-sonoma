#!/usr/bin/env bash
# ezgit — one-command commit+push with auto-troubleshooting, scoped to this repo.
set -uo pipefail

# ---- colors (disabled if not a tty) ----
if [ -t 1 ]; then
  C_RESET='\033[0m'; C_BOLD='\033[1m'; C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_BLUE='\033[34m'
else
  C_RESET=''; C_BOLD=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_BLUE=''
fi
info()  { printf "${C_BLUE}ezgit:${C_RESET} %s\n" "$*"; }
ok()    { printf "${C_GREEN}ezgit:${C_RESET} %s\n" "$*"; }
warn()  { printf "${C_YELLOW}ezgit:${C_RESET} %s\n" "$*"; }
fail()  { printf "${C_RED}ezgit:${C_RESET} %s\n" "$*" >&2; }

DRY_RUN=0
ASSUME_YES=0
ARGS=()
for a in "$@"; do
  case "$a" in
    -n|--dry-run) DRY_RUN=1 ;;
    -y|--yes) ASSUME_YES=1 ;;
    -h|--help)
      cat <<'EOF'
ezgit — commit + push with auto-troubleshooting, scoped to this repo.

Usage:
  git ezgit ["commit message"] [flags]

Flags:
  -n, --dry-run   show what would happen, stage/commit/push nothing
  -y, --yes       skip the confirmation prompt before pushing
  -h, --help      show this help

With no message, ezgit generates one from the changed files.
EOF
      exit 0
      ;;
    *) ARGS+=("$a") ;;
  esac
done
msg="${ARGS[*]:-}"

REPO_ROOT="$(git rev-parse --show-toplevel 2>/dev/null)"
if [ -z "$REPO_ROOT" ]; then
  fail "not inside a git repository."
  exit 1
fi
cd "$REPO_ROOT"

# --- 0. Sanity: mid-rebase / mid-merge / detached HEAD ---
if [ -d .git/rebase-merge ] || [ -d .git/rebase-apply ]; then
  fail "a rebase is already in progress. Resolve it first:"
  fail "  git rebase --continue   (or --abort)"
  exit 1
fi
if [ -f .git/MERGE_HEAD ]; then
  fail "a merge is already in progress. Resolve it first:"
  fail "  git commit   (or git merge --abort)"
  exit 1
fi

branch="$(git rev-parse --abbrev-ref HEAD)"
if [ "$branch" = "HEAD" ]; then
  if ! git rev-parse HEAD >/dev/null 2>&1; then
    fail "no commits yet on this branch (unborn HEAD)."
    fail "  git commit --allow-empty -m init   or just re-run — ezgit will create the first commit"
    branch="$(git symbolic-ref --short HEAD 2>/dev/null || echo main)"
  else
    fail "you're in detached HEAD state — not on a branch."
    fail "  git checkout -b <new-branch>   to save this work"
    exit 1
  fi
fi

info "on branch '${C_BOLD}${branch}${C_RESET}' in $REPO_ROOT"

# --- 1. Detect + fix a stuck lock file ---
if [ -f .git/index.lock ]; then
  if pgrep -f "git" >/dev/null 2>&1 && lsof .git/index.lock >/dev/null 2>&1; then
    fail "another git process currently holds .git/index.lock — not removing it. Close that process first."
    exit 1
  fi
  warn "found stale .git/index.lock — removing it."
  rm -f .git/index.lock
fi

# --- 2. Nothing to do at all? ---
if git diff --quiet && git diff --cached --quiet && [ -z "$(git ls-files --others --exclude-standard)" ]; then
  # still may have unpushed commits, fall through to push step
  info "working tree clean, nothing new to stage."
else
  info "changes:"
  git status --short | sed 's/^/  /'
fi

# --- 3. Pre-flight: obvious secret / huge file guard before staging ---
# NUL-delimited so filenames with spaces (common in this repo, e.g. "Code Background.mp4") parse correctly.
CHANGED_FILES=()
skip_next=0
while IFS= read -r -d '' entry; do
  if [ "$skip_next" -eq 1 ]; then
    skip_next=0
    continue
  fi
  xy="${entry:0:2}"
  path="${entry:3}"
  CHANGED_FILES+=("$path")
  # rename/copy records are followed by a second NUL-terminated field (the old path) with no arrow
  case "$xy" in
    R*|C*) skip_next=1 ;;
  esac
done < <(git status --porcelain=v1 -z 2>/dev/null)

BIG_FILES=()
for f in "${CHANGED_FILES[@]:-}"; do
  [ -n "$f" ] && [ -f "$f" ] || continue
  size=$(stat -f%z "$f" 2>/dev/null || stat -c%s "$f" 2>/dev/null || echo 0)
  [ "$size" -gt 52428800 ] && BIG_FILES+=("$f ($((size/1024/1024))MB)")
done
if [ "${#BIG_FILES[@]:-0}" -gt 0 ]; then
  warn "these files are >50MB and will likely be rejected by the remote:"
  printf '  %s\n' "${BIG_FILES[@]}"
  warn "consider git-lfs or removing them before continuing."
fi

SECRET_NAME_HITS=()
for f in "${CHANGED_FILES[@]:-}"; do
  [ -n "$f" ] || continue
  if echo "$f" | grep -qiE '\.env($|\.)|credentials|\.pem$|\.key$'; then
    SECRET_NAME_HITS+=("$f")
  fi
done
if [ "${#SECRET_NAME_HITS[@]:-0}" -gt 0 ]; then
  warn "these staged/changed files look like they might contain secrets (by name):"
  printf '  %s\n' "${SECRET_NAME_HITS[@]}"
  warn "double-check contents before pushing."
fi

# Content-based scan of actual diff for common credential patterns
SECRET_PATTERN='(AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{35}|sk-[A-Za-z0-9]{20,}|xox[baprs]-[0-9A-Za-z-]{10,}|-----BEGIN[ A-Z]*PRIVATE KEY-----|(password|secret|api[_-]?key|token)\s*[:=]\s*["'\''][^"'\'']{8,}["'\''])'
CONTENT_HITS="$(git diff --cached -U0 2>/dev/null | grep -iEo "^\+.*${SECRET_PATTERN}" | head -5 || true)"
if [ -z "$CONTENT_HITS" ]; then
  CONTENT_HITS="$(git diff -U0 2>/dev/null | grep -iEo "^\+.*${SECRET_PATTERN}" | head -5 || true)"
fi
if [ -n "$CONTENT_HITS" ]; then
  fail "possible secret found in changed lines — refusing to auto-continue:"
  echo "$CONTENT_HITS" | sed 's/^/  /' >&2
  fail "remove it, or re-run with -y to push anyway if this is a false positive."
  if [ "$ASSUME_YES" -ne 1 ]; then
    exit 1
  fi
fi

if [ "$DRY_RUN" -eq 1 ]; then
  info "dry-run: stopping before stage/commit/push."
  exit 0
fi

# --- 3b. Guard against committing unresolved conflict markers ---
CONFLICT_HITS=""
if [ "${#CHANGED_FILES[@]:-0}" -gt 0 ]; then
  CONFLICT_HITS="$(git diff -U0 -- "${CHANGED_FILES[@]}" 2>/dev/null | grep -E '^\+(<{7}|={7}|>{7})( |$)' | head -5 || true)"
fi
if [ -n "$CONFLICT_HITS" ]; then
  fail "unresolved merge conflict markers found in changed files — refusing to commit:"
  echo "$CONFLICT_HITS" | sed 's/^/  /' >&2
  exit 1
fi

# --- 4. Stage everything ---
git add -A

if git diff --cached --quiet; then
  info "nothing staged to commit — will still try to push any existing unpushed commits."
else
  if [ -z "$msg" ]; then
    stat_summary="$(git diff --cached --stat | tail -1 | sed 's/^ *//')"
    files_changed="$(git diff --cached --name-only | wc -l | tr -d ' ')"
    if [ "$files_changed" -eq 1 ]; then
      msg="Update $(git diff --cached --name-only)"
    else
      msg="Update ${files_changed} files ($(date '+%Y-%m-%d %H:%M'))"
    fi
  fi
  commit_out="$(git commit -m "$msg" 2>&1)"
  commit_rc=$?
  if [ "$commit_rc" -ne 0 ]; then
    echo "$commit_out" | sed 's/^/  /' >&2
    if echo "$commit_out" | grep -qiE "please tell me who you are|author identity unknown"; then
      fail "git doesn't know who you are. Set your identity first:"
      fail "  git config user.name \"Your Name\""
      fail "  git config user.email \"you@example.com\""
    else
      fail "commit failed (likely a pre-commit hook). Aborting push."
    fi
    exit 1
  fi
  ok "committed: $msg"
fi

# --- 4b. Make sure 'origin' remote is actually configured ---
if ! git remote get-url origin >/dev/null 2>&1; then
  fail "no 'origin' remote configured for this repo."
  fail "  git remote add origin <url>"
  exit 1
fi

# --- 5. Make sure upstream exists ---
if ! git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  info "no upstream set for '$branch' — will push with -u to origin."
  UPSTREAM_FLAGS=(-u origin "$branch")
else
  UPSTREAM_FLAGS=()
fi

push_out=""
attempt_push() {
  if [ "${#UPSTREAM_FLAGS[@]}" -gt 0 ]; then
    push_out="$(git push "${UPSTREAM_FLAGS[@]}" 2>&1)"
  else
    push_out="$(git push 2>&1)"
  fi
  push_rc=$?
  return "$push_rc"
}

# --- Preview unpushed commits + confirm ---
if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  UNPUSHED="$(git log '@{u}..HEAD' --oneline 2>/dev/null || true)"
  if [ -n "$UNPUSHED" ]; then
    info "commits to push:"
    echo "$UNPUSHED" | sed 's/^/  /'
  fi
fi

if [ "$ASSUME_YES" -ne 1 ]; then
  printf "${C_YELLOW}ezgit:${C_RESET} push to origin/%s? [Y/n] " "$branch"
  read -r reply </dev/tty || reply="y"
  case "$reply" in
    n|N|no|No) info "push cancelled."; exit 0 ;;
  esac
fi

info "pushing..."
if attempt_push; then
  ok "push succeeded."
  exit 0
fi

warn "push failed, attempting auto-troubleshooting..."

# --- Case: remote has diverged (need pull/rebase) ---
if echo "$push_out" | grep -qiE "fetch first|non-fast-forward|rejected|diverged"; then
  info "remote has new commits — pulling with rebase (autostash enabled)..."
  if git pull --rebase --autostash origin "$branch"; then
    ok "rebase succeeded, retrying push..."
    if attempt_push; then
      ok "push succeeded after rebase."
      exit 0
    fi
  else
    fail "rebase hit conflicts. Resolve them manually:"
    fail "  1. Fix conflicted files"
    fail "  2. git add <files>"
    fail "  3. git rebase --continue"
    fail "  4. re-run: git ezgit"
    exit 1
  fi
fi

# --- Case: no upstream branch on remote yet ---
if echo "$push_out" | grep -qiE "no upstream branch"; then
  info "retrying with explicit upstream set..."
  if git push -u origin "$branch"; then
    ok "push succeeded."
    exit 0
  fi
fi

# --- Case: remote path/URL is wrong or repo doesn't exist ---
if echo "$push_out" | grep -qiE "does not appear to be a git repository"; then
  fail "remote 'origin' doesn't look like a valid git repository. Check the URL:"
  fail "  git remote -v"
  fail "  git remote set-url origin <correct-url>"
  exit 1
fi

# --- Case: SSH auth issue ---
if echo "$push_out" | grep -qiE "permission denied|publickey|could not read from remote"; then
  fail "SSH auth to the remote looks broken. Try:"
  fail "  ssh -T git@gitlab.com"
  fail "to confirm your key is registered."
  exit 1
fi

# --- Case: large file / size rejected ---
if echo "$push_out" | grep -qiE "exceeds|too large|pack exceeds"; then
  fail "push rejected for large file size. Find the culprit with:"
  fail "  git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | sort -k3 -n -r | head"
  exit 1
fi

# --- Case: remote unreachable / network ---
if echo "$push_out" | grep -qiE "could not resolve host|network is unreachable|timed out|connection refused"; then
  fail "can't reach the remote — check your network connection."
  exit 1
fi

# --- Case: repo/branch protected ---
if echo "$push_out" | grep -qiE "protected branch|denied"; then
  fail "'$branch' looks like a protected branch on the remote. Push to a feature branch and open a merge request instead:"
  fail "  git checkout -b ${branch}-fix"
  fail "  git ezgit"
  exit 1
fi

fail "could not auto-resolve. Raw git output:"
echo "$push_out" | sed 's/^/  /' >&2
exit 1
