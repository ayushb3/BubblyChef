import { test, expect } from './fixtures/auth';

test.describe('smoke navigation', () => {
  test('home → pantry → recipes', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByAltText(/Bubbles/)).toBeVisible();

    await page.getByRole('link', { name: 'Pantry' }).click();
    await expect(page).toHaveURL(/\/pantry/);

    await page.getByRole('link', { name: 'Recipes' }).click();
    await expect(page).toHaveURL(/\/recipes/);
  });
});
