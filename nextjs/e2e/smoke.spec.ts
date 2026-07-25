import { test, expect } from '@playwright/test';

// Unauthenticated smoke suite. No credentials, no global setup, no
// storageState — must pass on a totally clean checkout with zero secrets.
// This is what CI runs on every PR.

test.describe('smoke (unauthenticated)', () => {
  test('app boots and home responds', async ({ page }) => {
    const response = await page.goto('/');
    expect(response?.ok()).toBeTruthy();
  });

  test('unauthenticated visit to a protected route redirects to /login', async ({ page }) => {
    await page.goto('/pantry');
    await expect(page).toHaveURL(/\/login/);
  });

  test('/login renders its form', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Sign In' })).toBeVisible();
  });

  test('no console errors on load', async ({ page }) => {
    // Next.js's own dev-mode HMR websocket is noisy in headless/CI
    // environments (proxies, sandboxes) that don't like the upgrade
    // handshake — it's dev-tooling plumbing, not an app bug, so it's
    // filtered out rather than asserted on.
    const isDevServerNoise = (text: string) => /webpack-hmr|HMR|WebSocket connection/i.test(text);

    const errors: string[] = [];
    page.on('console', (msg) => {
      if (msg.type() === 'error' && !isDevServerNoise(msg.text())) errors.push(msg.text());
    });
    page.on('pageerror', (err) => errors.push(err.message));

    await page.goto('/login');
    await page.waitForLoadState('networkidle');

    expect(errors).toEqual([]);
  });
});
