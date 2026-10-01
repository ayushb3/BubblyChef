/**
 * Issue #844 — opening a PixelSheet over the kitchen home must not move the page
 * behind it, and closing it must put the page back exactly where it was.
 *
 * The bug: with the put-away sheet open, the home underneath was sometimes left
 * scrolled 80-107px, which hid the header once the sheet closed. It came from the
 * sheet's focus handling (focus moving into the sheet, and back out of it on
 * close, scrolls the page to reveal the element) and a body-only scroll lock that
 * does not stop a programmatic scroll. The lock now freezes the page where it is
 * and the focus calls do not scroll.
 *
 * Runs at 390px (a phone) on a production build. Every AI-service route (/v1/**) is blocked: no
 * model is called, and the pantry reads are stubbed so the page is the same
 * every time.
 */
// @ts-nocheck
// NOTE: @ts-nocheck matches the other specs — '@playwright/test' has no type
// declarations in this repo yet (issue #149). Do NOT fix here.
import { test, expect } from './fixtures/auth';

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const ITEMS = ['Milk', 'Eggs', 'Butter', 'Spinach', 'Rice', 'Peas', 'Apples'].map((name, i) => ({
  id: `scroll-${i}`,
  name,
  quantity: 1,
  unit: 'item',
  category: 'other',
  location: ['fridge', 'fridge', 'fridge', 'fridge', 'pantry', 'freezer', 'counter'][i],
  expiry_date: null,
  days_until_expiry: null,
  is_expired: false,
  is_expiring_soon: false,
}));

const PENDING_PUTAWAY = {
  v: 1,
  savedAt: '2026-10-01T09:00:00.000Z',
  store: 'Corner Shop',
  ready: [
    { _id: 'a', name: 'Eggs', quantity: 12, unit: 'item', category: 'dairy', location: 'fridge', confidence: 0.95 },
    { _id: 'b', name: 'Peas', quantity: 1, unit: 'bag', category: 'frozen', location: 'freezer', confidence: 0.95 },
  ],
  review: [],
  skipped: [],
  warnings: [],
};

test.use({ viewport: { width: 390, height: 640 } });

async function prepare(page, { pending }) {
  // No model, ever: every AI route is refused.
  // (Matched on the path's start: Supabase's own /auth/v1/ calls must keep working.)
  await page.route((url) => url.pathname.startsWith('/v1/'), (route) => route.abort());
  await page.route('**/api/ai/**', (route) => route.abort());
  await page.route('**/api/pantry', (route) =>
    route.fulfill(json({ items: ITEMS, total_count: ITEMS.length })),
  );
  await page.route('**/api/pantry/expiring**', (route) => route.fulfill(json({ items: [], count: 0 })));
  if (pending) {
    await page.addInitScript((value) => {
      localStorage.setItem('bubblychef:putaway:pending', value);
    }, JSON.stringify(PENDING_PUTAWAY));
  }
  await page.goto('/');
  await expect(page.locator('[data-testid="kitchen-eyebrow"]:visible')).toHaveText(/\S/, { timeout: 20_000 });
}

const scrollY = (page) => page.evaluate(() => Math.round(window.scrollY));

test('put-away: opening and closing leaves the home where it was (header still visible)', async ({ page }) => {
  await prepare(page, { pending: true });

  // The sheet opens by itself with a scan waiting.
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(600); // the slide-in and the focus settle
  expect(await scrollY(page)).toBe(0);

  // Close it ("Not now" leaves the scan waiting; the close button is the same path).
  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  await page.waitForTimeout(400);

  expect(await scrollY(page)).toBe(0);
  const header = page.getByRole('heading', { name: 'Your kitchen' });
  const box = await header.boundingBox();
  expect(box.y).toBeGreaterThanOrEqual(0);
});

test('a storage sheet opened from a scrolled page leaves it exactly where it was', async ({ page }) => {
  await prepare(page, { pending: false });

  await page.evaluate(() => window.scrollTo(0, 60));
  const before = await scrollY(page);
  expect(before).toBeGreaterThan(0);

  await page.getByRole('button', { name: /^Fridge/ }).click();
  const sheet = page.getByRole('dialog');
  await expect(sheet).toBeVisible();
  await page.waitForTimeout(600);
  expect(await scrollY(page)).toBe(before);

  await sheet.getByRole('button', { name: 'Close' }).click();
  await expect(sheet).toBeHidden();
  await page.waitForTimeout(400);
  expect(await scrollY(page)).toBe(before);
});
