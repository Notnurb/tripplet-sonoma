import { chromium } from '@playwright/test';
import { mkdirSync } from 'fs';
import path from 'path';

const outDir = path.resolve('assets/screenshots');
mkdirSync(outDir, { recursive: true });

// The /chat capture runs in a fresh browser context — no auth cookie — so it
// renders as a brand-new guest session, never a logged-in account.
const pages = [
  { url: '/', file: 'landing.png' },
  { url: '/sign-in', file: 'sign-in.png' },
  { url: '/chat', file: 'chat.png', waitFor: 'textarea' },
  { url: '/features', file: 'features.png' },
];

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

for (const { url, file, waitFor } of pages) {
  try {
    await page.goto(`http://localhost:3000${url}`, { waitUntil: 'networkidle', timeout: 20000 }).catch(() => {});
    if (waitFor) await page.waitForSelector(waitFor, { timeout: 15000 });
    await page.waitForTimeout(1000);
    await page.screenshot({ path: path.join(outDir, file) });
    console.log(`Captured ${url} -> ${file}`);
  } catch (err) {
    console.error(`Failed ${url}:`, err.message);
  }
}

await browser.close();
