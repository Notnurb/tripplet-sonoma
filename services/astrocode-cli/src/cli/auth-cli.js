/**
 * auth-cli.js — `astrocode login | logout | whoami`, outside the TUI.
 *
 * Same flow as the in-app overlay, rendered as plain lines: print the link,
 * try to open a browser, then wait on whichever arrives first — the loopback
 * callback or a code the user pastes at the prompt.
 */

import process from 'node:process';
import readline from 'node:readline';

import { toAnsi, run, strWidth } from '../ui/text.js';
import { login } from '../auth/login.js';
import { DEFAULT_BASE_URL } from '../auth/oauth.js';
import { loadAuth, clearAuth, isExpired, isSignedIn } from '../auth/store.js';
import { copyToClipboard } from '../auth/browser.js';

const write = (line = '') => process.stdout.write(`${line}\n`);
const paint = (l) => write(toAnsi(l));

export async function authCommand(name, { theme, config, args = [] } = {}) {
  switch (name) {
    case 'login': return doLogin({ theme, config, args });
    case 'logout': return doLogout({ theme });
    case 'whoami': return doWhoami({ theme });
    default: return 2;
  }
}

async function doLogin({ theme, config, args }) {
  const t = theme;
  const urlArg = args.find((a) => /^https?:\/\//i.test(a));
  const baseUrl = (urlArg || config?.authUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
  const force = args.includes('--force') || args.includes('-f');

  const existing = loadAuth();
  if (isSignedIn(existing) && !force && existing.baseUrl === baseUrl) {
    paint([
      run('✓ ', { fg: t.success }),
      run('Already signed in', { fg: t.text }),
      run(existing.email ? `  ${existing.email}` : '', { fg: t.dim }),
      run(`  ${existing.baseUrl}`, { fg: t.faint }),
    ]);
    write(toAnsi([run('  astrocode login --force  to sign in again', { fg: t.faint })]));
    return 0;
  }
  if (urlArg) clearAuth();

  write();
  paint([run('  Signing in to ', { fg: t.dim }), run(baseUrl, { fg: t.primary, bold: true })]);
  write();

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  const ac = new AbortController();
  let answered = false;

  const onSigint = () => { ac.abort(); };
  process.once('SIGINT', onSigint);

  try {
    const { auth, method } = await login({
      baseUrl,
      signal: ac.signal,
      onReady: async ({ url, opened, openReason }) => {
        if (opened) {
          paint([run('  ✓ ', { fg: t.success }), run('Opened your browser — approve the request there.', { fg: t.text })]);
        } else {
          paint([run('  ▲ ', { fg: t.warn }), run(`Could not open a browser${openReason ? ` (${openReason})` : ''}.`, { fg: t.text })]);
        }
        write();
        paint([run('  Open this link:', { fg: t.dim })]);
        paint([run(`  ${url}`, { fg: t.info, underline: true })]);

        const copied = await copyToClipboard(url);
        write();
        paint([run(copied.copied ? '  (copied to your clipboard)' : `  (copy it by hand — ${copied.reason})`,
          { fg: t.faint })]);
        write();
        paint([run('  Waiting for approval…', { fg: t.dim })]);
        paint([run('  If your browser cannot reach this machine, paste the code (or the', { fg: t.faint })]);
        paint([run('  whole redirected URL) here and press enter.', { fg: t.faint })]);
        write();
      },
      // The prompt and the loopback race; whichever lands first wins.
      waitForManual: () => new Promise((resolve) => {
        rl.question(toAnsi([run('  code › ', { fg: t.primary, bold: true })]), (answer) => {
          answered = true;
          resolve(answer && answer.trim() ? answer.trim() : null);
        });
      }),
    });

    if (!answered) { rl.write('\n'); }
    rl.close();
    write();
    paint([
      run('  ✓ ', { fg: t.success }),
      run('Signed in', { fg: t.text, bold: true }),
      run(auth.email ? ` as ${auth.email}` : '', { fg: t.text }),
      run(method === 'manual' ? '  (pasted code)' : '', { fg: t.faint }),
    ]);
    paint([run(`  ${baseUrl}`, { fg: t.faint })]);
    write();
    paint([run('  Run ', { fg: t.dim }), run('astrocode', { fg: t.primary, bold: true }), run(' to start.', { fg: t.dim })]);
    write();
    return 0;
  } catch (err) {
    rl.close();
    write();
    const cancelled = err?.code === 'cancelled';
    paint([
      run(cancelled ? '  ▲ ' : '  ✕ ', { fg: cancelled ? t.warn : t.error }),
      run(cancelled ? 'Sign-in cancelled.' : `Sign-in failed: ${err.message}`, { fg: cancelled ? t.warn : t.error }),
    ]);
    if (err?.hint) paint([run(`  ${err.hint}`, { fg: t.dim })]);
    write();
    return cancelled ? 130 : 1;
  } finally {
    process.off('SIGINT', onSigint);
  }
}

function doLogout({ theme: t }) {
  const auth = loadAuth();
  if (!auth) {
    paint([run('  Not signed in.', { fg: t.dim })]);
    return 0;
  }
  const res = clearAuth();
  if (!res.ok) {
    paint([run(`  ✕ Could not remove credentials: ${res.error}`, { fg: t.error })]);
    return 1;
  }
  paint([run('  ✓ ', { fg: t.success }), run('Signed out', { fg: t.text }),
    run(auth.email ? `  ${auth.email}` : '', { fg: t.faint })]);
  return 0;
}

function doWhoami({ theme: t }) {
  const auth = loadAuth();
  if (!auth) {
    paint([run('  Not signed in.', { fg: t.warn })]);
    paint([run('  Run ', { fg: t.faint }), run('astrocode login', { fg: t.primary }), run(' to connect.', { fg: t.faint })]);
    return 1;
  }
  const stale = isExpired(auth, 0);
  const rows = [
    ['account', auth.email || 'unknown'],
    ['server', auth.baseUrl || '—'],
    ['scope', auth.scope || '—'],
    ['token', stale ? (auth.refreshToken ? 'expired — refreshes automatically' : 'expired') : 'valid'],
    ['signed in', auth.signedInAt ? new Date(auth.signedInAt).toLocaleString() : '—'],
  ];
  const width = Math.max(...rows.map(([k]) => strWidth(k)));
  write();
  for (const [k, v] of rows) {
    paint([
      run(`  ${k.padEnd(width)}  `, { fg: t.dim }),
      run(String(v), { fg: k === 'token' && stale && !auth.refreshToken ? t.error : t.text }),
    ]);
  }
  write();
  return 0;
}

export const AUTH_COMMANDS = new Set(['login', 'logout', 'whoami', 'signin', 'signout']);
