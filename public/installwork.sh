#!/usr/bin/env bash
#
# Tripplet Work — one-command macOS installer.
#
#   curl -fsSL https://www.tripplet.lol/installwork | bash
#
# Downloads the app, installs it to /Applications, and clears the download
# quarantine flag so it opens on the first try.
#
# Why this exists: Tripplet Work is ad-hoc signed but not notarized by Apple
# (notarization needs a paid Apple Developer account). Anything downloaded
# through a browser is tagged com.apple.quarantine, and for a non-notarized
# app that produces a Gatekeeper warning you have to click past. Installing
# from the terminal never applies that tag, so there is nothing to click past.
#
# You can do exactly the same thing by hand:
#   1. open the .dmg, drag the app to Applications
#   2. xattr -dr com.apple.quarantine "/Applications/Tripplet Work.app"
#
# Overridable via env:
#   TRIPPLET_WORK_DMG_URL   where to fetch the disk image from
#   TRIPPLET_WORK_DEST      install directory (default /Applications)

if [ -z "${BASH_VERSION:-}" ]; then
    exec bash "$0" "$@"
fi

set -euo pipefail

DMG_URL="${TRIPPLET_WORK_DMG_URL:-https://www.tripplet.lol/TrippletWork.dmg}"
DEST="${TRIPPLET_WORK_DEST:-/Applications}"
APP_NAME="Tripplet Work.app"

bold() { printf '\033[1m%s\033[0m\n' "$1"; }
info() { printf '  %s\n' "$1"; }
fail() { printf '\033[31merror:\033[0m %s\n' "$1" >&2; exit 1; }

[ "$(uname -s)" = "Darwin" ] || fail "Tripplet Work is macOS only right now. Join the waitlist at https://www.tripplet.lol/work"

bold "Installing Tripplet Work"

TMP="$(mktemp -d -t tripplet-work)"
MOUNT=""

cleanup() {
    # Always detach before removing the temp dir, or the mount lingers.
    if [ -n "$MOUNT" ] && [ -d "$MOUNT" ]; then
        hdiutil detach "$MOUNT" -quiet >/dev/null 2>&1 || true
    fi
    rm -rf "$TMP"
}
trap cleanup EXIT

info "Downloading…"
curl -fsSL "$DMG_URL" -o "$TMP/TrippletWork.dmg" || fail "could not download $DMG_URL"

info "Mounting…"
MOUNT="$TMP/mnt"
mkdir -p "$MOUNT"
hdiutil attach "$TMP/TrippletWork.dmg" -mountpoint "$MOUNT" -nobrowse -quiet \
    || fail "could not mount the disk image"

[ -d "$MOUNT/$APP_NAME" ] || fail "the disk image did not contain $APP_NAME"

# Quit a running copy so we don't overwrite a live bundle.
if pgrep -f "$DEST/$APP_NAME" >/dev/null 2>&1; then
    info "Quitting the running copy…"
    osascript -e 'quit app "Tripplet Work"' >/dev/null 2>&1 || true
    sleep 2
fi

# Braces are required, not style: macOS ships bash 3.2, which does not treat a
# multibyte character as the end of a variable name — "$DEST…" is read as the
# variable DEST… and trips `set -u`.
info "Installing to ${DEST}…"
if [ -w "$DEST" ]; then
    rm -rf "${DEST:?}/$APP_NAME"
    cp -R "$MOUNT/$APP_NAME" "$DEST/"
else
    info "(needs your password to write to $DEST)"
    sudo rm -rf "${DEST:?}/$APP_NAME"
    sudo cp -R "$MOUNT/$APP_NAME" "$DEST/"
    sudo chown -R "$(id -u):$(id -g)" "$DEST/$APP_NAME"
fi

# The copy inherits no quarantine from a terminal download, but strip it
# anyway so re-running over a browser-installed copy also clears it.
xattr -dr com.apple.quarantine "$DEST/$APP_NAME" >/dev/null 2>&1 || true

if ! codesign --verify --deep --strict "$DEST/$APP_NAME" >/dev/null 2>&1; then
    fail "the installed app failed signature verification — please report this"
fi

bold "Done."
info "Installed: $DEST/$APP_NAME"
info "Launch it from Spotlight, or run: open -a \"Tripplet Work\""

open -a "$DEST/$APP_NAME" >/dev/null 2>&1 || true
