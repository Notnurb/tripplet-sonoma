#!/usr/bin/env node
// Tripplet setup TUI — zero-dependency, cross-platform (Windows, macOS, Linux).
//
// Launch with ./setup.sh (macOS/Linux; Git Bash or WSL on Windows), with
// `npm run setup` on any OS, or directly:
//   node scripts/setup-tui.mjs            interactive TUI
//   node scripts/setup-tui.mjs install    non-interactive install
//   node scripts/setup-tui.mjs run [--port N]   run the dev server
//   node scripts/setup-tui.mjs config     print parsed src/config.md as JSON
//
// Deliberately dependency-free: it must work on a fresh clone BEFORE
// `npm install` has ever run. Everything is ANSI + node builtins.

import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { loadAppConfig, saveAppConfig, configPath } from '../src/lib/config-md.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IS_WIN = process.platform === 'win32';
const IS_MAC = process.platform === 'darwin';
const OS_NAME = IS_WIN ? 'Windows' : IS_MAC ? 'macOS' : 'Linux';
const TTY = process.stdout.isTTY && process.stdin.isTTY && !process.env.NO_COLOR;

// ─── ANSI helpers ────────────────────────────────────────────────────────────

const esc = (s) => (TTY ? s : '');
const C = {
    reset: esc('\x1b[0m'),
    bold: esc('\x1b[1m'),
    dim: esc('\x1b[2m'),
    inverse: esc('\x1b[7m'),
    cyan: esc('\x1b[36m'),
    green: esc('\x1b[32m'),
    yellow: esc('\x1b[33m'),
    red: esc('\x1b[31m'),
    magenta: esc('\x1b[35m'),
};
const clear = () => { if (TTY) process.stdout.write('\x1b[2J\x1b[H'); };
const hideCursor = () => { if (TTY) process.stdout.write('\x1b[?25l'); };
const showCursor = () => { if (TTY) process.stdout.write('\x1b[?25h'); };
const line = (s = '') => process.stdout.write(s + '\n');

function header(title) {
    const cfg = config();
    const width = Math.min(process.stdout.columns || 78, 78);
    const bar = '─'.repeat(Math.max(4, width - 2));
    line(`${C.cyan}┌${bar}┐${C.reset}`);
    line(`${C.cyan}│${C.reset} ${C.bold}${cfg.app.name} setup${C.reset} ${C.dim}· ${title} · ${OS_NAME} · node ${process.version}${C.reset}`);
    line(`${C.cyan}└${bar}┘${C.reset}`);
}

// ─── Config access ───────────────────────────────────────────────────────────

const config = () => loadAppConfig(ROOT);
const save = (cfg) => { saveAppConfig(cfg, ROOT); };

// ─── Input primitives ────────────────────────────────────────────────────────

function readKey() {
    return new Promise((resolve) => {
        const stdin = process.stdin;
        stdin.setRawMode?.(true);
        stdin.resume();
        stdin.once('data', (buf) => {
            stdin.setRawMode?.(false);
            stdin.pause();
            resolve(buf.toString('utf8'));
        });
    });
}

async function ask(question, fallback = '') {
    showCursor();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const hint = fallback ? ` ${C.dim}(${fallback})${C.reset}` : '';
    const answer = (await rl.question(`${C.cyan}?${C.reset} ${question}${hint}: `)).trim();
    rl.close();
    return answer || fallback;
}

async function confirm(question, def = true) {
    const answer = (await ask(`${question} [${def ? 'Y/n' : 'y/N'}]`)).toLowerCase();
    if (!answer) return def;
    return answer.startsWith('y');
}

async function pause(message = 'Press Enter to go back') {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    await rl.question(`\n${C.dim}${message}…${C.reset}`);
    rl.close();
}

/**
 * Arrow-key menu. items: [{label, hint?, value}]. Returns the chosen value,
 * or null on Esc/q. Falls back to a numbered prompt when not a TTY.
 */
async function menu(title, items, { intro = '', initial = 0 } = {}) {
    if (!TTY) {
        line(`\n== ${title} ==`);
        if (intro) line(intro);
        items.forEach((it, i) => line(`  ${i + 1}. ${it.label}${it.hint ? ` — ${it.hint}` : ''}`));
        const answer = await ask(`Choose [1-${items.length}, 0 to go back]`);
        const n = Number.parseInt(answer, 10);
        if (!Number.isInteger(n) || n < 1 || n > items.length) return null;
        return items[n - 1].value;
    }

    let index = Math.min(Math.max(initial, 0), items.length - 1);
    hideCursor();
    for (;;) {
        clear();
        header(title);
        if (intro) line(`${C.dim}${intro}${C.reset}`);
        line();
        items.forEach((it, i) => {
            const active = i === index;
            const marker = active ? `${C.cyan}▸${C.reset} ` : '  ';
            const label = active ? `${C.inverse}${C.bold} ${it.label} ${C.reset}` : ` ${it.label} `;
            const hint = it.hint ? `  ${C.dim}${it.hint}${C.reset}` : '';
            line(`${marker}${label}${hint}`);
        });
        line();
        line(`${C.dim}↑/↓ move · Enter select · 1-9 jump · q/Esc back${C.reset}`);

        const key = await readKey();
        if (key === '\x03') quit(0);                       // Ctrl+C
        else if (key === '\x1b[A' || key === 'k') index = (index + items.length - 1) % items.length;
        else if (key === '\x1b[B' || key === 'j') index = (index + 1) % items.length;
        else if (key === '\r' || key === '\n') { showCursor(); return items[index].value; }
        else if (key === 'q' || key === '\x1b') { showCursor(); return null; }
        else if (/^[1-9]$/.test(key) && Number(key) <= items.length) { showCursor(); return items[Number(key) - 1].value; }
    }
}

function quit(code) {
    showCursor();
    line();
    process.exit(code);
}

// ─── Process helpers ─────────────────────────────────────────────────────────

/** Run a command in THIS terminal (stdio inherited), resolving with exit code. */
function runHere(command, args, opts = {}) {
    return new Promise((resolve) => {
        line(`${C.dim}$ ${command} ${args.join(' ')}${C.reset}`);
        const child = spawn(command, args, {
            cwd: ROOT,
            stdio: 'inherit',
            shell: IS_WIN, // npm/npx are .cmd shims on Windows
            ...opts,
        });
        const swallow = () => {}; // let the child own Ctrl+C; TUI survives
        process.on('SIGINT', swallow);
        child.on('exit', (code) => {
            process.removeListener('SIGINT', swallow);
            resolve(code ?? 1);
        });
        child.on('error', (err) => {
            process.removeListener('SIGINT', swallow);
            line(`${C.red}Failed to start ${command}: ${err.message}${C.reset}`);
            resolve(1);
        });
    });
}

function openBrowser(url) {
    try {
        if (IS_WIN) spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
        else if (IS_MAC) spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
        else spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
        return true;
    } catch {
        return false;
    }
}

function openInEditor(file) {
    const editor = process.env.VISUAL || process.env.EDITOR;
    if (editor) return runHere(editor, [file]); // terminal editors need the tty — wait for them
    try {
        if (IS_WIN) spawn('notepad', [file], { detached: true, stdio: 'ignore' }).unref();
        else if (IS_MAC) spawn('open', ['-t', file], { detached: true, stdio: 'ignore' }).unref();
        else spawn('xdg-open', [file], { detached: true, stdio: 'ignore' }).unref();
        line(`${C.green}Opened${C.reset} ${path.relative(ROOT, file)} in your default editor.`);
    } catch (err) {
        line(`${C.red}Could not open an editor (${err.message}). Edit the file manually: ${file}${C.reset}`);
    }
    return Promise.resolve(0);
}

// ─── Screens ─────────────────────────────────────────────────────────────────

async function installScreen() {
    clear();
    header('Install');
    line();

    const [major, minor] = process.versions.node.split('.').map(Number);
    if (major < 18 || (major === 18 && minor < 18)) {
        line(`${C.red}Node ${process.version} is too old — Next.js 15 needs ≥ 18.18 (20+ recommended).${C.reset}`);
        line(`See the ${C.bold}Tutorial${C.reset} screen for how to install Node on ${OS_NAME}.`);
        await pause();
        return;
    }
    line(`${C.green}✓${C.reset} Node ${process.version} is new enough.`);

    line(`\n${C.bold}Step 1/3 — npm install${C.reset} (runs right here in your terminal)\n`);
    const code = await runHere('npm', ['install']);
    if (code !== 0) {
        line(`\n${C.red}npm install failed (exit ${code}). Fix the error above and try again.${C.reset}`);
        await pause();
        return;
    }

    line(`\n${C.bold}Step 2/3 — environment file${C.reset}`);
    const envFile = path.join(ROOT, '.env');
    const template = path.join(ROOT, '.env.template');
    if (fs.existsSync(envFile)) {
        line(`${C.green}✓${C.reset} .env already exists — leaving it untouched.`);
    } else if (fs.existsSync(template)) {
        fs.copyFileSync(template, envFile);
        line(`${C.green}✓${C.reset} Created .env from .env.template.`);
        line(`  ${C.yellow}Fill in DATABASE_URL, JWT_SECRET, and at least one inference key${C.reset}`);
        line(`  ${C.yellow}(GROQ_API_KEY or OPENCODE_ZEN_API_KEY) — “Edit code” → .env opens it.${C.reset}`);
    } else {
        line(`${C.yellow}! No .env.template found — create .env by hand before running the server.${C.reset}`);
    }

    line(`\n${C.bold}Step 3/3 — database setup${C.reset} ${C.dim}(optional, needs DATABASE_URL in .env)${C.reset}`);
    if (await confirm('Run npm run setup:db now?', false)) {
        await runHere('npm', ['run', 'setup:db']);
    } else {
        line(`${C.dim}Skipped — run it later with: npm run setup:db${C.reset}`);
    }

    line(`\n${C.green}${C.bold}Install finished.${C.reset} Pick “Run the dev server” next.`);
    await pause();
}

async function waitForServer(url, timeoutMs = 120_000) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
        try {
            const res = await fetch(url, { redirect: 'manual' });
            if (res.status < 500) return true;
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 700));
    }
    return false;
}

async function runServerScreen(cliPort) {
    clear();
    header('Run the dev server');
    line();

    if (!fs.existsSync(path.join(ROOT, 'node_modules'))) {
        line(`${C.yellow}node_modules is missing — run Install first.${C.reset}`);
        await pause();
        return;
    }

    let port = cliPort;
    if (!port) {
        const answer = await ask('Port to run on', String(config().app.port));
        port = Number.parseInt(answer, 10);
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        line(`${C.red}“${port}” is not a valid port (1-65535).${C.reset}`);
        await pause();
        return;
    }

    const url = `http://localhost:${port}`;
    line(`\nStarting ${C.bold}${config().app.name}${C.reset} on ${C.cyan}${url}${C.reset} — the server runs`);
    line(`right here in your terminal. ${C.bold}Ctrl+C stops it${C.reset} and returns to the menu.`);
    line(`Your browser will open automatically once the server answers.\n`);

    // Fire the readiness watcher in parallel with the (blocking) server.
    waitForServer(url).then((up) => {
        if (up) openBrowser(url);
    });

    await runHere('npm', ['run', 'dev', '--', '-p', String(port)]);
    line(`\n${C.dim}Server stopped.${C.reset}`);
    await pause();
}

const TUTORIALS = {
    Windows: [
        `${C.bold}1. Install Node.js (20 LTS or newer)${C.reset}`,
        `   winget install OpenJS.NodeJS.LTS`,
        `   ${C.dim}(or download the installer from nodejs.org — either works)${C.reset}`,
        `   Restart your terminal afterwards so ${C.cyan}node --version${C.reset} answers.`,
        '',
        `${C.bold}2. Get the code${C.reset}`,
        `   winget install Git.Git   ${C.dim}(if you don't have git)${C.reset}`,
        `   git clone <repo-url> && cd tripplet-sonoma`,
        '',
        `${C.bold}3. Launch this setup${C.reset}`,
        `   Git Bash / WSL:    ${C.cyan}./setup.sh${C.reset}   ${C.dim}(Git Bash comes with Git for Windows)${C.reset}`,
        `   PowerShell / cmd:  ${C.cyan}npm run setup${C.reset}`,
        '',
        `${C.bold}4. Install → fill .env → Run the dev server${C.reset}`,
        `   “Install” runs npm install and creates .env from the template.`,
        `   Open .env via “Edit code” (Notepad) and fill in DATABASE_URL,`,
        `   JWT_SECRET, and one inference key. Then “Run the dev server” —`,
        `   pick a port and your default browser opens on its own.`,
        '',
        `${C.bold}5. Customize${C.reset}`,
        `   App name, tagline, port, and model backends all live in`,
        `   ${C.cyan}src\\config.md${C.reset} — edit them from this TUI, no code required.`,
        '',
        `${C.dim}Troubleshooting: PowerShell can't run .sh files — use Git Bash for`,
        `./setup.sh or run npm run setup. Port already in use → pick another port.${C.reset}`,
    ],
    macOS: [
        `${C.bold}1. Install Node.js (20 LTS or newer)${C.reset}`,
        `   brew install node@20   ${C.dim}(or use nvm: nvm install --lts)${C.reset}`,
        `   No Homebrew? Grab the installer from nodejs.org.`,
        '',
        `${C.bold}2. Get the code${C.reset}`,
        `   git clone <repo-url> && cd tripplet-sonoma`,
        `   ${C.dim}(git ships with Xcode Command Line Tools — macOS offers to install them)${C.reset}`,
        '',
        `${C.bold}3. Launch this setup${C.reset}`,
        `   ${C.cyan}./setup.sh${C.reset}   — no chmod needed; the executable bit is committed to git.`,
        '',
        `${C.bold}4. Install → fill .env → Run the dev server${C.reset}`,
        `   “Install” runs npm install and creates .env from the template.`,
        `   Open .env via “Edit code” (TextEdit or $EDITOR) and fill in`,
        `   DATABASE_URL, JWT_SECRET, and one inference key. Then “Run the`,
        `   dev server” — pick a port; Safari/Chrome opens automatically.`,
        '',
        `${C.bold}5. Customize${C.reset}`,
        `   App name, tagline, port, and model backends all live in`,
        `   ${C.cyan}src/config.md${C.reset} — edit them from this TUI, no code required.`,
        '',
        `${C.dim}Troubleshooting: “command not found: node” → restart the terminal or`,
        `check brew’s PATH note. Port already in use → pick another port.${C.reset}`,
    ],
    Linux: [
        `${C.bold}1. Install Node.js (20 LTS or newer)${C.reset}`,
        `   The distro package is often too old — prefer nvm:`,
        `   curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash`,
        `   nvm install --lts`,
        `   ${C.dim}(or: apt/dnf install nodejs — check node --version ≥ 20)${C.reset}`,
        '',
        `${C.bold}2. Get the code${C.reset}`,
        `   sudo apt install git   ${C.dim}(or your distro's equivalent)${C.reset}`,
        `   git clone <repo-url> && cd tripplet-sonoma`,
        '',
        `${C.bold}3. Launch this setup${C.reset}`,
        `   ${C.cyan}./setup.sh${C.reset}   — no chmod +x needed; the executable bit is committed to git.`,
        '',
        `${C.bold}4. Install → fill .env → Run the dev server${C.reset}`,
        `   “Install” runs npm install and creates .env from the template.`,
        `   Open .env via “Edit code” ($EDITOR, nano, or xdg-open) and fill in`,
        `   DATABASE_URL, JWT_SECRET, and one inference key. Then “Run the`,
        `   dev server” — pick a port; xdg-open launches your browser.`,
        '',
        `${C.bold}5. Customize${C.reset}`,
        `   App name, tagline, port, and model backends all live in`,
        `   ${C.cyan}src/config.md${C.reset} — edit them from this TUI, no code required.`,
        '',
        `${C.dim}Troubleshooting: EACCES on npm install → don't sudo; use nvm. Headless`,
        `box (no browser)? The server still runs — open the URL from another machine.${C.reset}`,
    ],
};

async function tutorialScreen() {
    for (;;) {
        const which = await menu('Tutorial', [
            { label: `Windows${OS_NAME === 'Windows' ? '  (your OS)' : ''}`, value: 'Windows' },
            { label: `macOS${OS_NAME === 'macOS' ? '  (your OS)' : ''}`, value: 'macOS' },
            { label: `Linux${OS_NAME === 'Linux' ? '  (your OS)' : ''}`, value: 'Linux' },
        ], {
            intro: 'Step-by-step from a blank machine to the app running in your browser.',
            initial: ['Windows', 'macOS', 'Linux'].indexOf(OS_NAME),
        });
        if (!which) return;
        clear();
        header(`Tutorial — ${which}`);
        line();
        TUTORIALS[which].forEach((l) => line(l));
        await pause();
    }
}

async function customizeScreen() {
    for (;;) {
        const cfg = config();
        const choice = await menu('Customize the app', [
            { label: 'App name', hint: cfg.app.name, value: 'name' },
            { label: 'Tagline', hint: cfg.app.tagline, value: 'tagline' },
            { label: 'Description', hint: cfg.app.description.slice(0, 44) + '…', value: 'description' },
            { label: 'Default port', hint: String(cfg.app.port), value: 'port' },
        ], {
            intro: `Everything here is stored in ${path.relative(ROOT, configPath(ROOT))} — no code edits. Restart the dev server to apply.`,
        });
        if (!choice) return;

        const current = String(cfg.app[choice]);
        const answer = await ask(`New ${choice === 'name' ? 'app name' : choice}`, current);
        if (choice === 'port') {
            const port = Number.parseInt(answer, 10);
            if (!Number.isInteger(port) || port < 1 || port > 65535) {
                line(`${C.red}“${answer}” is not a valid port — keeping ${current}.${C.reset}`);
                await pause('Press Enter to continue');
                continue;
            }
            cfg.app.port = port;
        } else {
            cfg.app[choice] = answer;
        }
        save(cfg);
        line(`${C.green}✓ Saved to src/config.md.${C.reset} Restart the dev server to see it live.`);
        await pause('Press Enter to continue');
    }
}

const MODEL_FIELDS = [
    ['label', 'Display name in the model picker'],
    ['description', 'One-liner under the name'],
    ['endpoint', 'OpenAI-compatible /chat/completions URL'],
    ['model', 'Upstream model name sent to the endpoint'],
    ['keyEnv', 'Env var that holds the API key (goes in .env)'],
];

async function editModelEntry(id) {
    for (;;) {
        const cfg = config();
        const entry = cfg.models.find((m) => m.id === id);
        if (!entry) return;
        const items = MODEL_FIELDS.map(([field, hint]) => ({
            label: `${field === 'keyEnv' ? 'api key env' : field}: ${entry[field] || C.dim + '(unset)' + C.reset}`,
            hint,
            value: field,
        }));
        items.push(
            { label: `show in picker: ${entry.showInPicker ? 'yes' : 'no'}`, hint: 'Adds new ids to the model dropdown', value: 'togglePicker' },
            { label: `enabled: ${entry.enabled === false ? 'no' : 'yes'}`, hint: 'Disabled entries are ignored by routing', value: 'toggleEnabled' },
            { label: `${C.red}Delete this entry${C.reset}`, value: 'delete' },
        );
        const choice = await menu(`Model backend — ${id}`, items);
        if (!choice) return;

        if (choice === 'delete') {
            if (await confirm(`Really delete “${id}”?`, false)) {
                cfg.models = cfg.models.filter((m) => m.id !== id);
                save(cfg);
                line(`${C.green}✓ Deleted.${C.reset}`);
                await pause('Press Enter to continue');
                return;
            }
            continue;
        }
        if (choice === 'togglePicker') { entry.showInPicker = !entry.showInPicker; save(cfg); continue; }
        if (choice === 'toggleEnabled') { entry.enabled = entry.enabled === false; save(cfg); continue; }

        const answer = await ask(`New value for ${choice === 'keyEnv' ? 'api key env' : choice}`, entry[choice] || '');
        if (choice === 'endpoint' && answer && !/^https?:\/\//i.test(answer)) {
            line(`${C.red}Endpoint must start with http:// or https:// — not saved.${C.reset}`);
            await pause('Press Enter to continue');
            continue;
        }
        if (choice === 'keyEnv' && answer && !/^[A-Z][A-Z0-9_]*$/.test(answer)) {
            line(`${C.red}Env var names look like MY_MODEL_API_KEY (A-Z, 0-9, _) — not saved.${C.reset}`);
            await pause('Press Enter to continue');
            continue;
        }
        entry[choice] = answer;
        save(cfg);
    }
}

async function addModelEntry() {
    clear();
    header('Add a model backend');
    line();
    line(`Point any model id at an OpenAI-compatible endpoint. Use a ${C.bold}built-in id${C.reset}`);
    line(`(astro-5, tura-3, majuli-3, suzhou-3) to reroute that persona, or a ${C.bold}new id${C.reset}`);
    line(`to add a brand-new model to the picker.\n`);

    const id = await ask('Model id (no spaces, e.g. my-gpt)');
    if (!id || /\s/.test(id)) {
        line(`${C.red}A non-empty id without spaces is required.${C.reset}`);
        await pause();
        return;
    }
    const cfg = config();
    if (cfg.models.some((m) => m.id === id)) {
        line(`${C.yellow}“${id}” already exists — edit it from the list instead.${C.reset}`);
        await pause();
        return;
    }
    const label = await ask('Display name', id);
    const description = await ask('Short description', 'Custom model');
    const endpoint = await ask('Endpoint URL', 'http://localhost:11434/v1/chat/completions');
    if (!/^https?:\/\//i.test(endpoint)) {
        line(`${C.red}Endpoint must start with http:// or https:// — aborted.${C.reset}`);
        await pause();
        return;
    }
    const model = await ask('Upstream model name', id);
    const suggestedEnv = `${id.toUpperCase().replace(/[^A-Z0-9]+/g, '_')}_API_KEY`;
    const keyEnv = await ask('API key env var (blank if the endpoint needs no key)', suggestedEnv);
    const showInPicker = await confirm('Show it in the model picker?', true);

    cfg.models.push({ id, label, description, endpoint, model, keyEnv: keyEnv || undefined, showInPicker, enabled: true });
    save(cfg);

    line(`\n${C.green}✓ Added “${id}” to src/config.md.${C.reset}`);
    if (keyEnv) line(`${C.yellow}Put the key in .env:${C.reset}  ${keyEnv}=sk-…`);
    line(`Restart the dev server to pick it up.`);
    await pause();
}

async function modelsScreen() {
    for (;;) {
        const cfg = config();
        const items = cfg.models.map((m) => ({
            label: m.id,
            hint: `${m.endpoint || 'no endpoint'} · ${m.model || '?'} · ${m.enabled === false ? 'disabled' : 'enabled'}${m.showInPicker ? ' · in picker' : ''}`,
            value: m.id,
        }));
        items.push({ label: `${C.green}+ Add a model backend${C.reset}`, value: '\0add' });
        const choice = await menu('Model backends', items, {
            intro: 'Entries live in src/config.md and route chat traffic server-side.',
        });
        if (!choice) return;
        if (choice === '\0add') await addModelEntry();
        else await editModelEntry(choice);
    }
}

async function editCodeScreen() {
    const files = [
        ['src/config.md', 'App name, tagline, port, model backends (no-code config)'],
        ['.env', 'Secrets: database URL, JWT secret, inference API keys'],
        ['src/lib/ai/models.ts', 'Model picker entries and persona ids'],
        ['src/lib/ai/llm.ts', 'Server-side backend routing (endpoints per persona)'],
        ['src/lib/ai/model-prompts.ts', 'Per-persona system prompts'],
        ['src/app/globals.css', 'Global styles and theme'],
        ['src/app/page.tsx', 'Landing page'],
        ['README.md', 'Project documentation'],
    ];
    for (;;) {
        const items = files
            .filter(([rel]) => fs.existsSync(path.join(ROOT, rel)))
            .map(([rel, hint]) => ({ label: rel, hint, value: rel }));
        items.push({ label: 'Open the project folder', hint: 'File manager', value: '\0folder' });
        const choice = await menu('Edit code', items, {
            intro: 'Opens in $VISUAL/$EDITOR if set, otherwise your OS default editor.',
        });
        if (!choice) return;
        if (choice === '\0folder') {
            if (IS_WIN) spawn('explorer', [ROOT], { detached: true, stdio: 'ignore' }).unref();
            else if (IS_MAC) spawn('open', [ROOT], { detached: true, stdio: 'ignore' }).unref();
            else spawn('xdg-open', [ROOT], { detached: true, stdio: 'ignore' }).unref();
        } else {
            await openInEditor(path.join(ROOT, choice));
            await pause('Press Enter when you are done editing');
        }
    }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function mainMenu() {
    for (;;) {
        const cfg = config();
        const choice = await menu('Main menu', [
            { label: 'Install', hint: 'npm install + .env + optional db setup', value: 'install' },
            { label: 'Run the dev server', hint: `port ${cfg.app.port}, opens your browser`, value: 'run' },
            { label: 'Tutorial', hint: `getting-started guide per OS (you: ${OS_NAME})`, value: 'tutorial' },
            { label: 'Customize the app', hint: 'name, tagline, description, port', value: 'customize' },
            { label: 'Model backends', hint: 'add or reroute model endpoints', value: 'models' },
            { label: 'Edit code', hint: 'open key files in your editor', value: 'edit' },
            { label: 'Exit', value: 'exit' },
        ], {
            intro: `Welcome! Everything runs in this terminal — nothing is hidden.`,
        });
        if (!choice || choice === 'exit') quit(0);
        if (choice === 'install') await installScreen();
        else if (choice === 'run') await runServerScreen();
        else if (choice === 'tutorial') await tutorialScreen();
        else if (choice === 'customize') await customizeScreen();
        else if (choice === 'models') await modelsScreen();
        else if (choice === 'edit') await editCodeScreen();
    }
}

const argv = process.argv.slice(2);
const command = argv[0];

if (command === '--help' || command === '-h') {
    line('Usage: ./setup.sh [command]   (Git Bash/WSL on Windows, or: npm run setup)');
    line('  (no command)   interactive TUI');
    line('  install        install dependencies + create .env');
    line('  run [--port N] run the dev server and open the browser');
    line('  config         print parsed src/config.md as JSON');
    process.exit(0);
} else if (command === 'config') {
    line(JSON.stringify(config(), null, 2));
    process.exit(0);
} else if (command === 'install') {
    await installScreen();
    process.exit(0);
} else if (command === 'run') {
    const portFlag = argv.indexOf('--port');
    const port = portFlag !== -1 ? Number.parseInt(argv[portFlag + 1], 10) : config().app.port;
    await runServerScreen(port);
    process.exit(0);
} else if (command) {
    line(`Unknown command “${command}” — try --help.`);
    process.exit(1);
} else {
    process.on('exit', showCursor);
    await mainMenu();
}
