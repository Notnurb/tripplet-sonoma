# Tripplet Computer

A local agent workstation for macOS. Point it at a project folder and it reads
the code, makes edits, runs commands, browses the web, and acts across your
connected SaaS apps — behind an approval gate you configure.

Written in Rust (Tauri v2). The Rust core owns the agent loop, model routing,
the approval gate, the tool sandbox, Composio, and persistence. The webview is
a view layer: it renders state and sends intents, and holds no secrets and no
policy.

## Running it

```bash
cd apps/tripplet-computer
npm run dev          # cargo run — no bundler, the UI is static files
```

Requires Rust (1.77+) and the Xcode command-line tools. There is no npm
dependency tree: the frontend is plain ES modules loaded straight by the
webview.

```bash
npm test             # 202 Rust tests + 17 frontend tests
npm run test:rust
npm run test:ui
npm run build        # release binary
npm run bundle       # .app / .dmg (needs `cargo install tauri-cli`)
npm run icons        # regenerate the icon set from code
```

On first launch, open **Settings** (`⌘,`) and add a Tripplet API key. Without
one the app runs but cannot call a model.

## What it can do

| Group | Tools | Notes |
|---|---|---|
| **Files** | `read_file` `write_file` `edit_file` `list_dir` `search_files` | Sandboxed to the open project; `..` and symlinks are resolved before the check |
| **Terminal** | `run_command` | `/bin/sh -c`, hard timeout, captured output, both pipes drained concurrently |
| **Browser** | `fetch_url` `web_search` | Keyless DuckDuckGo; loopback and private ranges refused outright |
| **Connectors** | `composio_*` | Per-user Composio toolkits; results fenced as untrusted data |

Each group is individually switchable on the Plugins page. A group that is off
has its tools removed from the model's toolset entirely, and the dispatcher
refuses the call as well.

## Models and effort

Four personas — **Suzhou 4**, **Majuli 4**, **Taipei 4**, **Astro 5.1**
(flagship). Ids are stable API identifiers; display names move independently,
so a rename never orphans a saved thread. Upstream model names are resolved in
`models.rs` and never reach the webview.

Effort is the second axis:

| Tier | Tokens | Steps | Fleet |
|---|---|---|---|
| Low | 2 048 | 12 | — |
| Medium | 4 096 | 24 | — |
| High | 8 192 | 40 | — |
| XHigh | 12 288 | 64 | 3 |
| Max | 16 384 | 96 | 6 |
| **Ultra** | 24 576 | 160 | **16** |

Low → Max scale one agent's budget. **Ultra changes the topology**: a planner
splits the request into distinct investigative lenses, a fleet of read-only
subagents works them in parallel (6 concurrent), and the lead agent reconciles
the findings before touching a file.

Subagents are read-only on purpose — sixteen agents editing one working tree is
a race, not a fleet. If the planner is unavailable, a fixed
orthogonal-by-construction lens list takes over, so an Ultra turn never fails
because a cheap model hiccupped.

## Approvals

Three modes, switchable mid-conversation from the composer:

- **Ask for approval** — anything leaving the project folder, or any network
  use, stops for you.
- **Approve for me** — a risk classifier auto-approves reads, in-project
  writes, and read-only commands (`git status`, `cargo check`), and prompts for
  the rest.
- **Custom (config.toml)** — explicit allow-lists for paths, commands, hosts,
  and connector tools.

One rule sits above all three: the **dangerous** set always prompts. `sudo`,
`rm -rf`, `dd`, `git push`, `npm publish`, `curl … | sh` and friends are never
auto-approved, not even by `allow_commands = ["*"]`. A blanket allow-list is a
statement about convenience, not a waiver on irreversible commands.

Two more deliberate choices:

- A prompt that cannot be answered — window closed, turn cancelled, five-minute
  timeout — resolves to **deny**. An unanswerable prompt is never an implicit
  yes.
- Private-range and non-http URLs are **refused**, not prompted. Offering a
  one-click Allow on an SSRF probe would be the whole vulnerability.

## Files

```
src-tauri/src/
  agent/          turn loop, Ultra orchestrator, prompt builder, event contract
  composio/       v3 REST client + connector tool bridge
  tools/          fs, shell, web — every tool returns a recoverable outcome
  approval.rs     risk classification and the policy decision table
  approver.rs     the runtime prompt round-trip
  models.rs       persona catalogue and effort tiers
  config.rs       config.toml (0600), degrades to defaults on any parse error
  store.rs        SQLite: threads, messages, projects
  state.rs        shared app state
  lib.rs          Tauri commands — the complete surface the webview can reach
ui/
  index.html      shell
  styles/         app.css (shell, composer, transcript), catalog.css (pages)
  js/             plain ES modules; markdown.js is escape-first and tested
```

`~/Library/Application Support/ai.tripplet.computer/` holds `config.toml`, the
SQLite database, and a `skills/` folder.

## Skills

Markdown playbooks with front-matter, re-read on every list so an edit takes
effect on the next turn:

```markdown
---
name: Ship Checklist
description: What to verify before tagging a release
---
1. Run the full suite and report the real result.
2. …
```

Eight ship built in (code review, tests, debugging, refactor, release notes,
dependency audit, and more). A user skill overrides a built-in of the same
slug. Only names and descriptions enter the system prompt — bodies are injected
on demand, so a dozen skills do not crowd out the conversation.

## Known gaps

- No signed or notarised build yet; `npm run bundle` produces an unsigned
  `.app`.
- Connector OAuth returns to `https://tripplet.ai/computer/connected`, which
  needs to exist before the round trip completes cleanly.
- `cargo clippy` needs `rustup component add clippy` on this toolchain.
