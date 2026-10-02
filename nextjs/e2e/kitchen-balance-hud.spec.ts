/**
 * Issue #907 — the bubbles balance is the kitchen scene's top-right HUD. Measured
 * in a real browser, since jsdom has no layout: at 375 and 412 px (and a 99,999
 * balance, the widest the counter gets) the counter sits inside the wall's top-right
 * corner, covers no place's tap target, the door spot or the chalkboard, never takes
 * a tap itself, and stays clear of Bubbly's rows. Production build; every pantry and
 * bubbles route is stubbed and every AI route is blocked (nothing reaches Gemini).
 */
// @ts-nocheck
// NOTE: @ts-nocheck matches the other specs — '@playwright/test' has no type
// declarations in this repo yet (issue #149). Do NOT fix here.
import { test, expect } from './fixtures/auth';

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

async function prepare(page, balance) {
  await page.route((url) => url.pathname.startsWith('/v1/'), (route) => route.abort());
  await page.route('**/api/ai/**', (route) => route.abort());
  await page.route('**/api/decorations**', (route) => route.fulfill(json({ decorations: [], total: 0 })));
  await page.route('**/api/pantry/expiring**', (route) => route.fulfill(json({ items: [], count: 0 })));
  await page.route('**/api/bubbles**', (route) =>
    route.fulfill(json({ balance, recent: [], streak_weeks: 0 })),
  );
  await page.route('**/api/pantry', (route) =>
    route.fulfill(
      json({
        items: [
          { id: 'a', name: 'milk', location: 'fridge', category: 'dairy', quantity: 1, unit: 'L' },
          { id: 'b', name: 'peas', location: 'freezer', category: 'produce', quantity: 1, unit: 'kg' },
          { id: 'c', name: 'rice', location: 'pantry', category: 'dry_goods', quantity: 1, unit: 'kg' },
          { id: 'd', name: 'apple', location: 'counter', category: 'produce', quantity: 3, unit: 'piece' },
        ],
        total_count: 4,
      }),
    ),
  );
  await page.goto('/');
  await expect(page.getByTestId('kitchen-bubbles-balance')).toBeVisible({ timeout: 20_000 });
}

const rectOf = (loc) => loc.evaluate((el) => {
  const r = el.getBoundingClientRect();
  return { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
});
const overlaps = (a, b) => a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

for (const width of [375, 412]) {
  for (const balance of [240, 99999]) {
    test(`the balance HUD covers no tap target at ${width}px, balance ${balance}`, async ({ page }) => {
      await page.setViewportSize({ width, height: 800 });
      await prepare(page, balance);

      const wall = await rectOf(page.getByTestId('kitchen-wall'));
      const counter = await rectOf(page.getByTestId('kitchen-bubbles-balance'));

      // In the wall's top-right corner, inset about 8px, and out of the header.
      expect(counter.right).toBeLessThanOrEqual(wall.right - 6);
      expect(counter.right).toBeGreaterThanOrEqual(wall.right - 12);
      expect(counter.top).toBeGreaterThanOrEqual(wall.top + 6);
      expect(counter.top).toBeLessThanOrEqual(wall.top + 12);
      expect(counter.left).toBeGreaterThan((wall.left + wall.right) / 2);
      const header = await rectOf(page.locator('header').first());
      expect(counter.top).toBeGreaterThanOrEqual(header.bottom);

      // It covers no place's tap target, the chalkboard or the door spot.
      const targets = page.locator('button[data-place], [data-testid="kitchen-chalkboard"], [data-testid="kitchen-door"]');
      const count = await targets.count();
      expect(count).toBeGreaterThanOrEqual(5);
      for (let i = 0; i < count; i++) {
        const t = await rectOf(targets.nth(i));
        expect(overlaps(counter, t), `counter overlaps target ${i}`).toBe(false);
      }

      // A tap on the middle of every place lands on that place, never on the counter.
      for (const key of ['fridge', 'freezer', 'shelves', 'basket']) {
        const hit = await page.locator(`button[data-place="${key}"]`).evaluate((el) => {
          const r = el.getBoundingClientRect();
          const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
          return !!top && (el === top || el.contains(top));
        });
        expect(hit, `${key} is tappable at its centre`).toBe(true);
      }
      // And the counter itself lets a tap through to the wall.
      const through = await page.getByTestId('kitchen-bubbles-balance').evaluate((el) => {
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint((r.left + r.right) / 2, (r.top + r.bottom) / 2);
        return !el.contains(top);
      });
      expect(through).toBe(true);

      // Bubbly walks the floor, below row 58 of 80 (`bubbles-spot.ts`): the counter
      // ends well above it.
      expect(counter.bottom).toBeLessThan(wall.top + (wall.bottom - wall.top) * (58 / 80));
    });
  }
}
