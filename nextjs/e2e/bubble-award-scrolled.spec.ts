/**
 * Issue #843 — an award shows exactly one "+N" on screen, wherever the home is
 * scrolled. At the top the header counter's own tag is the reaction (the global
 * pop stays quiet); scrolled past the header (it is not sticky) the counter and its
 * tag are off screen, so the global pop must show instead, or the award is
 * invisible.
 *
 * The award is a rescue: "Used it" on a food expiring today, from the storage
 * sheet, after the 5-second undo window (#851). 390px, production build; every
 * pantry/bubbles route is stubbed (no hosted write) and every AI route is blocked.
 */
// @ts-nocheck
// NOTE: @ts-nocheck matches the other specs — '@playwright/test' has no type
// declarations in this repo yet (issue #149). Do NOT fix here.
import { test, expect } from './fixtures/auth';

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
const ymd = (d) => {
  const t = new Date();
  t.setDate(t.getDate() + d);
  return t.toLocaleDateString('en-CA');
};

test.use({ viewport: { width: 390, height: 640 } });

async function prepare(page, state) {
  await page.route((url) => url.pathname.startsWith('/v1/'), (route) => route.abort());
  await page.route('**/api/ai/**', (route) => route.abort());
  await page.route('**/api/decorations**', (route) => route.fulfill(json({ decorations: [], total: 0 })));
  await page.route('**/api/pantry/expiring**', (route) => route.fulfill(json({ items: [], count: 0 })));
  await page.route('**/api/bubbles**', (route) =>
    route.fulfill(json({ balance: state.balance, recent: [], streak_weeks: 0 })),
  );
  await page.route(/\/api\/pantry\/[^/]+\/resolve$/, async (route) => {
    const id = route.request().url().split('/').slice(-2)[0];
    state.rows = state.rows.filter((r) => r.id !== id);
    state.balance += 8; // the rescue award
    await route.fulfill(json({ id, outcome: 'used', resolved: true }));
  });
  await page.route('**/api/pantry', (route) =>
    route.fulfill(json({ items: state.rows.map((r) => ({ ...r })), total_count: state.rows.length })),
  );
  await page.goto('/');
  await expect(page.locator('[data-testid="kitchen-eyebrow"]:visible')).toHaveText(/\S/, { timeout: 20_000 });
}

/** The most "+N" chips seen on screen at once while the award lands. */
async function maxVisibleChips(page, ms = 2500) {
  return page.evaluate(
    (duration) =>
      new Promise((resolve) => {
        let max = 0;
        const end = performance.now() + duration;
        const tick = () => {
          const visible = [
            ...document.querySelectorAll('[data-testid="bubble-pop"], [data-testid="bubbles-counter-rise"]'),
          ].filter((el) => {
            const r = el.getBoundingClientRect();
            return (
              /\+\d/.test(el.textContent ?? '') &&
              r.bottom > 0 &&
              r.top < window.innerHeight &&
              r.right > 0 &&
              r.left < window.innerWidth
            );
          });
          max = Math.max(max, visible.length);
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve(max);
        };
        tick();
      }),
    ms,
  );
}

function rows() {
  return [
    { id: 'basil', name: 'basil', location: 'fridge', category: 'produce', quantity: 1, unit: 'bunch', expiry_date: ymd(0) },
    { id: 'milk', name: 'milk', location: 'fridge', category: 'dairy', quantity: 1, unit: 'L', expiry_date: ymd(0) },
    { id: 'rice', name: 'rice', location: 'pantry', category: 'dry_goods', quantity: 1, unit: 'kg', expiry_date: null },
  ];
}

async function useItUp(page, sheet, name) {
  await sheet.getByRole('button', { name: `Mark ${name} as used up` }).click();
  // The write, and so the award, lands after the undo window.
  return maxVisibleChips(page, 7500);
}

test('a rescue award shows exactly one +N on screen, scrolled or not', async ({ page }) => {
  test.setTimeout(60_000);
  const state = { balance: 100, rows: rows() };
  await prepare(page, state);

  // Scrolled past the header: the counter is out of view, so the global pop shows.
  await page.evaluate(() => window.scrollTo(0, 200));
  expect(await page.evaluate(() => Math.round(window.scrollY))).toBeGreaterThan(100);
  // A DOM click: Playwright's own click would scroll the page back toward the tag.
  await page.getByRole('button', { name: /^Fridge/ }).first().evaluate((el) => el.click());
  const sheet = page.getByTestId('storage-sheet');
  await sheet.getByRole('button', { name: 'List' }).click();
  expect(await useItUp(page, sheet, 'basil')).toBe(1);
  await expect(page.getByTestId('bubble-pop')).toHaveCount(0); // it has run its course by now

  // Back at the top: the counter's own tag is the one, and the global pop stays quiet.
  await sheet.getByRole('button', { name: 'Close' }).click();
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: /^Fridge/ }).first().click();
  await page.getByTestId('storage-sheet').getByRole('button', { name: 'List' }).click();
  const popSeen = page.evaluate(
    () =>
      new Promise((resolve) => {
        let seen = false;
        const end = performance.now() + 7500;
        const tick = () => {
          if (document.querySelector('[data-testid="bubble-pop"]')) seen = true;
          if (performance.now() < end) requestAnimationFrame(tick);
          else resolve(seen);
        };
        tick();
      }),
  );
  expect(await useItUp(page, page.getByTestId('storage-sheet'), 'milk')).toBe(1);
  expect(await popSeen).toBe(false);
});
