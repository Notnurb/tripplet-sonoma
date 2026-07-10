// Bundles the vendored OpenSonoma source (services/opensonoma-agent/) into
// public/opensonoma.tar.gz, which the installer (public/installconnect.sh)
// downloads from https://tripplet.lol/opensonoma.tar.gz.
//
// Run: npm run bundle:opensonoma   (also wired into prebuild)
//
// The tarball layout is IDENTICAL to before the repo's services/ reorg: a
// top-level `opensonoma-agent/` directory holding pyproject.toml + the
// package, so installconnect.sh's
//   find -maxdepth 3 -name pyproject.toml
// locates it after extraction. (tar runs from services/ to keep that shape.)

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(root, 'services/opensonoma-agent');
const outDir = path.join(root, 'public');
const outFile = path.join(outDir, 'opensonoma.tar.gz');

if (!existsSync(path.join(srcDir, 'pyproject.toml'))) {
    console.error('[bundle-opensonoma] services/opensonoma-agent/pyproject.toml not found — nothing to bundle.');
    process.exit(0); // non-fatal: never break the Next build
}

mkdirSync(outDir, { recursive: true });

// Tar the directory (by name, from its parent) excluding build cruft so the
// archive is small and reproducible.
const args = [
    '-czf',
    outFile,
    '-C',
    path.join(root, 'services'),
    '--exclude',
    'opensonoma-agent/**/__pycache__',
    '--exclude',
    'opensonoma-agent/**/*.pyc',
    '--exclude',
    'opensonoma-agent/build',
    '--exclude',
    'opensonoma-agent/**/*.egg-info',
    '--exclude',
    'opensonoma-agent/**/.venv',
    '--exclude',
    'opensonoma-agent/relay/node_modules',
    'opensonoma-agent',
];

try {
    execFileSync('tar', args, { stdio: 'inherit' });
    console.log(`[bundle-opensonoma] wrote ${path.relative(root, outFile)}`);
} catch (err) {
    console.error('[bundle-opensonoma] tar failed (non-fatal):', err.message);
    process.exit(0); // don't fail the build if tar is unavailable
}
