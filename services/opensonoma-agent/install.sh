#!/usr/bin/env bash
#
# OpenSonoma one-command installer.
#
# Installs the `opensonoma` CLI into an isolated environment and puts it on your
# PATH. Works on macOS and Linux. Safe to re-run (idempotent): it will upgrade
# an existing install in place.
#
#   curl ... | bash         # piped
#   ./install.sh            # from the source tree
#   bash install.sh
#
# After it finishes, run:  opensonoma   (opens the setup wizard).

# Re-exec under bash if we were started by a POSIX sh (we use bash features).
if [ -z "${BASH_VERSION:-}" ]; then
    exec bash "$0" "$@"
fi

set -euo pipefail

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
APP_NAME="OpenSonoma"
VENV_DIR="${HOME}/.opensonoma/venv"
BIN_DIR="${HOME}/.local/bin"

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

# ---------------------------------------------------------------------------
# Locate the project root (the directory holding this script + pyproject.toml)
# ---------------------------------------------------------------------------
src="${BASH_SOURCE[0]:-$0}"
while [ -h "$src" ]; do
    dir="$(cd -P "$(dirname "$src")" >/dev/null 2>&1 && pwd)"
    src="$(readlink "$src")"
    case "$src" in
        /*) ;;
        *) src="$dir/$src" ;;
    esac
done
PROJECT_DIR="$(cd -P "$(dirname "$src")" >/dev/null 2>&1 && pwd)"

if [ ! -f "${PROJECT_DIR}/pyproject.toml" ]; then
    die "pyproject.toml not found in ${PROJECT_DIR}. Run install.sh from the OpenSonoma source tree."
fi

say ""
say "${C_BOLD}Installing ${APP_NAME}${C_RESET}"
say "${C_DIM}source: ${PROJECT_DIR}${C_RESET}"
say ""

# ---------------------------------------------------------------------------
# Find a suitable Python (>= 3.9)
# ---------------------------------------------------------------------------
find_python() {
    local cand
    for cand in python3 python3.12 python3.11 python3.10 python3.9 python; do
        if command -v "$cand" >/dev/null 2>&1; then
            if "$cand" - <<'PYEOF' >/dev/null 2>&1
import sys
raise SystemExit(0 if sys.version_info[:2] >= (3, 9) else 1)
PYEOF
            then
                command -v "$cand"
                return 0
            fi
        fi
    done
    return 1
}

step "Checking for Python 3.9+"
PY="$(find_python || true)"
if [ -z "${PY}" ]; then
    warn "No Python 3.9+ interpreter was found on your PATH."
    case "$(uname -s)" in
        Darwin) info "Install it with Homebrew:  brew install python" ;;
        Linux)
            info "Install it with your package manager, e.g.:"
            info "  Debian/Ubuntu:  sudo apt install python3 python3-venv python3-pip"
            info "  Fedora:         sudo dnf install python3 python3-pip"
            info "  Arch:           sudo pacman -S python python-pip"
            ;;
        *) info "Install Python 3.9 or newer, then re-run this script." ;;
    esac
    die "Python 3.9+ is required."
fi
PY_VER="$("${PY}" -c 'import sys; print("%d.%d.%d" % sys.version_info[:3])')"
info "Using ${PY} (Python ${PY_VER})"

# ---------------------------------------------------------------------------
# Install: prefer pipx if available, otherwise a dedicated venv
# ---------------------------------------------------------------------------
ENTRYPOINT=""   # absolute path to the installed `opensonoma` executable

if command -v pipx >/dev/null 2>&1; then
    step "Installing with pipx"
    pipx install --force "${PROJECT_DIR}"
    # Make sure pipx's bin dir is wired onto PATH for future shells.
    pipx ensurepath >/dev/null 2>&1 || true
    ENTRYPOINT="$(command -v opensonoma 2>/dev/null || true)"
    if [ -z "${ENTRYPOINT}" ]; then
        # pipx default bin location.
        if [ -x "${HOME}/.local/bin/opensonoma" ]; then
            ENTRYPOINT="${HOME}/.local/bin/opensonoma"
        fi
    fi
else
    step "Creating virtual environment at ${VENV_DIR}"
    mkdir -p "$(dirname "${VENV_DIR}")"
    if ! "${PY}" -m venv "${VENV_DIR}" 2>/dev/null; then
        warn "Could not create a virtual environment."
        case "$(uname -s)" in
            Linux) info "On Debian/Ubuntu you may need:  sudo apt install python3-venv" ;;
        esac
        die "venv creation failed."
    fi

    VENV_PY="${VENV_DIR}/bin/python"
    [ -x "${VENV_PY}" ] || die "Virtual environment looks broken (no ${VENV_PY})."

    step "Upgrading pip"
    "${VENV_PY}" -m pip install --quiet --upgrade pip setuptools wheel

    step "Installing ${APP_NAME} (pip install .)"
    "${VENV_PY}" -m pip install --quiet "${PROJECT_DIR}"

    ENTRYPOINT="${VENV_DIR}/bin/opensonoma"
    [ -x "${ENTRYPOINT}" ] || die "Install finished but ${ENTRYPOINT} is missing."

    step "Linking opensonoma onto your PATH"
    mkdir -p "${BIN_DIR}"
    ln -sf "${ENTRYPOINT}" "${BIN_DIR}/opensonoma"
    info "${BIN_DIR}/opensonoma -> ${ENTRYPOINT}"
    ENTRYPOINT="${BIN_DIR}/opensonoma"
fi

# ---------------------------------------------------------------------------
# Verify it runs
# ---------------------------------------------------------------------------
if [ -n "${ENTRYPOINT}" ] && [ -x "${ENTRYPOINT}" ]; then
    if INSTALLED_VER="$("${ENTRYPOINT}" --version 2>/dev/null)"; then
        info "Installed: ${INSTALLED_VER}"
    fi
fi

# ---------------------------------------------------------------------------
# PATH guidance
# ---------------------------------------------------------------------------
on_path() {
    case ":${PATH}:" in
        *":${1}:"*) return 0 ;;
        *) return 1 ;;
    esac
}

NEEDS_PATH_HINT=0
if ! command -v opensonoma >/dev/null 2>&1; then
    NEEDS_PATH_HINT=1
fi

say ""
if [ "${NEEDS_PATH_HINT}" -eq 1 ] && ! on_path "${BIN_DIR}"; then
    case "${SHELL:-}" in
        */zsh)  RC="${HOME}/.zshrc" ;;
        */bash) RC="${HOME}/.bashrc" ;;
        *)      RC="${HOME}/.profile" ;;
    esac
    warn "${BIN_DIR} is not on your PATH yet."
    say  "Add it by running:"
    say  "    echo 'export PATH=\"${BIN_DIR}:\$PATH\"' >> ${RC}"
    say  "    source ${RC}"
    say  ""
    say  "Or start ${APP_NAME} right now with its full path:"
    say  "    ${ENTRYPOINT}"
    say  ""
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
say "${C_GREEN}${C_BOLD}${APP_NAME} installed.${C_RESET}"
say ""
say "Run: opensonoma"
say ""
say "${C_DIM}That opens the setup wizard (machine name, password, pairing code,"
say "and the always-on background service). After setup, link your machine in"
say "Tripplet -> Sonoma -> OpenSonoma using the pairing code shown.${C_RESET}"
