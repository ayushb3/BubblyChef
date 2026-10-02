/**
 * Issue #900 — the "Cooking now" banner must not leave a dead band under the
 * composer, and "Jump to latest" is a bare floating pill.
 *
 * Before: with the banner showing the composer floated ~80px above the bottom
 * nav, and the pill sat in its own full-width row that shrank the list.
 *
 * The AI service is never reached: every `**\/v1\/**` route is stubbed and the
 * health check is answered locally. Layout needs a real browser, hence e2e.
 *
 * Set VERIFY_SHOTS=<dir> to also write screenshots there (the verify walk).
 */

// @ts-nocheck
// NOTE: @ts-nocheck matches the other specs — '@playwright/test' has no type
// declarations in this repo yet (issue #149). Do NOT fix here.
import { test, expect } from './fixtures/auth';

const RECIPE_ID = 'e2e-900-recipe';

const RECIPE = {
  id: RECIPE_ID,
  user_id: 'e2e-user',
  title: 'Fluffy Chocolate Chip Pancakes',
  description: 'Fixture recipe for the cooking banner layout.',
  ingredients: ['1.5 cups flour', '3 tbsp sugar', '1 egg'],
  instructions: ['Mix.', 'Cook.'],
  servings: 4,
  created_at: '2026-01-01T00:00:00Z',
};

const turns = Array.from({ length: 20 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content:
    i % 2 === 0
      ? `Question ${i / 2 + 1}: what can I make with eggs and spinach?`
      : `Answer ${(i + 1) / 2}: try a spinach omelette. Whisk the eggs, wilt the spinach, fold it in and serve warm.`,
  intent: i % 2 === 0 ? null : 'cooking_question',
  created_at: new Date(Date.now() - (20 - i) * 60_000).toISOString(),
}));

test.use({ viewport: { width: 412, height: 915 } });

async function stub(page) {
  // Block every AI route by default; allow only what is stubbed below.
  await page.route('**/v1/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/v1/chat/history/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(turns) }),
  );
  await page.route('**/health/ai', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ ai_available: true, providers: [] }),
    }),
  );
  await page.route(`**/api/recipes/${RECIPE_ID}`, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(RECIPE) }),
  );
  await page.addInitScript(() => {
    localStorage.setItem('bubblychef:chat:conversationId', 'e2e-900');
  });
}

const shot = async (page, name) => {
  const dir = process.env.VERIFY_SHOTS;
  if (dir) await page.screenshot({ path: `${dir}/${name}.png` });
};

/** Gap in px between the composer's bottom edge and the bottom nav's top edge. */
async function gapAboveNav(page) {
  return page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Message Bubbly"]');
    const bar = input.parentElement.parentElement; // the composer row
    const nav = document.querySelector('nav');
    return Math.round(nav.getBoundingClientRect().top - bar.getBoundingClientRect().bottom);
  });
}

test.describe('chat cooking banner layout (#900)', () => {
  test('banner showing: composer sits on the nav, and dismissing does not move it', async ({ page }) => {
    await stub(page);
    await page.goto(`/chat?cooking=${RECIPE_ID}`);
    await expect(page.getByText('Cooking now')).toBeVisible();
    await page.waitForTimeout(1000);

    const header = page.getByRole('heading', { name: 'BubblyChef' });
    expect(await page.evaluate(() => document.scrollingElement.scrollTop)).toBe(0);
    await expect(header).toBeInViewport();
    expect(await gapAboveNav(page)).toBeLessThanOrEqual(1);

    const composer = page.getByLabel('Message Bubbly');
    const before = (await composer.boundingBox()).y;
    await shot(page, 'banner-showing');

    await page.getByLabel('Dismiss cooking context').click();
    await expect(page.getByText('Cooking now')).toHaveCount(0);
    await page.waitForTimeout(500);

    expect(await gapAboveNav(page)).toBeLessThanOrEqual(1);
    expect((await composer.boundingBox()).y).toBe(before);
    await shot(page, 'banner-dismissed');
  });

  test('a scrolled document is put back: the column cannot ride up and leave a band', async ({ page }) => {
    await stub(page);
    // Emulate a phone whose 100vh is taller than the visible screen (toolbar
    // showing): the document is a strip taller than the viewport, and something
    // (focus, a sheet closing, the toolbar) scrolls it. Playwright's own
    // viewport has vh == dvh, so the strip is added by hand.
    await page.addInitScript(() => {
      document.addEventListener('DOMContentLoaded', () => {
        const s = document.createElement('style');
        s.textContent = 'body{min-height:calc(100dvh + 76px) !important}';
        document.head.appendChild(s);
      });
    });
    await page.goto(`/chat?cooking=${RECIPE_ID}`);
    await expect(page.getByText('Cooking now')).toBeVisible();
    await page.waitForTimeout(800);

    await page.evaluate(() => window.scrollTo(0, 76));
    await page.waitForTimeout(300);

    await shot(page, 'banner-after-document-scroll');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    await expect(page.getByRole('heading', { name: 'BubblyChef' })).toBeInViewport();
    expect(await gapAboveNav(page)).toBeLessThanOrEqual(1);
  });

  test('Jump to latest is a bare pill: no wrapper band, list height unchanged', async ({ page }) => {
    await stub(page);
    await page.goto('/chat');
    await expect(page.getByText('Answer 10:').first()).toBeInViewport();
    await page.waitForTimeout(1000);

    const list = page.locator('div.overflow-y-auto').first();
    const listHeight = (await list.boundingBox()).height;

    await page.mouse.move(206, 400);
    await page.mouse.wheel(0, -1500);
    const pill = page.getByTestId('jump-to-latest');
    await expect(pill).toBeVisible();

    await shot(page, 'jump-pill');
    // Floating: it is out of flow, so showing it does not shrink the list.
    expect(await pill.evaluate((el) => getComputedStyle(el).position)).toBe('absolute');
    expect((await list.boundingBox()).height).toBe(listHeight);

    // No band: nothing between the pill and the list paints a background or
    // spans the width.
    const wrapper = await pill.evaluate((el) => {
      const p = el.parentElement;
      const cs = getComputedStyle(p);
      return { bg: cs.backgroundColor, border: cs.borderTopWidth, width: p.getBoundingClientRect().width };
    });
    expect(wrapper.bg).toBe('rgba(0, 0, 0, 0)');
    expect(wrapper.border).toBe('0px');

    // Still tappable.
    await pill.click();
    await expect(pill).toHaveCount(0);
  });
});
