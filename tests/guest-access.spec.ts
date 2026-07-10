import { test, expect } from '@playwright/test';

/**
 * Pins the middleware's guest contract (src/middleware.ts `publicPaths`):
 * guest-capable workspaces are reachable with no account, while account-only
 * pages redirect guests to /login. Both directions are asserted so a change
 * to the public-path list can't silently widen OR narrow guest access.
 */
test.describe('Guest access', () => {
  test('guest-capable workspaces load without a login redirect', async ({ page }) => {
    for (const path of ['/chat', '/code']) {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/login/);
    }
  });

  test('account-only pages redirect guests to /login', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login/);
  });
});
