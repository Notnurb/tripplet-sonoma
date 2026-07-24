/**
 * browser.js — opening a URL and copying text, on whatever machine this is.
 *
 * Both operations are best-effort by design: over SSH, in a container, or on a
 * bare TTY there is no browser and no clipboard, and the login flow has to
 * degrade to "here is the link, paste the code back" rather than fail.
 */

import { spawn, execFile } from 'node:child_process';
import process from 'node:process';

/** No browser worth opening in these. */
function headless() {
  const env = process.env;
  if (env.ASTROCODE_NO_BROWSER) return true;
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return true;
  if (process.platform === 'linux' && !env.DISPLAY && !env.WAYLAND_DISPLAY) return true;
  return false;
}

/**
 * Try to open `url` in the default browser.
 * @returns {Promise<{opened: boolean, reason?: string}>}
 */
export function openUrl(url) {
  if (headless()) {
    return Promise.resolve({ opened: false, reason: 'no graphical session detected' });
  }

  const [cmd, args] = process.platform === 'darwin'
    ? ['open', [url]]
    : process.platform === 'win32'
      // `start` is a cmd builtin; the empty string is the window title, which
      // it would otherwise steal from a quoted URL.
      ? ['cmd.exe', ['/c', 'start', '', url.replace(/&/g, '^&')]]
      : ['xdg-open', [url]];

  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: process.platform !== 'win32' });
      child.on('error', (err) => finish({ opened: false, reason: err.message }));
      child.on('spawn', () => {
        child.unref?.();
        // A successful spawn is the best signal available; the launcher exits
        // immediately and tells us nothing about whether a window appeared.
        finish({ opened: true });
      });
      setTimeout(() => finish({ opened: false, reason: 'browser launcher timed out' }), 4000).unref?.();
    } catch (err) {
      finish({ opened: false, reason: err.message });
    }
  });
}

const CLIPBOARDS = {
  darwin: [['pbcopy', []]],
  win32: [['clip', []]],
  linux: [
    ['wl-copy', []],
    ['xclip', ['-selection', 'clipboard']],
    ['xsel', ['--clipboard', '--input']],
  ],
};

/**
 * Copy `text` to the system clipboard.
 * @returns {Promise<{copied: boolean, tool?: string, reason?: string}>}
 */
export async function copyToClipboard(text) {
  const candidates = CLIPBOARDS[process.platform] || CLIPBOARDS.linux;
  let lastReason = 'no clipboard tool found';

  for (const [cmd, args] of candidates) {
    const res = await tryCopy(cmd, args, text);
    if (res.copied) return res;
    lastReason = res.reason || lastReason;
  }
  return {
    copied: false,
    reason: process.platform === 'linux'
      ? `${lastReason} — install wl-clipboard or xclip`
      : lastReason,
  };
}

function tryCopy(cmd, args, text) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    let child;
    try {
      child = spawn(cmd, args, { stdio: ['pipe', 'ignore', 'ignore'] });
    } catch (err) {
      finish({ copied: false, reason: err.message });
      return;
    }
    child.on('error', (err) => finish({ copied: false, reason: `${cmd}: ${err.message}` }));
    child.on('close', (code) => finish(code === 0
      ? { copied: true, tool: cmd }
      : { copied: false, reason: `${cmd} exited ${code}` }));
    try {
      child.stdin.on('error', () => { /* closed before we finished writing */ });
      child.stdin.end(text);
    } catch (err) {
      finish({ copied: false, reason: err.message });
    }
    setTimeout(() => finish({ copied: false, reason: `${cmd} timed out` }), 3000).unref?.();
  });
}

/** Read the clipboard, when the platform makes that cheap. Used by "paste". */
export function readClipboard() {
  const cmd = process.platform === 'darwin' ? ['pbpaste', []]
    : process.platform === 'win32' ? ['powershell', ['-NoProfile', '-Command', 'Get-Clipboard']]
      : null;
  if (!cmd) return Promise.resolve(null);
  return new Promise((resolve) => {
    execFile(cmd[0], cmd[1], { timeout: 3000, maxBuffer: 1 << 20 }, (err, stdout) => {
      resolve(err ? null : String(stdout).trim());
    });
  });
}

export { headless as isHeadlessSession };
