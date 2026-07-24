/**
 * main.js — boot.
 *
 * Parses argv, resolves config, builds the session, then hands off to either
 * the TUI or headless mode. Everything that can fail loudly (bad flags, a cwd
 * that does not exist, no TTY) fails here, before the alternate screen is
 * entered — so an error is always readable.
 */

import process from 'node:process';
import fs from 'node:fs';
import path from 'node:path';

import { parseArgs, helpText, versionText } from './args.js';
import { loadConfig, applyFlags, ensureDirs } from '../core/config.js';
import { Session } from '../core/session.js';
import { MODELS, getModel, describeModel, DEFAULT_MODEL_ID } from '../core/models.js';
import { getEffort, EFFORTS, DEFAULT_EFFORT } from '../core/effort.js';
import { createTheme } from '../ui/theme.js';
import { toAnsi, run, setDepth, DEPTH } from '../ui/text.js';
import { bannerLines } from '../ui/welcome.js';
import { authCommand, AUTH_COMMANDS } from './auth-cli.js';
import { loadAuth, isSignedIn } from '../auth/store.js';

export const VERSION = readVersion();

function readVersion() {
  try {
    const here = path.dirname(new URL(import.meta.url).pathname);
    const pkg = JSON.parse(fs.readFileSync(path.join(here, '..', '..', 'package.json'), 'utf8'));
    return pkg.version || '0.1.0';
  } catch {
    return '0.1.0';
  }
}

const write = (s) => process.stdout.write(s);
const writeErr = (s) => process.stderr.write(s);

export async function main(argv = process.argv.slice(2)) {
  const { flags, positionals, errors, warnings } = parseArgs(argv);

  if (flags.noColor) setDepth(DEPTH.NONE);
  else if (flags.color) setDepth(DEPTH.TRUECOLOR);

  if (errors.length) {
    for (const e of errors) writeErr(`astrocode: ${e}\n`);
    writeErr(`\nRun 'astrocode --help' for usage.\n`);
    return 2;
  }

  if (flags.help) { write(`${helpText()}\n`); return 0; }
  if (flags.version) { write(`${versionText(VERSION)}\n`); return 0; }

  // ── working directory ────────────────────────────────────────────────────
  let cwd = process.cwd();
  if (flags.cwd) {
    const target = path.resolve(cwd, flags.cwd);
    if (!fs.existsSync(target) || !fs.statSync(target).isDirectory()) {
      writeErr(`astrocode: --cwd ${flags.cwd} is not a directory\n`);
      return 2;
    }
    cwd = target;
    try {
      process.chdir(cwd);
    } catch (err) {
      writeErr(`astrocode: cannot enter ${cwd}: ${err.message}\n`);
      return 2;
    }
  }

  // ── config ───────────────────────────────────────────────────────────────
  const loaded = loadConfig({ cwd, configPath: flags.config });
  const config = applyFlags(loaded.config, flags);
  const theme = createTheme(config.theme, { rainbow: !!config.rainbow });

  if (flags.listModels) {
    write(renderModelTable(theme));
    return 0;
  }

  // ── account subcommands ──────────────────────────────────────────────────
  // Only when the word stands alone (or is followed by a URL), so a prompt
  // like `astrocode "login is broken"` is still a prompt.
  const head = String(positionals[0] || '').toLowerCase();
  const rest = positionals.slice(1);
  const isAuthWord = AUTH_COMMANDS.has(head);
  const looksLikeSubcommand = isAuthWord &&
    (rest.length === 0 || rest.every((a) => /^(https?:\/\/|--?[a-z])/i.test(a)));
  if (looksLikeSubcommand) {
    const canonical = head === 'signin' ? 'login' : head === 'signout' ? 'logout' : head;
    return authCommand(canonical, { theme, config, args: rest });
  }

  for (const w of [...loaded.warnings, ...warnings]) {
    writeErr(`${toAnsi([run('warning: ', { fg: theme.warn }), run(w, { fg: theme.dim })])}\n`);
  }

  ensureDirs();

  // ── session ──────────────────────────────────────────────────────────────
  let session = null;
  if (flags.resume) {
    session = Session.load(flags.resume);
    if (!session) { writeErr(`astrocode: no session ${flags.resume}\n`); return 2; }
  } else if (flags.continue) {
    const latest = Session.latest(cwd);
    session = latest ? Session.load(latest.id) : null;
    if (!session) writeErr(`${toAnsi([run('No previous session here — starting a new one.\n', { fg: theme.dim })])}`);
  }

  if (!session) {
    session = new Session({
      cwd,
      model: config.model || DEFAULT_MODEL_ID,
      effort: config.effort || DEFAULT_EFFORT,
      seed: flags.seed,
    });
  } else {
    session.cwd = cwd;
    if (flags.model) session.setModel(getModel(flags.model));
    if (flags.effort) session.setEffort(getEffort(flags.effort));
    if (flags.seed !== undefined) session.seed = flags.seed;
  }

  if (!session.model) {
    writeErr(`astrocode: unknown model "${config.model}". Try --list-models.\n`);
    return 2;
  }
  if (!session.effort) session.setEffort(getEffort(DEFAULT_EFFORT));

  // ── headless ─────────────────────────────────────────────────────────────
  const inlinePrompt = flags.prompt || (positionals.length ? positionals.join(' ') : null);
  if (flags.prompt || (inlinePrompt && !process.stdin.isTTY)) {
    if (!isSignedIn(loadAuth())) {
      writeErr(`${toAnsi([
        run('astrocode: not signed in. Run ', { fg: theme.error }),
        run('astrocode login', { fg: theme.primary, bold: true }),
        run(' first.', { fg: theme.error }),
      ])}\n`);
      return 3;
    }
    const { runHeadless } = await import('./headless.js');
    return runHeadless({
      session, config, theme,
      prompt: inlinePrompt,
      json: !!flags.json,
      quiet: !!flags.quiet,
      maxTurns: flags.maxTurns || 1,
    });
  }

  // ── interactive ──────────────────────────────────────────────────────────
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    writeErr('astrocode: no interactive terminal. Use --prompt "…" for headless runs.\n');
    return 2;
  }

  const { App } = await import('../app.js');
  const app = new App({ session, config, theme, version: VERSION });

  const shutdown = () => { try { app.stop(0); } catch { /* already down */ } };
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);
  process.on('uncaughtException', (err) => {
    try { app.stop(1); } catch { /* already down */ }
    writeErr(`\nastrocode crashed: ${err?.stack || err}\n`);
    process.exit(1);
  });

  // A prompt on the command line pre-fills the editor rather than auto-sending,
  // so you get a chance to edit it.
  if (inlinePrompt) app.editor.setValue(inlinePrompt);

  return app.start();
}

function renderModelTable(theme) {
  const out = [];
  for (const l of bannerLines(theme, VERSION)) out.push(toAnsi(l));
  out.push('');
  const nameW = Math.max(...MODELS.map((m) => m.name.length)) + 2;
  const idW = Math.max(...MODELS.map((m) => m.id.length)) + 2;
  out.push(toAnsi([
    run('  MODEL'.padEnd(nameW + 2), { fg: theme.dim, bold: true }),
    run('ID'.padEnd(idW), { fg: theme.dim, bold: true }),
    run('CONTEXT   ', { fg: theme.dim, bold: true }),
    run('PRICE (in/out)  ', { fg: theme.dim, bold: true }),
    run('DEFAULT', { fg: theme.dim, bold: true }),
  ]));
  for (const m of MODELS) {
    const ctx = m.context >= 1e6 ? `${m.context / 1e6}M` : `${Math.round(m.context / 1000)}K`;
    out.push(toAnsi([
      run('  '),
      run(m.name.padEnd(nameW), { fg: m.accent, bold: true }),
      run(m.id.padEnd(idW), { fg: theme.dim }),
      run(ctx.padEnd(10), { fg: theme.text }),
      run(`$${m.pricing.input}/$${m.pricing.output}`.padEnd(16), { fg: theme.text }),
      run(m.defaultEffort, { fg: theme.accent }),
    ]));
    out.push(toAnsi([run(`  ${' '.repeat(0)}`), run(m.tagline, { fg: theme.faint })]));
  }
  out.push('');
  out.push(toAnsi([
    run('  Effort levels: ', { fg: theme.dim }),
    ...EFFORTS.flatMap((e, i) => [
      ...(i ? [run(' · ', { fg: theme.faint })] : []),
      run(e.glyph, { fg: e.color }),
      run(` ${e.label}`, { fg: theme.text }),
    ]),
  ]));
  out.push('');
  out.push(toAnsi([run('  All four models run locally simulated — no network calls.', { fg: theme.faint })]));
  out.push('');
  return `${out.join('\n')}\n`;
}

export { describeModel };
