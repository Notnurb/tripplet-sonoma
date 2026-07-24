#!/usr/bin/env node
/**
 * install.js — put `astrocode` on your PATH, on any operating system.
 *
 * Node is already a hard prerequisite for running Astrocode, so the installer
 * is written in Node too: one implementation, no shell dialect differences, no
 * separate Windows logic to drift out of sync. `install.sh` and `install.ps1`
 * are five-line bootstraps that find Node and hand over to this file.
 *
 * What it does: writes small launcher shims into a bin directory that is
 * already on your PATH (or tells you exactly how to add one). It does not need
 * root, does not touch system directories, and does not install anything into
 * node_modules — there is nothing to install.
 *
 *   node scripts/install.js               # install
 *   node scripts/install.js --uninstall   # remove
 *   node scripts/install.js --prefix DIR  # choose the bin directory
 *   node scripts/install.js --dry-run     # show what it would do
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const MIN_NODE = [18, 17, 0];
const NAMES = ['astrocode', 'astro'];

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = path.join(ROOT, 'bin', 'astrocode.js');
const IS_WINDOWS = process.platform === 'win32';

// ── output ──────────────────────────────────────────────────────────────────

const useColour = process.stdout.isTTY && !process.env.NO_COLOR;
const paint = (code, s) => (useColour ? `\x1b[${code}m${s}\x1b[0m` : s);
const bold = (s) => paint('1', s);
const dim = (s) => paint('2', s);
const blue = (s) => paint('38;5;75', s);
const green = (s) => paint('38;5;78', s);
const yellow = (s) => paint('38;5;221', s);
const red = (s) => paint('38;5;210', s);

const say = (s = '') => process.stdout.write(`${s}\n`);
const step = (s) => say(`${blue('›')} ${s}`);
const ok = (s) => say(`${green('✓')} ${s}`);
const warn = (s) => say(`${yellow('▲')} ${s}`);
const err = (s) => process.stderr.write(`${red('✕')} ${s}\n`);

// ── arguments ───────────────────────────────────────────────────────────────

function parse(argv) {
  const opts = { uninstall: false, dryRun: false, force: false, prefix: null, quiet: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--uninstall' || a === '-u') opts.uninstall = true;
    else if (a === '--dry-run' || a === '-n') opts.dryRun = true;
    else if (a === '--force' || a === '-f') opts.force = true;
    else if (a === '--quiet' || a === '-q') opts.quiet = true;
    else if (a === '--prefix' || a === '--bin-dir') opts.prefix = argv[++i];
    else if (a.startsWith('--prefix=')) opts.prefix = a.slice(9);
    else if (a.startsWith('--bin-dir=')) opts.prefix = a.slice(10);
    else if (a === '--help' || a === '-h') opts.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  if (opts.prefix === undefined || opts.prefix === '') {
    throw new Error('--prefix needs a directory');
  }
  return opts;
}

const HELP = `${bold('Astrocode installer')}

  ${dim('node')} scripts/install.js ${dim('[options]')}

  --prefix <dir>    Install the launchers into <dir>
  --uninstall, -u   Remove previously installed launchers
  --dry-run, -n     Print what would happen, change nothing
  --force, -f       Overwrite launchers that are not ours
  --quiet, -q       Only report problems
  --help, -h        This text

  The bin directory is chosen in this order:
    1. --prefix
    2. $ASTROCODE_BIN_DIR
    3. a directory already on your PATH that you can write to
    4. ${IS_WINDOWS ? '%LOCALAPPDATA%\\Astrocode\\bin' : '~/.local/bin'}
`;

// ── environment checks ──────────────────────────────────────────────────────

function checkNode() {
  const parts = process.versions.node.split('.').map(Number);
  for (let i = 0; i < MIN_NODE.length; i++) {
    if ((parts[i] || 0) > MIN_NODE[i]) return;
    if ((parts[i] || 0) < MIN_NODE[i]) {
      throw new Error(
        `Astrocode needs Node ${MIN_NODE.join('.')} or newer — this is ${process.versions.node}.\n` +
        '  Install a current Node from https://nodejs.org and run this again.',
      );
    }
  }
}

function checkEntry() {
  if (!fs.existsSync(ENTRY)) {
    throw new Error(
      `could not find ${ENTRY}\n` +
      '  Run this script from inside a complete Astrocode checkout.',
    );
  }
}

const canWrite = (dir) => {
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return fs.statSync(dir).isDirectory();
  } catch {
    return false;
  }
};

/** PATH entries, normalised for comparison. */
function pathEntries() {
  const raw = process.env.PATH || '';
  return raw.split(path.delimiter).filter(Boolean).map(normalise);
}

function normalise(p) {
  let out = p.trim().replace(/^"|"$/g, '');
  if (out.startsWith('~')) out = path.join(os.homedir(), out.slice(1));
  try {
    out = fs.realpathSync(out);
  } catch {
    out = path.resolve(out);   // a PATH entry that does not exist yet is fine
  }
  return IS_WINDOWS ? out.toLowerCase() : out;
}

const onPath = (dir) => pathEntries().includes(normalise(dir));

/** Where npm puts global binaries, if npm is available at all. */
function npmGlobalBin() {
  try {
    const prefix = execFileSync(IS_WINDOWS ? 'npm.cmd' : 'npm', ['prefix', '-g'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 10_000,
    }).trim();
    if (!prefix) return null;
    // npm drops binaries in the prefix itself on Windows, prefix/bin elsewhere.
    return IS_WINDOWS ? prefix : path.join(prefix, 'bin');
  } catch {
    return null;   // npm missing or slow is not fatal; we have a fallback
  }
}

const defaultBinDir = () => (IS_WINDOWS
  ? path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'Astrocode', 'bin')
  : path.join(os.homedir(), '.local', 'bin'));

/**
 * Pick where the launchers go. Preferring a directory that is already on PATH
 * means the common case needs no shell configuration at all.
 */
function resolveBinDir(opts) {
  if (opts.prefix) return { dir: path.resolve(opts.prefix), reason: '--prefix' };
  if (process.env.ASTROCODE_BIN_DIR) {
    return { dir: path.resolve(process.env.ASTROCODE_BIN_DIR), reason: '$ASTROCODE_BIN_DIR' };
  }

  const candidates = [];
  const home = os.homedir();
  if (!IS_WINDOWS) {
    candidates.push({ dir: path.join(home, '.local', 'bin'), reason: 'already on your PATH' });
    candidates.push({ dir: path.join(home, 'bin'), reason: 'already on your PATH' });
  }
  const npmBin = npmGlobalBin();
  if (npmBin) candidates.push({ dir: npmBin, reason: 'npm global bin, already on your PATH' });

  for (const c of candidates) {
    if (onPath(c.dir) && canWrite(c.dir)) return c;
  }
  // Nothing writable on PATH — fall back and tell the user to add it.
  return { dir: defaultBinDir(), reason: 'default location' };
}

// ── launcher shims ──────────────────────────────────────────────────────────

const MARKER = 'astrocode-launcher-v1';

/**
 * Prefer whatever `node` is on PATH at run time so version managers keep
 * working, but fall back to the interpreter that ran the installer.
 */
function shimPosix(nodePath, entry) {
  return `#!/bin/sh
# ${MARKER} — generated by Astrocode's installer. Safe to delete.
ASTROCODE_ENTRY='${entry.replace(/'/g, `'\\''`)}'
if [ ! -f "$ASTROCODE_ENTRY" ]; then
  echo "astrocode: cannot find $ASTROCODE_ENTRY" >&2
  echo "astrocode: the checkout moved or was deleted — re-run its installer." >&2
  exit 127
fi
if command -v node >/dev/null 2>&1; then
  exec node "$ASTROCODE_ENTRY" "$@"
fi
exec '${nodePath.replace(/'/g, `'\\''`)}' "$ASTROCODE_ENTRY" "$@"
`;
}

/**
 * Batch files are read in the console's OEM codepage, so this one stays pure
 * ASCII. A literal `%` in a path has to be doubled to survive expansion.
 */
function shimCmd(nodePath, entry) {
  const bat = (s) => String(s).replace(/%/g, '%%');
  return `@ECHO OFF\r
REM ${MARKER} - generated by Astrocode's installer. Safe to delete.\r
SETLOCAL\r
SET "ASTROCODE_ENTRY=${bat(entry)}"\r
IF NOT EXIST "%ASTROCODE_ENTRY%" (\r
  ECHO astrocode: cannot find "%ASTROCODE_ENTRY%" 1>&2\r
  ECHO astrocode: the checkout moved or was deleted - re-run its installer. 1>&2\r
  EXIT /B 127\r
)\r
WHERE node >NUL 2>NUL\r
IF %ERRORLEVEL% EQU 0 (\r
  node "%ASTROCODE_ENTRY%" %*\r
) ELSE (\r
  "${bat(nodePath)}" "%ASTROCODE_ENTRY%" %*\r
)\r
EXIT /B %ERRORLEVEL%\r
`;
}

function shimPwsh(nodePath, entry) {
  const q = (s) => s.replace(/'/g, "''");
  return `#!/usr/bin/env pwsh
# ${MARKER} — generated by Astrocode's installer. Safe to delete.
$entry = '${q(entry)}'
if (-not (Test-Path -LiteralPath $entry)) {
  Write-Error "astrocode: cannot find $entry - the checkout moved or was deleted."
  exit 127
}
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) { & $node.Source $entry @args } else { & '${q(nodePath)}' $entry @args }
exit $LASTEXITCODE
`;
}

/** Every file this installer owns, for a given bin directory. */
function plannedFiles(binDir) {
  const nodePath = process.execPath;
  const files = [];
  for (const name of NAMES) {
    if (IS_WINDOWS) {
      files.push({ file: path.join(binDir, `${name}.cmd`), body: shimCmd(nodePath, ENTRY), exec: false });
      files.push({ file: path.join(binDir, `${name}.ps1`), body: shimPwsh(nodePath, ENTRY), exec: false });
    } else {
      files.push({ file: path.join(binDir, name), body: shimPosix(nodePath, ENTRY), exec: true });
    }
  }
  return files;
}

const isOurs = (file) => {
  try {
    return fs.readFileSync(file, 'utf8').includes(MARKER);
  } catch {
    return false;
  }
};

// ── PATH guidance ───────────────────────────────────────────────────────────

function pathAdvice(binDir) {
  const lines = [];
  if (IS_WINDOWS) {
    lines.push(`  ${bold('PowerShell')} ${dim('(this session)')}`);
    lines.push(`    $env:Path = "${binDir};$env:Path"`);
    lines.push('');
    lines.push(`  ${bold('Permanently')}`);
    lines.push(`    [Environment]::SetEnvironmentVariable('Path', "${binDir};" + [Environment]::GetEnvironmentVariable('Path','User'), 'User')`);
    lines.push('');
    lines.push(`  ${dim('or: setx PATH "%PATH%;' + binDir + '"')}`);
    return lines;
  }

  const shell = path.basename(process.env.SHELL || 'sh');
  const home = os.homedir();
  const pretty = binDir.startsWith(home) ? `$HOME${binDir.slice(home.length)}` : binDir;

  if (shell === 'fish') {
    lines.push(`  ${bold('fish')}`);
    lines.push(`    fish_add_path ${pretty}`);
  } else {
    const rc = shell === 'zsh'
      ? '~/.zshrc'
      : shell === 'bash'
        ? (process.platform === 'darwin' ? '~/.bash_profile' : '~/.bashrc')
        : '~/.profile';
    lines.push(`  ${bold(shell)} ${dim(`(${rc})`)}`);
    lines.push(`    echo 'export PATH="${pretty}:$PATH"' >> ${rc}`);
    lines.push(`    ${dim(`then: source ${rc}`)}`);
  }
  return lines;
}

// ── install / uninstall ─────────────────────────────────────────────────────

function install(opts) {
  checkNode();
  checkEntry();

  const { dir: binDir, reason } = resolveBinDir(opts);
  const files = plannedFiles(binDir);

  if (!opts.quiet) {
    say();
    say(`  ${bold(blue('Astrocode'))} ${dim('installer')}`);
    say();
    step(`Source    ${dim(ROOT)}`);
    step(`Node      ${dim(`v${process.versions.node} (${process.platform}-${process.arch})`)}`);
    step(`Target    ${dim(`${binDir}  ${dim(`— ${reason}`)}`)}`);
    say();
  }

  if (opts.dryRun) {
    for (const f of files) say(`  would write ${f.file}`);
    say();
    say(dim('  --dry-run: nothing was changed.'));
    return 0;
  }

  try {
    fs.mkdirSync(binDir, { recursive: true });
  } catch (e) {
    throw new Error(`cannot create ${binDir}: ${e.message}\n  Try --prefix with a directory you can write to.`);
  }
  if (!canWrite(binDir)) {
    throw new Error(`${binDir} is not writable.\n  Try --prefix with a directory you own, e.g. --prefix "${defaultBinDir()}".`);
  }

  // Refuse to clobber a stranger's binary of the same name.
  for (const f of files) {
    if (fs.existsSync(f.file) && !isOurs(f.file) && !opts.force) {
      throw new Error(
        `${f.file} already exists and was not created by this installer.\n` +
        '  Re-run with --force to replace it, or use --prefix to install elsewhere.',
      );
    }
  }

  for (const f of files) {
    fs.writeFileSync(f.file, f.body, { mode: f.exec ? 0o755 : 0o644 });
    if (f.exec) {
      try {
        fs.chmodSync(f.file, 0o755);
      } catch {
        // Some filesystems (a mounted share, WSL interop) ignore chmod; the
        // shim is still usable via `sh <file>` and usually still executable.
      }
    }
  }

  const verified = verify(binDir);

  if (!opts.quiet) {
    for (const f of files) ok(`installed ${dim(f.file)}`);
    say();
    if (verified.ok) {
      ok(`${bold('astrocode')} is ready — ${dim(verified.version)}`);
    } else {
      warn(`the launcher was written but did not run cleanly: ${verified.error}`);
    }
    say();

    if (!onPath(binDir)) {
      warn(`${binDir} is not on your PATH yet.`);
      say();
      for (const l of pathAdvice(binDir)) say(l);
      say();
      say(dim('  Until then, run it directly:'));
      say(`    ${path.join(binDir, NAMES[0])}`);
    } else {
      say(`  Start it with ${bold('astrocode')} ${dim('(or')} ${bold('astro')}${dim(')')}`);
      say(`  Remove it with ${dim('node scripts/install.js --uninstall')}`);
    }
    say();
  }
  return verified.ok ? 0 : 1;
}

/** Run the freshly written launcher and read back its version. */
function verify(binDir) {
  const launcher = path.join(binDir, IS_WINDOWS ? `${NAMES[0]}.cmd` : NAMES[0]);
  try {
    const out = execFileSync(launcher, ['--version'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 30_000,
      shell: IS_WINDOWS,
    }).trim();
    return { ok: /astrocode/i.test(out), version: out.split('\n')[0] };
  } catch (e) {
    return { ok: false, error: (e.stderr || e.message || '').toString().trim().split('\n')[0] };
  }
}

function uninstall(opts) {
  const dirs = new Set();
  if (opts.prefix) dirs.add(path.resolve(opts.prefix));
  else {
    dirs.add(resolveBinDir(opts).dir);
    dirs.add(defaultBinDir());
    for (const d of pathEntries()) dirs.add(d);
  }

  const removed = [];
  const skipped = [];
  for (const dir of dirs) {
    for (const f of plannedFiles(dir)) {
      if (!fs.existsSync(f.file)) continue;
      if (!isOurs(f.file) && !opts.force) { skipped.push(f.file); continue; }
      if (opts.dryRun) { removed.push(f.file); continue; }
      try {
        fs.rmSync(f.file);
        removed.push(f.file);
      } catch (e) {
        skipped.push(`${f.file} (${e.message})`);
      }
    }
  }

  say();
  if (removed.length) for (const f of removed) ok(`${opts.dryRun ? 'would remove' : 'removed'} ${dim(f)}`);
  else say(dim('  Nothing to remove.'));
  for (const f of skipped) warn(`left ${f} alone — not created by this installer`);
  say();
  return 0;
}

// ── entry ───────────────────────────────────────────────────────────────────

function main(argv) {
  let opts;
  try {
    opts = parse(argv);
  } catch (e) {
    err(e.message);
    say(HELP);
    return 2;
  }
  if (opts.help) { say(HELP); return 0; }

  try {
    return opts.uninstall ? uninstall(opts) : install(opts);
  } catch (e) {
    say();
    err(e.message);
    say();
    return 1;
  }
}

/**
 * Compare two paths for identity. Real paths matter here: ESM resolves symlinks
 * in `import.meta.url` but `process.argv[1]` keeps whatever the user typed, so
 * on macOS `/tmp/x` and `/private/tmp/x` are the same file by different names.
 */
function samePath(a, b) {
  const real = (p) => {
    try {
      return fs.realpathSync(p);
    } catch {
      return path.resolve(p);   // not on disk yet — compare literally
    }
  };
  const [x, y] = [real(a), real(b)];
  return IS_WINDOWS ? x.toLowerCase() === y.toLowerCase() : x === y;
}

// Only run when executed directly, so the tests can import the helpers.
const invokedDirectly = process.argv[1] && samePath(process.argv[1], fileURLToPath(import.meta.url));
if (invokedDirectly) process.exitCode = main(process.argv.slice(2));

export {
  parse, resolveBinDir, plannedFiles, shimPosix, shimCmd, shimPwsh,
  defaultBinDir, npmGlobalBin, onPath, normalise, isOurs, MARKER, NAMES, ROOT, ENTRY,
};
