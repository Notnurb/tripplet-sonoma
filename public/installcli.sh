#!/usr/bin/env bash
#
# Astrocode — one-command network installer.
#
#   curl -fsSL https://getsonoma.lol/installcli | bash
#
# Downloads Astrocode's CLI source and installs it via its own installer
# (which writes small `astrocode`/`astro` launcher shims onto your PATH — no
# root, no node_modules, nothing to compile). Works on macOS, Linux, and
# Windows (via Git Bash or WSL). Safe to re-run — it upgrades in place.
#
# After it finishes, open a new terminal and run:  astrocode
#
# Overridable via env:
#   ASTROCODE_BUNDLE_URL   tarball of the source tree (has package.json)
#   ASTROCODE_INSTALL_DIR  where the source is unpacked (default ~/.astrocode/cli)
#   NODE                   path to a specific node binary

# Re-exec under bash if started by a POSIX sh (we use bash features).
if [ -z "${BASH_VERSION:-}" ]; then
    exec bash "$0" "$@"
fi

set -euo pipefail

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
APP_NAME="Astrocode"
BUNDLE_URL="${ASTROCODE_BUNDLE_URL:-https://getsonoma.lol/astrocode.tar.gz}"
HOME_DIR="${HOME:-$USERPROFILE}"
INSTALL_DIR="${ASTROCODE_INSTALL_DIR:-${HOME_DIR}/.astrocode/cli}"

# ---------------------------------------------------------------------------
# Output helpers
# ---------------------------------------------------------------------------
if [ -t 1 ]; then
    C_BOLD="$(printf '\033[1m')"; C_DIM="$(printf '\033[2m')"
    C_GREEN="$(printf '\033[32m')"; C_RED="$(printf '\033[31m')"
    C_YELLOW="$(printf '\033[33m')"; C_RESET="$(printf '\033[0m')"
else
    C_BOLD=""; C_DIM=""; C_GREEN=""; C_RED=""; C_YELLOW=""; C_RESET=""
fi

say()  { printf '%s\n' "$*"; }
step() { printf '%s==>%s %s\n' "${C_BOLD}${C_GREEN}" "${C_RESET}" "$*"; }
info() { printf '    %s\n' "$*"; }
warn() { printf '%s!  %s%s\n' "${C_YELLOW}" "$*" "${C_RESET}" >&2; }
die()  { printf '%sError:%s %s\n' "${C_RED}${C_BOLD}" "${C_RESET}" "$*" >&2; exit 1; }

need_cmd() { command -v "$1" >/dev/null 2>&1; }

# ---------------------------------------------------------------------------
# Platform detection
# ---------------------------------------------------------------------------
UNAME="$(uname -s 2>/dev/null || echo unknown)"

say ""
say "${C_BOLD}Installing ${APP_NAME}${C_RESET}"
say "${C_DIM}platform: ${UNAME}${C_RESET}"
say ""

# ---------------------------------------------------------------------------
# Find Node 18.17+
# ---------------------------------------------------------------------------
version_ge() { # $1 >= $2 ? both "major.minor.patch"
    [ "$(printf '%s\n%s\n' "$1" "$2" | sort -V | head -n1)" = "$2" ]
}

find_node() {
    if [ -n "${NODE:-}" ] && [ -x "${NODE}" ]; then
        printf '%s' "${NODE}"
        return 0
    fi
    local cand
    for cand in \
        node \
        /usr/local/bin/node \
        /opt/homebrew/bin/node \
        /usr/bin/node \
        "${HOME_DIR}/.nvm/versions/node"/*/bin/node \
        "${HOME_DIR}/.volta/bin/node" \
        "${HOME_DIR}/.local/share/fnm/node-versions"/*/installation/bin/node
    do
        if need_cmd "${cand}" 2>/dev/null || [ -x "${cand}" ]; then
            local path_bin
            path_bin="$(command -v "${cand}" 2>/dev/null || echo "${cand}")"
            [ -x "${path_bin}" ] || continue
            local ver
            ver="$("${path_bin}" -p 'process.versions.node' 2>/dev/null)" || continue
            version_ge "${ver}" "18.17.0" && { printf '%s' "${path_bin}"; return 0; }
        fi
    done
    return 1
}

step "Checking for Node 18.17+"
NODE_BIN="$(find_node || true)"
if [ -z "${NODE_BIN}" ]; then
    warn "No Node 18.17+ interpreter was found on your PATH."
    info "Install it from https://nodejs.org, or with a version manager (nvm, volta, fnm)."
    die "Node 18.17+ is required."
fi
info "Using ${NODE_BIN} ($("${NODE_BIN}" -v))"

# ---------------------------------------------------------------------------
# Fetch the Astrocode CLI source
# ---------------------------------------------------------------------------
TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t astrocode)"
cleanup() { rm -rf "${TMP_DIR}" 2>/dev/null || true; }
trap cleanup EXIT

step "Downloading ${APP_NAME}"
if need_cmd curl; then
    DL='curl -fsSL'
elif need_cmd wget; then
    DL='wget -qO-'
else
    die "Neither curl nor wget is available to download the source."
fi

${DL} "${BUNDLE_URL}" > "${TMP_DIR}/astrocode.tar.gz" \
    || die "Could not download ${BUNDLE_URL}. Set ASTROCODE_BUNDLE_URL and retry."
tar -xzf "${TMP_DIR}/astrocode.tar.gz" -C "${TMP_DIR}" \
    || die "Downloaded archive is not a valid tarball."

SRC_DIR="$(find "${TMP_DIR}" -maxdepth 2 -name package.json -exec dirname {} \; 2>/dev/null | head -n 1)"
[ -n "${SRC_DIR}" ] && [ -f "${SRC_DIR}/bin/astrocode.js" ] \
    || die "Downloaded archive did not contain an Astrocode checkout."
info "Source ready: ${SRC_DIR}"

# ---------------------------------------------------------------------------
# Move it into a stable, persistent location — the launcher shims installed
# below reference this path directly, so it has to still be here next time
# `astrocode` runs (unlike TMP_DIR, which is cleaned up on exit).
# ---------------------------------------------------------------------------
step "Installing into ${INSTALL_DIR}"
mkdir -p "$(dirname "${INSTALL_DIR}")"
rm -rf "${INSTALL_DIR}"
mv "${SRC_DIR}" "${INSTALL_DIR}"

# ---------------------------------------------------------------------------
# Hand off to Astrocode's own installer, which writes `astrocode`/`astro`
# launcher shims onto a directory already on PATH (or explains how to add
# one). Any extra args this script was called with (--prefix, --uninstall,
# --dry-run, ...) pass straight through.
# ---------------------------------------------------------------------------
UNINSTALLING=0
for arg in "$@"; do
    [ "${arg}" = "--uninstall" ] || [ "${arg}" = "-u" ] && UNINSTALLING=1
done

step "Linking the astrocode command"
"${NODE_BIN}" "${INSTALL_DIR}/scripts/install.js" "$@"

if [ "${UNINSTALLING}" -eq 1 ]; then
    rm -rf "${INSTALL_DIR}"
    exit 0
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
say ""
say "${C_GREEN}${C_BOLD}${APP_NAME} installed.${C_RESET}"
say ""
if command -v astrocode >/dev/null 2>&1; then
    say "Run:  ${C_BOLD}astrocode${C_RESET}"
else
    say "Open a ${C_BOLD}new terminal${C_RESET}, then run:  ${C_BOLD}astrocode${C_RESET}"
fi
say ""
say "${C_DIM}That signs you in at getsonoma.lol and drops you into the agent.${C_RESET}"
