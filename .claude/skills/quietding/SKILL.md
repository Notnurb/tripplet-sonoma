---
name: quietding
description: Turns on a quiet completion ding — plays a soft, quiet sound through the terminal every time the agent finishes responding, for the rest of the session. Use when the user runs /quietding.
---

# quietding

Activates quiet completion dings for the rest of this session.

## Steps

1. Run this command to set the ding state to quiet:
   ```bash
   echo "quiet" > "$CLAUDE_PROJECT_DIR/.claude/ding-state"
   ```
   If `$CLAUDE_PROJECT_DIR` is not set, use the absolute path to the current project's `.claude` directory instead.
2. Confirm to the user in one short sentence that quiet ding mode is now active and will play a soft sound at the end of every response for the rest of the session.

Do not do anything else — this skill only toggles state, it does not play the sound itself (a Stop hook at `.claude/hooks/ding.sh` handles playback automatically after every response).
