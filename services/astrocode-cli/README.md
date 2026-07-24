# Astrocode

An agentic coding CLI by **Tripplet**. Four models, a real tool layer, and a
terminal UI that stays out of your way.

```
astrocode
```

Zero dependencies, nothing to compile — if you have Node 18.17 or newer, it runs.

> **Sign in and the models are real.** `/login` is a genuine OAuth 2.1 flow
> against your Tripplet ChatUI; after it, prompts stream from a real model that
> calls the tools itself — reading and writing your actual files, running actual
> shell commands, behind the permission layer that really gates them. Your
> account's plan limits apply, and `/usage` shows what is left. `--engine local`
> answers from the built-in scripted engine instead, which is how you demo or
> work without a connection.

---

## Install

**macOS · Linux · BSD · WSL**

```sh
git clone <this repo> && cd Astrocode
./install.sh
```

**Windows** (PowerShell)

```powershell
git clone <this repo>; cd Astrocode
.\install.ps1
```

Both are thin wrappers around `node scripts/install.js`, which is where the real
work happens — one implementation, so every platform behaves the same. It writes
small launcher scripts for `astrocode` and `astro` into a directory that is
already on your PATH, needs no root, and touches nothing else.

```
--prefix <dir>    Install the launchers into <dir>
--uninstall, -u   Remove them again
--dry-run, -n     Show what would happen, change nothing
--force, -f       Overwrite launchers that are not ours
```

The bin directory is chosen in this order: `--prefix`, then `$ASTROCODE_BIN_DIR`,
then the first writable directory already on your PATH (`~/.local/bin`, `~/bin`,
the npm global bin), and failing that `~/.local/bin` on Unix or
`%LOCALAPPDATA%\Astrocode\bin` on Windows — with instructions for adding it to
your PATH.

To remove it:

```sh
./install.sh --uninstall        # or: npm run uninstall
```

You can also skip installation entirely and just run it in place:

```sh
node bin/astrocode.js
```

Or use npm if you prefer: `npm link`, or `npm install -g .`

> The launchers record the path of this checkout. If you move or delete it,
> re-run the installer — the old launcher will tell you so rather than failing
> mysteriously.

## Sign in

Astrocode authenticates against your Tripplet ChatUI — the same account you use
to chat with these models on the web.

```sh
astrocode login
```

Astrocode also opens with a login window on startup when you are signed out —
pick a deployment (tripplet.lol, trippletspark.com, getsonoma.lol), approve in
your browser, and you land in the app. Cancel it to stay signed out. If a browser
cannot open (SSH, a container, a bare TTY) the flow falls back:

```
╭─ Sign in to Tripplet ──────────────────────────────────────╮
│ ▲ Could not open a browser automatically.                  │
│                                                            │
│ Sign-in link                                               │
│ http://localhost:3000/api/oauth/authorize?response_type=…  │
│                                                            │
│ c copy link   o open again   p paste a code                │
╰─ waiting for approval · esc cancel ────────────────────────╯
```

Press **`c`** to copy the link, open it on any machine, approve, then press
**`p`** and paste back either the code or the whole redirected URL — whichever
your browser lets you copy. Both work.

| | |
| --- | --- |
| `astrocode login` · `/login` | Sign in (add `--url <base>` for another deployment) |
| `astrocode logout` · `/logout` | Forget the stored credentials |
| `astrocode whoami` · `/whoami` | Which account, which server, token status |

Tokens live in `~/.astrocode/auth.json`, owner-readable only, and refresh
themselves. Default deployment is **tripplet.lol**; the login window also offers
trippletspark.com and getsonoma.lol. Override with `--url`, the `authUrl` config
key, or `ASTROCODE_AUTH_URL`.

Headless runs need a session already: `astrocode -p "…"` exits `3` with
instructions if you are signed out.

## Models

| Model | Context | Price (in/out per Mtok) | Best at |
| --- | --- | --- | --- |
| **Astro 5 Code** | 500K | $5 / $25 | Flagship. Deepest reasoning, long-horizon agentic work. |
| **Taipei 4** | 200K | $0.80 / $4 | Fast and cheap. Edits, greps, quick questions. |
| **Majuli 4** | 1M | $2.50 / $12 | Million-token context. Whole-repo reading. |
| **Suzhou 4** | 300K | $3 / $15 | Reasoning specialist. Thinks longest, guesses least. |

Each has a genuinely different voice, streaming speed and reasoning depth — pick
one with `--model` or switch mid-session with `/model`.

```sh
astrocode --model taipei-4        # or: -m taipei, -m t4, -m "Taipei 4"
astrocode --list-models
```

## Effort

How hard the model thinks before it answers. Orthogonal to the model — any model
runs at any level.

| Level | Glyph | Behaviour |
| --- | --- | --- |
| `low` | `·` | Answer immediately. Barely any planning. |
| `medium` | `∴` | A short plan, then act. The everyday setting. |
| `high` | `✦` | Plans carefully, checks its own work. |
| `xhigh` | `✧` | Explores alternatives before committing. |
| `max` | `★` | Everything it has. Slow, thorough, expensive. |

```sh
astrocode --effort high      # or -e high
```

## Flags

```
-m, --model <name>          Pick a model
-e, --effort <level>        low | medium | high | xhigh | max
-C, --cwd <dir>             Working directory
-p, --prompt <text>         Headless: run one prompt, print the result, exit
-c, --continue              Resume the most recent session here
    --resume <id>           Resume a specific session
    --theme <name>          astro | crush | ember | mono
    --permission-mode <m>   ask | acceptEdits | plan | yolo
    --yolo                  Shorthand for --permission-mode yolo
    --engine <which>        auto (follow sign-in) | local | remote
    --max-turns <n>         Headless turn cap
    --seed <n>              Deterministic simulation
    --json                  Headless JSON output
    --no-welcome            Skip the welcome panel
-q, --quiet                 Minimal chrome
-v, --verbose               Expand tool output inline
    --no-color / --color    Force colour off / on
    --list-models           Print the model table and exit
-V, --version               Print the version
-h, --help                  Print help
```

A bare prompt works too — it pre-fills the editor so you can edit before sending:

```sh
astrocode "add a health check endpoint"
```

## Commands

Type `/` in the prompt to open the command palette (or press `ctrl+p`).

| | |
| --- | --- |
| `/login` `/logout` `/whoami` | Your Tripplet account |
| `/usage` | Plan limits and how much of them you have used |
| `/help` `/commands` | What everything does |
| `/model` `/effort` `/theme` `/permissions` | Arrow-key pickers — run them bare to choose from a list |
| `/clear` `/compact` | Reset the transcript, or summarise and keep the counters |
| `/init` | Scan the repo and write `ASTRO.md` |
| `/status` `/cost` `/session` | Where things stand |
| `/diff` `/files` `/commit` | Git |
| `/tools` | What the model may call |
| `/export` | Write the transcript to markdown |
| `/doctor` `/about` | Environment check, and who made this |
| `/quit` | Leave |

## Keys

| | |
| --- | --- |
| `enter` | Send · `ctrl+j` for a newline · trailing `\` also continues |
| `↑` `↓` | Prompt history (at the buffer edges) |
| `↑` `↓` `enter` | Move and confirm in a picker · `1`-`9` jumps straight to a row |
| `tab` | Accept the highlighted completion |
| `esc` | Interrupt a running turn, dismiss a popup, or clear the prompt |
| `ctrl+p` | Command palette · `@` completes file paths |
| `ctrl+c` | Clear the prompt; twice on an empty prompt to exit |
| `ctrl+d` | Exit |
| `ctrl+o` | Expand tool output |
| `ctrl+l` | Force a repaint |
| `pgup` `pgdn` | Scroll the transcript |

## Permissions

Astrocode's tools are real, so it asks before it changes anything.

| Mode | Reads | File edits | Shell |
| --- | --- | --- | --- |
| `ask` *(default)* | allowed | asks | asks |
| `acceptEdits` | allowed | allowed | asks |
| `plan` | allowed | **denied** | read-only commands only |
| `yolo` | allowed | allowed | allowed |

Genuinely catastrophic commands (`rm -rf /`, fork bombs, `mkfs`, writes to raw
devices) are refused in **every** mode, `yolo` included. Nothing can read or
write outside the directory the session started in.

Headless runs downgrade `ask` to `plan`: with nobody at the keyboard to approve
anything, read-only is the safe default. Pass `--yolo` or
`--permission-mode acceptEdits` when you mean it.

## Headless

```sh
astrocode -p "what does src/app.js export?"
astrocode -p "run the tests" --yolo
astrocode -p "summarise this repo" --json | jq .text
```

Exit code is `0` on success, `1` if a tool failed or the turn was interrupted,
`2` for a usage error.

## Git

`/commit` stages everything, writes a conventional-commit message from the
actual diff, and signs it:

```
feat(ui): add the TodoList component

- add src/TodoList.tsx (+70)
- update src/App.tsx (+10 -33)

🚀 Generated with Astrocode

Co-Authored by Astro 5 Code - Tripplet
```

If you used several models in one session, each gets its own line, in the order
you first used them.

## Configuration

Layered, lowest to highest:

1. built-in defaults
2. `~/.astrocode/config.json`
3. `./.astrocode.json` (per project)
4. CLI flags

```json
{
  "model": "astro-5-code",
  "effort": "high",
  "theme": "astro",
  "permissionMode": "ask",
  "authUrl": "https://tripplet.lol"
}
```

Sessions are saved to `~/.astrocode/sessions/` and resumed with `--continue`.

## Pickers

Any command that takes one of a fixed set of values opens an arrow-key list when
you run it bare:

```
╭─ Select a model ───────────────────────────────────────────╮
│   ● Astro 5 Code  500K ctx · $5/$25 · Flagship.            │
│   ○ Taipei 4      200K ctx · $0.8/$4 · Fast and cheap.     │
│ ❯ ○ Majuli 4      1M ctx · $2.5/$12 · Million-token.       │
│   ○ Suzhou 4      300K ctx · $3/$15 · Reasoning.           │
╰─ ↑↓ select · enter confirm · esc cancel ───────────────────╯
```

`●` marks what is active, and the list opens there — so `enter` without moving
never changes anything. `/model`, `/effort`, `/theme` and `/permissions` all
behave this way. Passing the value directly still works (`/model taipei`), and a
typo drops you into the picker rather than dead-ending.

## Layout

One full-width column for the conversation, with a status bar along the bottom
carrying the live state: files changed, context used, effort, and the active
model. `/status`, `/files` and `/cost` have the detail.

## Development

```sh
npm test        # 225 tests, no network, no writes outside a temp dir
```

The interesting seams:

| | |
| --- | --- |
| `src/ui/text.js` | Styled-run text engine — every width calculation starts here |
| `src/ui/screen.js` | Alternate screen, per-row diff renderer |
| `src/app.js` | The event loop and state machine |
| `src/engine/engine.js` | The scripted engine: classify → plan → stream |
| `src/engine/remote.js` | The real model: stream, run the tools it asks for, repeat |
| `src/core/api.js` | The only place that talks to Tripplet |
| `src/tools/` | The real tools, their schemas, and the permission gate |
| `src/auth/` | OAuth 2.1 + PKCE against the Tripplet ChatUI |
| `scripts/install.js` | The cross-platform installer |

Both engines are async generators of the same events, and nothing else in the
app knows or cares which one it is reading — which is why `--engine` can swap
them at runtime, and why adding a third would touch nothing outside
`src/engine/`.

---

Made by **Tripplet**.
