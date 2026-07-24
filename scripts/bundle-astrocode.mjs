// Bundles the vendored Astrocode CLI source (services/astrocode-cli/) into
// public/astrocode.tar.gz, which the installer (public/installcli.sh)
// downloads from https://<host>/astrocode.tar.gz.
//
// Run: npm run bundle:astrocode   (also wired into prebuild)
//
// Modeled directly on bundle-opensonoma.mjs: tar runs from services/ so the
// archive extracts to a top-level `astrocode-cli/` directory, which
// installcli.sh looks for by name.

import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const srcDir = path.join(root, 'services/astrocode-cli');
const outDir = path.join(root, 'public');
const outFile = path.join(outDir, 'astrocode.tar.gz');

if (!existsSync(path.join(srcDir, 'package.json'))) {
    console.error('[bundle-astrocode] services/astrocode-cli/package.json not found — nothing to bundle.');
    process.exit(0); // non-fatal: never break the Next build
}

mkdirSync(outDir, { recursive: true });

const args = [
    '-czf',
    outFile,
    '-C',
    path.join(root, 'services'),
    '--exclude',
    'astrocode-cli/node_modules',
    '--exclude',
    'astrocode-cli/.git',
    '--exclude',
    'astrocode-cli/test',
    'astrocode-cli',
];

try {
    execFileSync('tar', args, { stdio: 'inherit' });
    console.log(`[bundle-astrocode] wrote ${path.relative(root, outFile)}`);
} catch (err) {
    console.error('[bundle-astrocode] tar failed (non-fatal):', err.message);
    process.exit(0); // don't fail the build if tar is unavailable
}
