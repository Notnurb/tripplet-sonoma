#!/bin/sh
# Astrocode installer for macOS, Linux, BSD, WSL and anything else with a
# POSIX shell. All it does is locate Node and hand over to scripts/install.js,
# which is where the real work lives.
#
#   ./install.sh                 install
#   ./install.sh --uninstall     remove
#   ./install.sh --prefix DIR    choose the bin directory
#
# Any option is passed straight through; see ./install.sh --help.

set -eu

# Resolve this script's directory, following symlinks, without depending on
# readlink -f (which BSD and macOS do not have).
src=$0
while [ -h "$src" ]; do
  dir=$(cd -P "$(dirname "$src")" && pwd)
  src=$(ls -ld "$src" | sed 's/.*-> //')
  case $src in
    /*) ;;
    *) src=$dir/$src ;;
  esac
done
ROOT=$(cd -P "$(dirname "$src")" && pwd)

find_node() {
  if [ -n "${NODE:-}" ] && [ -x "$NODE" ]; then
    printf '%s' "$NODE"
    return 0
  fi
  if command -v node >/dev/null 2>&1; then
    command -v node
    return 0
  fi
  # Common locations a login shell might not have on PATH.
  for candidate in \
    /usr/local/bin/node \
    /opt/homebrew/bin/node \
    /usr/bin/node \
    "$HOME/.nvm/versions/node"/*/bin/node \
    "$HOME/.volta/bin/node" \
    "$HOME/.local/share/fnm/node-versions"/*/installation/bin/node
  do
    [ -x "$candidate" ] && printf '%s' "$candidate" && return 0
  done
  return 1
}

if ! NODE_BIN=$(find_node); then
  cat >&2 <<'EOF'
astrocode: could not find Node.

Astrocode needs Node 18.17 or newer. Install it from https://nodejs.org
(or your package manager), then run this script again.

If Node is installed somewhere unusual, point at it directly:
  NODE=/path/to/node ./install.sh
EOF
  exit 1
fi

exec "$NODE_BIN" "$ROOT/scripts/install.js" "$@"
