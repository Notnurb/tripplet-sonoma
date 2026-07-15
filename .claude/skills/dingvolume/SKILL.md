---
name: dingvolume
description: Opens an interactive terminal TUI to adjust the volume of loudding and quietding completion sounds. Use when the user runs /dingvolume or asks to change/adjust the ding volume.
---

# dingvolume

Opens an interactive terminal menu for adjusting the loud and quiet ding volumes independently. This is a live, interactive TUI (arrow-free menu with `+`/`-`/exact-value input and live preview) — it must run in the user's real terminal, not be captured through a non-interactive tool call.

## Steps

1. Tell the user to run the following in their terminal, using the `!` prefix so it runs interactively:
   ```
   !bash "$CLAUDE_PROJECT_DIR/.claude/hooks/ding-volume-tui.sh"
   ```
   (If `$CLAUDE_PROJECT_DIR` isn't set in their shell, substitute the absolute path to the project's `.claude` directory.)
2. Do not attempt to run this script yourself via the Bash tool — it requires live keyboard input across multiple prompts and will not work non-interactively.
3. Once they've saved their settings, the new volumes take effect immediately — the `Stop` hook (`.claude/hooks/ding.sh`) reads `.claude/ding-config` fresh on every ding.
