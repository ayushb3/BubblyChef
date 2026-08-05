import { test, expect } from './fixtures/auth';

test.describe('smoke navigation', () => {
  test('home → pantry → recipes', async ({ page }) => {
    await page.goto('/');
    // The dashboard renders Bubbles more than once (nav avatar + hero), so scope
    // this to the first match — the assertion is "the dashboard mounted", not "there
    // is exactly one mascot".
    await expect(page.getByAltText(/Bubbles/).first()).toBeVisible();

    await page.getByRole('link', { name: 'Pantry' }).click();
    await expect(page).toHaveURL(/\/pantry/);

    await page.getByRole('link', { name: 'Recipes' }).click();
    await expect(page).toHaveURL(/\/recipes/);
  });
});
