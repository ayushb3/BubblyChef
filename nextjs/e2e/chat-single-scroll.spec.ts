/**
 * Issue #731 — /chat has exactly one scroll container: the message list.
 *
 * Before: the page was `h-screen` plus the layout's `pb-20`, so the document
 * was 80px taller than the viewport. A long conversation showed two scrollbars,
 * and scrolling the page carried the header off the top while the composer
 * (position: fixed) stayed put.
 *
 * The chat stream and history are stubbed with page.route(), so this makes no
 * model call. Layout needs a real browser, which is why this is e2e rather than
 * a jsdom test.
 */

// @ts-nocheck
// NOTE: @ts-nocheck matches the other specs — '@playwright/test' has no type
// declarations in this repo yet (issue #149). Do NOT fix here.
import { test, expect } from './fixtures/auth';

const turns = Array.from({ length: 30 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content:
    i % 2 === 0
      ? `Question ${i / 2 + 1}: what can I make with eggs and spinach?`
      : `Answer ${(i + 1) / 2}: try a spinach omelette. Whisk the eggs, wilt the spinach, fold it in and serve warm.`,
  intent: i % 2 === 0 ? null : 'cooking_question',
  created_at: new Date(Date.now() - (30 - i) * 60_000).toISOString(),
}));

async function stubChat(page, { seeded }) {
  await page.route('**/v1/chat/history/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(turns) }),
  );
  await page.route('**/v1/chat/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.addInitScript((seed) => {
    if (seed) localStorage.setItem('bubblychef:chat:conversationId', 'e2e-731');
    else localStorage.removeItem('bubblychef:chat:conversationId');
  }, seeded);
}

const pageScrolls = (page) =>
  page.evaluate(() => document.scrollingElement.scrollHeight > window.innerHeight);

test.describe('chat scrolls in one place only (#731)', () => {
  test('a 30-message conversation: the page does not scroll, the header and composer stay put', async ({ page }) => {
    await stubChat(page, { seeded: true });
    await page.goto('/chat');
    // The newest turn is in view: the list opened scrolled to the bottom (the
    // smooth scroll-to-end has finished, so it cannot fight the wheel below).
    await expect(page.getByText('Answer 15:').first()).toBeInViewport();
    await page.waitForTimeout(1000);

    expect(await pageScrolls(page)).toBe(false);

    const header = page.getByRole('heading', { name: 'BubblyChef' });
    const composer = page.getByLabel('Message Bubbly');
    const headerTop = (await header.boundingBox()).y;
    const composerTop = (await composer.boundingBox()).y;

    // Wheel over the header (not the list): nothing may move.
    await page.mouse.move(100, 30);
    await page.mouse.wheel(0, 600);
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect((await header.boundingBox()).y).toBe(headerTop);

    // Wheel over the list: the list scrolls, the page and the chrome do not.
    const viewport = page.viewportSize();
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, -4000);
    await expect(page.getByText('Question 1:').first()).toBeInViewport();
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect((await header.boundingBox()).y).toBe(headerTop);
    expect((await composer.boundingBox()).y).toBe(composerTop);
  });

  test('the empty state fits the viewport with no page scroll', async ({ page }) => {
    await stubChat(page, { seeded: false });
    await page.goto('/chat');
    await expect(page.getByLabel('Message Bubbly')).toBeVisible();

    expect(await pageScrolls(page)).toBe(false);
  });
});
