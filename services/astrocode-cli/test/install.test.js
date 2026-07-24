/**
 * Installer tests.
 *
 * The POSIX launcher is executed for real. The Windows launchers cannot be run
 * here, so they are asserted structurally — quoting, escaping, ASCII-safety and
 * exit-code propagation are exactly the things that break silently on a machine
 * you do not have.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import {
  parse, resolveBinDir, plannedFiles, shimPosix, shimCmd, shimPwsh,
  defaultBinDir, isOurs, MARKER, NAMES, ROOT, ENTRY,
} from '../scripts/install.js';
import { withTempDir } from './helpers.js';

const INSTALLER = path.join(ROOT, 'scripts', 'install.js');
const IS_WINDOWS = process.platform === 'win32';

const run = (args, opts = {}) => execFileSync(process.execPath, [INSTALLER, ...args], {
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...process.env, NO_COLOR: '1', ...(opts.env || {}) },
  ...opts,
});

// ── argument parsing ────────────────────────────────────────────────────────

test('flags parse in both long and short form', () => {
  assert.deepEqual(parse([]).uninstall, false);
  assert.equal(parse(['--uninstall']).uninstall, true);
  assert.equal(parse(['-u']).uninstall, true);
  assert.equal(parse(['--dry-run']).dryRun, true);
  assert.equal(parse(['-n']).dryRun, true);
  assert.equal(parse(['--force']).force, true);
  assert.equal(parse(['--quiet']).quiet, true);
  assert.equal(parse(['--help']).help, true);
  assert.equal(parse(['--prefix', '/x']).prefix, '/x');
  assert.equal(parse(['--prefix=/x']).prefix, '/x');
  assert.equal(parse(['--bin-dir=/y']).prefix, '/y');
});

test('a bad flag is rejected rather than ignored', () => {
  assert.throws(() => parse(['--nope']), /unknown option/);
  assert.throws(() => parse(['--prefix']), /needs a directory/);
});

// ── target selection ────────────────────────────────────────────────────────

test('--prefix wins over everything', () => {
  const { dir, reason } = resolveBinDir({ prefix: path.join(os.tmpdir(), 'explicit') });
  assert.equal(dir, path.resolve(os.tmpdir(), 'explicit'));
  assert.equal(reason, '--prefix');
});

test('the default target is a per-user directory, never a system one', () => {
  const d = defaultBinDir();
  assert.ok(d.startsWith(os.homedir()) || /AppData|Astrocode/i.test(d), d);
  assert.ok(!/^\/usr|^\/opt\/local|^C:\\Windows/i.test(d), `${d} must not be a system path`);
});

// ── shim generation ─────────────────────────────────────────────────────────

test('every planned file carries the ownership marker', () => {
  for (const f of plannedFiles('/tmp/bin')) {
    assert.ok(f.body.includes(MARKER), `${f.file} is identifiable`);
    assert.ok(f.file.startsWith(path.join('/tmp', 'bin')), f.file);
  }
});

test('both command names are installed', () => {
  const files = plannedFiles('/tmp/bin').map((f) => path.basename(f.file));
  for (const n of NAMES) {
    assert.ok(files.some((f) => f === n || f.startsWith(`${n}.`)), `${n} launcher planned`);
  }
});

test('the POSIX shim quotes paths containing spaces and quotes', () => {
  const body = shimPosix("/opt/my node/bin/node", "/home/o'brien/Astro Code/bin/astrocode.js");
  assert.match(body, /^#!\/bin\/sh/);
  assert.ok(body.includes(`'/home/o'\\''brien/Astro Code/bin/astrocode.js'`),
    'a single quote is escaped for sh');
  assert.ok(body.includes(`'/opt/my node/bin/node'`), 'the node path is quoted');
  assert.match(body, /exec node "\$ASTROCODE_ENTRY" "\$@"/, 'arguments are forwarded intact');
});

test('the POSIX shim prefers node from PATH but can fall back', () => {
  const body = shimPosix('/abs/node', '/abs/entry.js');
  assert.match(body, /command -v node/, 'looks on PATH first');
  const viaPath = body.indexOf('exec node');
  const viaAbs = body.indexOf(`exec '/abs/node'`);
  assert.ok(viaPath !== -1 && viaAbs !== -1 && viaPath < viaAbs, 'PATH is tried first');
});

test('the batch shim is pure ASCII', () => {
  const body = shimCmd('C:\\Program Files\\nodejs\\node.exe', 'C:\\src\\bin\\astrocode.js');
  // eslint-disable-next-line no-control-regex
  const nonAscii = body.match(/[^\x00-\x7F]/g);
  assert.equal(nonAscii, null, `cmd.exe reads OEM codepages: found ${nonAscii}`);
});

test('the batch shim uses CRLF line endings', () => {
  const body = shimCmd('C:\\node.exe', 'C:\\entry.js');
  const lines = body.split('\n').filter((l) => l !== '');
  for (const l of lines) assert.ok(l.endsWith('\r'), `no CR on: ${JSON.stringify(l)}`);
});

test('the batch shim escapes a literal percent in a path', () => {
  const body = shimCmd('C:\\node.exe', 'C:\\100% coverage\\bin\\astrocode.js');
  assert.ok(body.includes('C:\\100%% coverage\\bin\\astrocode.js'), 'percent is doubled');
});

test('the batch shim forwards arguments and propagates the exit code', () => {
  const body = shimCmd('C:\\node.exe', 'C:\\entry.js');
  assert.ok(body.includes('%*'), 'arguments forwarded');
  assert.match(body, /EXIT \/B %ERRORLEVEL%/, 'exit code propagated');
  assert.match(body, /EXIT \/B 127/, 'missing entry is a distinct failure');
  assert.match(body, /^@ECHO OFF/, 'no command echo');
});

test('the PowerShell shim escapes single quotes and forwards args', () => {
  const body = shimPwsh('C:\\node.exe', "C:\\Users\\o'brien\\entry.js");
  assert.ok(body.includes("'C:\\Users\\o''brien\\entry.js'"), 'single quote doubled');
  assert.ok(body.includes('@args'), 'splatted arguments');
  assert.match(body, /exit \$LASTEXITCODE/, 'exit code propagated');
  assert.match(body, /Test-Path -LiteralPath/, 'literal path check');
});

test('isOurs only claims files this installer wrote', () => withTempDir(async (dir) => {
  const mine = path.join(dir, 'mine');
  const theirs = path.join(dir, 'theirs');
  await fsp.writeFile(mine, shimPosix('/n', '/e'));
  await fsp.writeFile(theirs, '#!/bin/sh\necho hi\n');
  assert.equal(isOurs(mine), true);
  assert.equal(isOurs(theirs), false);
  assert.equal(isOurs(path.join(dir, 'missing')), false);
}));

// ── end to end ──────────────────────────────────────────────────────────────

test('--dry-run changes nothing on disk', () => withTempDir(async (dir) => {
  const out = run(['--dry-run', '--prefix', dir]);
  assert.match(out, /would write/);
  assert.deepEqual(await fsp.readdir(dir), [], 'the directory is still empty');
}));

test('--help does not install anything', () => withTempDir(async (dir) => {
  const out = run(['--help', '--prefix', dir]);
  assert.match(out, /Astrocode installer/);
  assert.deepEqual(await fsp.readdir(dir), []);
}));

test('installing produces launchers that actually run', { skip: IS_WINDOWS ? false : false },
  () => withTempDir(async (dir) => {
    const out = run(['--prefix', dir]);
    assert.match(out, /installed/);
    assert.match(out, /is ready/);

    const launcher = path.join(dir, IS_WINDOWS ? `${NAMES[0]}.cmd` : NAMES[0]);
    assert.ok(fs.existsSync(launcher), 'the launcher exists');

    const version = execFileSync(launcher, ['--version'], {
      encoding: 'utf8', shell: IS_WINDOWS,
    }).trim();
    assert.match(version, /^Astrocode \d+\.\d+\.\d+/, version);

    // …and the second name works too
    const alt = path.join(dir, IS_WINDOWS ? `${NAMES[1]}.cmd` : NAMES[1]);
    assert.match(execFileSync(alt, ['--version'], { encoding: 'utf8', shell: IS_WINDOWS }).trim(),
      /^Astrocode/);
  }));

test('the launcher is executable on POSIX', { skip: IS_WINDOWS }, () => withTempDir(async (dir) => {
  run(['--prefix', dir]);
  const mode = (await fsp.stat(path.join(dir, NAMES[0]))).mode & 0o777;
  assert.ok(mode & 0o100, `owner-executable bit missing (mode ${mode.toString(8)})`);
}));

test('the launcher forwards arguments and exit codes', { skip: IS_WINDOWS },
  () => withTempDir(async (dir) => {
    run(['--prefix', dir]);
    const launcher = path.join(dir, NAMES[0]);

    // --list-models exercises argument forwarding through the shim
    const models = execFileSync(launcher, ['--list-models'], { encoding: 'utf8' });
    for (const n of ['Astro 5 Code', 'Taipei 4', 'Majuli 4', 'Suzhou 4']) {
      assert.ok(models.includes(n), `${n} listed through the launcher`);
    }

    // a usage error must surface as a non-zero exit
    assert.throws(
      () => execFileSync(launcher, ['--definitely-not-a-flag'], { stdio: 'pipe' }),
      /Command failed|status/,
    );
  }));

test('a path with spaces survives the whole round trip', { skip: IS_WINDOWS },
  () => withTempDir(async (dir) => {
    const spaced = path.join(dir, 'bin dir with spaces');
    await fsp.mkdir(spaced, { recursive: true });
    run(['--prefix', spaced]);
    const out = execFileSync(path.join(spaced, NAMES[0]), ['--version'], { encoding: 'utf8' });
    assert.match(out.trim(), /^Astrocode/);
  }));

test('an existing foreign binary is never clobbered without --force',
  () => withTempDir(async (dir) => {
    const target = path.join(dir, IS_WINDOWS ? `${NAMES[0]}.cmd` : NAMES[0]);
    const original = '#!/bin/sh\necho someone elses tool\n';
    await fsp.writeFile(target, original);

    assert.throws(() => run(['--prefix', dir]), /Command failed/);
    assert.equal(await fsp.readFile(target, 'utf8'), original, 'left untouched');

    run(['--prefix', dir, '--force']);
    assert.ok(isOurs(target), '--force replaces it');
  }));

test('installing twice in a row is fine', () => withTempDir(async (dir) => {
  run(['--prefix', dir]);
  const out = run(['--prefix', dir]);
  assert.match(out, /is ready/, 'a re-install is not blocked by its own files');
}));

test('--uninstall removes our launchers and spares everything else',
  () => withTempDir(async (dir) => {
    run(['--prefix', dir]);
    const foreign = path.join(dir, 'unrelated-tool');
    await fsp.writeFile(foreign, 'keep me');

    const out = run(['--uninstall', '--prefix', dir]);
    assert.match(out, /removed/);
    for (const n of NAMES) {
      assert.equal(fs.existsSync(path.join(dir, n)), false, `${n} removed`);
      assert.equal(fs.existsSync(path.join(dir, `${n}.cmd`)), false, `${n}.cmd removed`);
    }
    assert.equal(await fsp.readFile(foreign, 'utf8'), 'keep me', 'unrelated files survive');
  }));

test('--uninstall on a clean directory is a no-op, not an error',
  () => withTempDir(async (dir) => {
    const out = run(['--uninstall', '--prefix', dir]);
    assert.match(out, /Nothing to remove/);
  }));

test('a shim whose checkout vanished fails loudly with a useful message',
  { skip: IS_WINDOWS }, () => withTempDir(async (dir) => {
    const binDir = path.join(dir, 'bin');
    await fsp.mkdir(binDir, { recursive: true });
    const launcher = path.join(binDir, 'astrocode');
    await fsp.writeFile(launcher, shimPosix(process.execPath, path.join(dir, 'gone', 'astrocode.js')), { mode: 0o755 });

    let code = 0;
    let stderr = '';
    try {
      execFileSync(launcher, ['--version'], { stdio: 'pipe' });
    } catch (e) {
      code = e.status;
      stderr = String(e.stderr);
    }
    assert.equal(code, 127, 'a missing entry point exits 127');
    assert.match(stderr, /cannot find/);
    assert.match(stderr, /re-run its installer/);
  }));

test('ASTROCODE_BIN_DIR is honoured', () => withTempDir(async (dir) => {
  const out = run(['--dry-run'], { env: { ASTROCODE_BIN_DIR: dir } });
  assert.ok(out.includes(dir), `expected ${dir} in:\n${out}`);
  assert.match(out, /\$ASTROCODE_BIN_DIR/);
}));

test('installing from a symlinked path records the real checkout', { skip: IS_WINDOWS },
  () => withTempDir(async (dir) => {
    // /tmp is a symlink to /private/tmp on macOS, which is exactly the case
    // that once made the installer silently do nothing.
    const link = path.join(dir, 'link-to-root');
    await fsp.symlink(ROOT, link);
    const binDir = path.join(dir, 'bin');
    const out = execFileSync(process.execPath,
      [path.join(link, 'scripts', 'install.js'), '--prefix', binDir],
      { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } });
    assert.match(out, /is ready/, out);
    const body = await fsp.readFile(path.join(binDir, NAMES[0]), 'utf8');
    assert.ok(body.includes(fs.realpathSync(ENTRY)), 'the real entry path was recorded');
  }));

// ── bootstrap scripts ───────────────────────────────────────────────────────

test('install.sh is POSIX-clean and delegates to the Node installer',
  { skip: IS_WINDOWS }, () => {
    const file = path.join(ROOT, 'install.sh');
    assert.ok(fs.existsSync(file), 'install.sh exists');
    assert.ok((fs.statSync(file).mode & 0o111) !== 0, 'install.sh is executable');
    execFileSync('sh', ['-n', file]);            // throws on a syntax error
    const body = fs.readFileSync(file, 'utf8');
    assert.match(body, /^#!\/bin\/sh/, 'plain sh, not bash');
    assert.match(body, /scripts\/install\.js/);
    assert.ok(!body.includes('=='), 'no bashism in test expressions');
  });

test('install.sh actually installs', { skip: IS_WINDOWS }, () => withTempDir(async (dir) => {
  const out = execFileSync('sh', [path.join(ROOT, 'install.sh'), '--prefix', dir], {
    encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' },
  });
  assert.match(out, /is ready/, out);
  assert.match(execFileSync(path.join(dir, NAMES[0]), ['--version'], { encoding: 'utf8' }),
    /^Astrocode/);
}));

test('install.ps1 exists and delegates to the Node installer', () => {
  const body = fs.readFileSync(path.join(ROOT, 'install.ps1'), 'utf8');
  assert.match(body, /scripts\\install\.js/, 'points at the Node installer');
  assert.match(body, /@Args/, 'forwards arguments');
  assert.match(body, /exit \$LASTEXITCODE/, 'propagates the exit code');
  assert.match(body, /nodejs\\node\.exe/, 'has a fallback for Node not on PATH');
  assert.ok(!/\$\(.*rm .*\)/.test(body), 'no surprising side effects');
});

test('the installer never writes outside the directory it was given',
  () => withTempDir(async (dir) => {
    const before = fs.readdirSync(os.homedir()).length;
    run(['--prefix', dir]);
    assert.equal(fs.readdirSync(os.homedir()).length, before, 'HOME is untouched');
    assert.ok(fs.readdirSync(dir).length > 0, 'the target got the files');
  }));

test('the installer is reachable from package.json', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  assert.ok(pkg.scripts.install || pkg.scripts.setup, 'an npm script exposes it');
  assert.ok((pkg.files || []).includes('scripts'), 'scripts/ ships in the package');
  void fileURLToPath;
});
