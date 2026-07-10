#!/bin/sh
# Tripplet setup — launches the interactive setup TUI (install, run server,
# tutorials, customization). Works immediately after clone: the executable
# bit is committed to git, so no chmod +x is needed.
#   ./setup.sh            interactive TUI
#   ./setup.sh --help     available subcommands
# On Windows, run it from Git Bash or WSL — or use `npm run setup` anywhere.
if ! command -v node >/dev/null 2>&1; then
    echo "Node.js is required but was not found on your PATH."
    echo "Install Node 20 LTS from https://nodejs.org (or via nvm/brew), then re-run ./setup.sh"
    exit 1
fi
exec node "$(dirname "$0")/scripts/setup-tui.mjs" "$@"
