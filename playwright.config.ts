import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Playwright owns *.spec.ts; vitest owns tests/unit/*.test.ts. Without this,
  // Playwright's default testMatch would also pick up the vitest files.
  testMatch: '**/*.spec.ts',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: 'html',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: {
    // Locally: the dev server (fast iteration, reuses one you already have
    // running). In CI: the production server — the e2e job builds first, so
    // pages are precompiled and the first goto can't flake on Turbopack's
    // on-demand compilation.
    command: process.env.CI ? 'npm run start' : 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
