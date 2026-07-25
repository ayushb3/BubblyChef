import { test, expect } from './fixtures/auth';

// Needs a logged-in session (see e2e/auth.setup.ts, the `auth-setup`
// project). Skips cleanly — rather than erroring on a missing
// e2e/.auth/user.json storageState file — when credentials are absent.
// test.skip() here is called at describe-scope so it is evaluated before any
// fixture (including `page`, which would otherwise try to load the
// storageState file) is touched.

const hasCredentials = Boolean(
  process.env.TEST_USERNAME &&
    process.env.TEST_PASSWORD &&
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

test.describe('authenticated navigation', () => {
  test.skip(
    !hasCredentials,
    'Authenticated e2e suite requires TEST_USERNAME, TEST_PASSWORD, ' +
      'NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY in ' +
      'nextjs/.env.local — skipping (see nextjs/e2e/README.md).'
  );

  test('home → pantry → recipes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByAltText(/Bubbles/)).toBeVisible();

    await page.getByRole('link', { name: 'Pantry' }).click();
    await expect(page).toHaveURL(/\/pantry/);

    await page.getByRole('link', { name: 'Recipes' }).click();
    await expect(page).toHaveURL(/\/recipes/);
  });
});
