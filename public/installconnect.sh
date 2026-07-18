#!/usr/bin/env bash
#
# OpenSonoma — one-command network installer.
#
#   curl -fsSL https://tripplet.lol/installconnect | bash
#
# Downloads OpenSonoma, installs it into an isolated Python environment, and
# wires the `opensonoma` command onto your PATH. Works on macOS, Linux, and
# Windows (via Git Bash or WSL). Safe to re-run — it upgrades in place.
#
# After it finishes, open a new terminal and run:  opensonoma
#
# Overridable via env:
#   OPENSONOMA_BUNDLE_URL   tarball of the source tree (has pyproject.toml)
#   OPENSONOMA_REPO         git fallback if the tarball can't be fetched

# Re-exec under bash if started by a POSIX sh (we use bash features).
if [ -z "${BASH_VERSION:-}" ]; then
    exec bash "$0" "$@"
fi

set -euo pipefail

# ---------------------------------------------------------------------------
# Settings
# ---------------------------------------------------------------------------
APP_NAME="OpenSonoma"
BUNDLE_URL="${OPENSONOMA_BUNDLE_URL:-https://tripplet.lol/opensonoma.tar.gz}"
REPO="${OPENSONOMA_REPO:-https://github.com/tripplet/opensonoma}"
HOME_DIR="${HOME:-$USERPROFILE}"
VENV_DIR="${HOME_DIR}/.opensonoma/venv"
BIN_DIR="${HOME_DIR}/.local/bin"
RC_MARKER="# OpenSonoma (added by installconnect)"

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
# Platform detection
# ---------------------------------------------------------------------------
UNAME="$(uname -s 2>/dev/null || echo unknown)"
IS_WINDOWS=0
case "${UNAME}" in
    MINGW*|MSYS*|CYGWIN*) IS_WINDOWS=1 ;;
esac

say ""
say "${C_BOLD}Installing ${APP_NAME}${C_RESET}"
say "${C_DIM}platform: ${UNAME}${C_RESET}"
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
    case "${UNAME}" in
        Darwin) info "Install it with Homebrew:  brew install python" ;;
        Linux)
            info "Debian/Ubuntu:  sudo apt install python3 python3-venv python3-pip"
            info "Fedora:         sudo dnf install python3 python3-pip"
            info "Arch:           sudo pacman -S python python-pip" ;;
        MINGW*|MSYS*|CYGWIN*) info "Install Python from https://python.org (tick 'Add to PATH')." ;;
        *) info "Install Python 3.9 or newer, then re-run this installer." ;;
    esac
    die "Python 3.9+ is required."
fi
info "Using ${PY} ($("${PY}" -c 'import sys;print("%d.%d.%d"%sys.version_info[:3])'))"

# ---------------------------------------------------------------------------
# Auto-install the system build tools the agent uses (C/C++ compiler, cmake,
# make, git). Best-effort and non-interactive — it never fails the install.
# Opt out with OPENSONOMA_SKIP_SYSTEM_DEPS=1.
# ---------------------------------------------------------------------------
detect_pkg_mgr() {
    case "${UNAME}" in
        Darwin) command -v brew >/dev/null 2>&1 && echo brew ;;
        Linux)
            if   command -v apt-get >/dev/null 2>&1; then echo apt
            elif command -v dnf     >/dev/null 2>&1; then echo dnf
            elif command -v pacman  >/dev/null 2>&1; then echo pacman
            fi ;;
    esac
}

have_compiler() {
    command -v cc  >/dev/null 2>&1 || command -v clang++ >/dev/null 2>&1 \
        || command -v g++ >/dev/null 2>&1 || command -v gcc >/dev/null 2>&1
}

map_pkg() { # $1 = manager, $2 = tool  ->  package name (or empty)
    case "$1" in
        brew)   case "$2" in compiler) echo llvm ;; cmake) echo cmake ;; make) echo make ;; git) echo git ;; esac ;;
        apt)    case "$2" in compiler) echo g++ ;; cmake) echo cmake ;; make) echo make ;; git) echo git ;; esac ;;
        dnf)    case "$2" in compiler) echo gcc-c++ ;; cmake) echo cmake ;; make) echo make ;; git) echo git ;; esac ;;
        pacman) case "$2" in compiler) echo gcc ;; cmake) echo cmake ;; make) echo make ;; git) echo git ;; esac ;;
    esac
}

install_system_deps() {
    if [ "${OPENSONOMA_SKIP_SYSTEM_DEPS:-0}" = "1" ]; then
        info "Skipping system dependencies (OPENSONOMA_SKIP_SYSTEM_DEPS=1)."
        return 0
    fi

    local missing=""
    have_compiler                       || missing="${missing} compiler"
    command -v cmake >/dev/null 2>&1     || missing="${missing} cmake"
    command -v make  >/dev/null 2>&1     || missing="${missing} make"
    command -v git   >/dev/null 2>&1     || missing="${missing} git"
    missing="$(printf '%s' "${missing}" | sed 's/^ *//')"

    if [ -z "${missing}" ]; then
        info "Build tools present (compiler, cmake, make, git)."
        return 0
    fi

    step "Installing missing dependencies: ${missing}"

    if [ "${IS_WINDOWS}" -eq 1 ]; then
        if command -v winget >/dev/null 2>&1; then
            for tool in ${missing}; do
                case "${tool}" in
                    git)   winget install --silent --accept-source-agreements --accept-package-agreements Git.Git >/dev/null 2>&1 || true ;;
                    cmake) winget install --silent --accept-source-agreements --accept-package-agreements Kitware.CMake >/dev/null 2>&1 || true ;;
                esac
            done
        fi
        warn "On Windows, install any remaining tools (${missing}) yourself if you need C/C++ builds."
        return 0
    fi

    local mgr; mgr="$(detect_pkg_mgr || true)"
    if [ -z "${mgr}" ]; then
        warn "No supported package manager found — install these manually if you need C/C++ builds: ${missing}"
        return 0
    fi

    local SUDO=""
    if [ "$(id -u 2>/dev/null || echo 0)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
        SUDO="sudo"
    fi

    local pkgs=""
    for tool in ${missing}; do
        local p; p="$(map_pkg "${mgr}" "${tool}")"
        [ -n "${p}" ] && pkgs="${pkgs} ${p}"
    done
    pkgs="$(printf '%s' "${pkgs}" | sed 's/^ *//')"
    [ -z "${pkgs}" ] && return 0

    info "Using ${mgr}: ${pkgs}"
    case "${mgr}" in
        brew)   brew install ${pkgs} || warn "brew could not install: ${pkgs}" ;;
        apt)    ${SUDO} apt-get update -y >/dev/null 2>&1 || true
                ${SUDO} apt-get install -y ${pkgs} || warn "apt could not install: ${pkgs}" ;;
        dnf)    ${SUDO} dnf install -y ${pkgs} || warn "dnf could not install: ${pkgs}" ;;
        pacman) ${SUDO} pacman -S --noconfirm ${pkgs} || warn "pacman could not install: ${pkgs}" ;;
    esac
    return 0
}

install_system_deps || true

# ---------------------------------------------------------------------------
# Fetch the OpenSonoma source (tarball, with a git fallback)
# ---------------------------------------------------------------------------
need_cmd() { command -v "$1" >/dev/null 2>&1; }

TMP_DIR="$(mktemp -d 2>/dev/null || mktemp -d -t opensonoma)"
cleanup() { rm -rf "${TMP_DIR}" 2>/dev/null || true; }
trap cleanup EXIT

SRC_DIR=""

step "Downloading ${APP_NAME}"
if need_cmd curl; then
    DL='curl -fsSL'
elif need_cmd wget; then
    DL='wget -qO-'
else
    die "Neither curl nor wget is available to download the source."
fi

if ${DL} "${BUNDLE_URL}" > "${TMP_DIR}/os.tar.gz" 2>/dev/null \
    && tar -xzf "${TMP_DIR}/os.tar.gz" -C "${TMP_DIR}" 2>/dev/null; then
    SRC_DIR="$(find "${TMP_DIR}" -maxdepth 3 -name pyproject.toml -exec dirname {} \; 2>/dev/null | head -n 1)"
fi

if [ -z "${SRC_DIR}" ] && need_cmd git; then
    info "Tarball unavailable — cloning ${REPO}"
    if git clone --depth 1 "${REPO}" "${TMP_DIR}/src" >/dev/null 2>&1; then
        SRC_DIR="${TMP_DIR}/src"
    fi
fi

[ -n "${SRC_DIR}" ] && [ -f "${SRC_DIR}/pyproject.toml" ] \
    || die "Could not download the ${APP_NAME} source. Set OPENSONOMA_BUNDLE_URL or OPENSONOMA_REPO and retry."
info "Source ready: ${SRC_DIR}"

# ---------------------------------------------------------------------------
# Install into an isolated venv (pipx if present, else a dedicated venv)
# ---------------------------------------------------------------------------
ENTRYPOINT=""

if need_cmd pipx; then
    step "Installing with pipx"
    pipx install --force "${SRC_DIR}" >/dev/null
    pipx ensurepath >/dev/null 2>&1 || true
    # Add the end-to-end encryption dependency (best-effort; base install still
    # works over the TLS transport if no wheel is available).
    pipx inject --quiet opensonoma cryptography >/dev/null 2>&1 \
        || info "Encryption extra unavailable — using the TLS transport only."
    ENTRYPOINT="$(command -v opensonoma 2>/dev/null || true)"
    [ -n "${ENTRYPOINT}" ] || [ ! -x "${HOME_DIR}/.local/bin/opensonoma" ] || ENTRYPOINT="${HOME_DIR}/.local/bin/opensonoma"
else
    step "Creating virtual environment at ${VENV_DIR}"
    mkdir -p "$(dirname "${VENV_DIR}")"
    "${PY}" -m venv "${VENV_DIR}" 2>/dev/null || {
        case "${UNAME}" in Linux) info "On Debian/Ubuntu try:  sudo apt install python3-venv" ;; esac
        die "Could not create a virtual environment."
    }

    # venv layout differs on Windows (Scripts/) vs Unix (bin/).
    if [ -d "${VENV_DIR}/Scripts" ]; then VBIN="${VENV_DIR}/Scripts"; else VBIN="${VENV_DIR}/bin"; fi
    VENV_PY="${VBIN}/python"; [ -x "${VENV_PY}" ] || VENV_PY="${VBIN}/python.exe"

    step "Installing ${APP_NAME}"
    "${VENV_PY}" -m pip install --quiet --upgrade pip setuptools wheel
    # Prefer the [e2e] extra (end-to-end encryption); fall back to the base
    # package if the cryptography wheel can't be installed on this platform.
    if ! "${VENV_PY}" -m pip install --quiet "${SRC_DIR}[e2e]"; then
        info "Encryption extra unavailable — installing the base package (TLS transport)."
        "${VENV_PY}" -m pip install --quiet "${SRC_DIR}"
    fi

    ENTRYPOINT="${VBIN}/opensonoma"
    [ -x "${ENTRYPOINT}" ] || ENTRYPOINT="${VBIN}/opensonoma.exe"
    [ -x "${ENTRYPOINT}" ] || die "Install finished but the opensonoma launcher is missing in ${VBIN}."
fi

# ---------------------------------------------------------------------------
# Put `opensonoma` on PATH
# ---------------------------------------------------------------------------
step "Linking the opensonoma command"
mkdir -p "${BIN_DIR}"
if [ "${IS_WINDOWS}" -eq 1 ]; then
    # Symlinks are unreliable on Windows — write a launcher shim instead.
    cat > "${BIN_DIR}/opensonoma" <<SHIM
#!/usr/bin/env bash
exec "${ENTRYPOINT}" "\$@"
SHIM
    chmod +x "${BIN_DIR}/opensonoma" 2>/dev/null || true
    # Also a .cmd so it works from PowerShell / cmd.exe natively.
    WIN_ENTRY="$(cygpath -w "${ENTRYPOINT}" 2>/dev/null || echo "${ENTRYPOINT}")"
    printf '@echo off\r\n"%s" %%*\r\n' "${WIN_ENTRY}" > "${BIN_DIR}/opensonoma.cmd"
else
    ln -sf "${ENTRYPOINT}" "${BIN_DIR}/opensonoma"
fi
info "${BIN_DIR}/opensonoma -> ${ENTRYPOINT}"

# Append the PATH export to the shells that exist (idempotent via marker).
PATH_LINE="export PATH=\"${BIN_DIR}:\$PATH\""
add_path_to_rc() {
    local rc="$1"
    [ -e "$rc" ] || return 0
    grep -qF "${RC_MARKER}" "$rc" 2>/dev/null && return 0
    printf '\n%s\n%s\n' "${RC_MARKER}" "${PATH_LINE}" >> "$rc"
    info "updated ${rc}"
}
# Touch the rc for the current shell so a fresh terminal just works.
case "${SHELL:-}" in
    */zsh)  [ -e "${HOME_DIR}/.zshrc" ]  || : > "${HOME_DIR}/.zshrc" ;;
    */bash) [ -e "${HOME_DIR}/.bashrc" ] || : > "${HOME_DIR}/.bashrc" ;;
esac
add_path_to_rc "${HOME_DIR}/.zshrc"
add_path_to_rc "${HOME_DIR}/.bashrc"
add_path_to_rc "${HOME_DIR}/.bash_profile"
add_path_to_rc "${HOME_DIR}/.profile"

# Windows: persist the bin dir on the *User* PATH so it survives outside bash.
if [ "${IS_WINDOWS}" -eq 1 ]; then
    WINBIN="$(cygpath -w "${BIN_DIR}" 2>/dev/null || echo "${BIN_DIR}")"
    if command -v powershell.exe >/dev/null 2>&1; then
        powershell.exe -NoProfile -Command \
          "\$p=[Environment]::GetEnvironmentVariable('PATH','User'); if(\$p -notlike '*${WINBIN}*'){[Environment]::SetEnvironmentVariable('PATH', \$p + ';${WINBIN}', 'User')}" \
          >/dev/null 2>&1 && info "added ${WINBIN} to your Windows user PATH" || \
          warn "Could not update the Windows PATH automatically. Add ${WINBIN} manually."
    fi
fi

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
say ""
say "${C_GREEN}${C_BOLD}${APP_NAME} installed.${C_RESET}"
say ""
if command -v opensonoma >/dev/null 2>&1; then
    say "Run:  ${C_BOLD}opensonoma${C_RESET}"
else
    say "Open a ${C_BOLD}new terminal${C_RESET} and run:  ${C_BOLD}opensonoma${C_RESET}"
    say "${C_DIM}(or this session only:  export PATH=\"${BIN_DIR}:\$PATH\")${C_RESET}"
fi
say ""
say "${C_DIM}That opens the setup wizard (machine name, password, pairing code +"
say "verification emoji). Then pair it in Tripplet at /connect.${C_RESET}"
