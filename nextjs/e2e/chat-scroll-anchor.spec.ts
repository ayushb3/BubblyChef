/**
 * Issue #811 — a new chat reply is anchored to the top of the screen.
 *
 * Before: every messages/isStreaming change called scrollIntoView on the end of
 * the thread, so a meal-options reply (taller than the screen) left the reader
 * at the END of it, with the first card scrolled off the top.
 *
 * Now: sending a message scrolls so that message sits near the top of the
 * thread and the reply streams in below it. The follow/stop decision itself is
 * unit-tested (src/__tests__/chat-scroll.test.ts); layout needs a real browser,
 * which is why this is e2e. The chat stream, history and health are stubbed with
 * page.route(), so this makes no model call.
 */

// @ts-nocheck
// NOTE: @ts-nocheck matches the other specs — '@playwright/test' has no type
// declarations in this repo yet (issue #149). Do NOT fix here.
import { test, expect } from './fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

const history = Array.from({ length: 12 }, (_, i) => ({
  role: i % 2 === 0 ? 'user' : 'assistant',
  content:
    i % 2 === 0
      ? `Question ${i / 2 + 1}: what can I make with eggs and spinach?`
      : `Answer ${(i + 1) / 2}: try a spinach omelette. Whisk the eggs, wilt the spinach, fold it in and serve warm.`,
  intent: i % 2 === 0 ? null : 'cooking_help',
  created_at: new Date(Date.now() - (12 - i) * 60_000).toISOString(),
}));

const option = (n, title) => ({
  option_id: `opt-${n}`,
  title,
  blurb: 'A cosy plate that leans on what is already in the fridge.',
  dishes: [
    { role: 'main', name: `${title} main`, key_ingredients: ['eggs', 'spinach'], est_total_minutes: 30, est_hands_on_minutes: 15 },
    { role: 'side', name: `${title} side`, key_ingredients: ['bread'], est_total_minutes: 10, est_hands_on_minutes: 5 },
  ],
  est_total_minutes: 35,
  est_hands_on_minutes: 18,
  coverage: { pantry_items_used: 4, to_buy: ['lemon'] },
  rescues: [],
});

const mealOptionsEnvelope = {
  request_id: 'req-811',
  workflow_id: 'wf-811',
  conversation_id: 'e2e-811',
  intent: 'meal_plan',
  assistant_message: 'Here are three dinners from your pantry. Tap one to build it.',
  proposal: {
    proposal_type: 'meal_options',
    options: [option(1, 'Spinach frittata night'), option(2, 'Eggs Florentine plate'), option(3, 'Green shakshuka supper')],
    servings: 2,
    constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
  },
  confidence: { overall: 0.9 },
  requires_review: false,
  next_action: 'pick_meal',
  metadata: null,
};

const sse = (tokens) =>
  [
    ...tokens.map((t) => `event: token\ndata: ${JSON.stringify({ type: 'token', content: t })}\n\n`),
    `event: envelope\ndata: ${JSON.stringify({ type: 'envelope', data: mealOptionsEnvelope })}\n\n`,
  ].join('');

async function stubChat(page, { seeded, tokens = 12 }) {
  await page.route('**/health/ai', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai_available: true }) }),
  );
  await page.route('**/v1/chat/history/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(history) }),
  );
  await page.route('**/v1/chat/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  await page.route('**/v1/chat/stream', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse(Array.from({ length: tokens }, (_, i) => (i === 0 ? 'Here ' : 'are '))),
    }),
  );
  await page.addInitScript((seed) => {
    if (seed) localStorage.setItem('bubblychef:chat:conversationId', 'e2e-811');
    else localStorage.removeItem('bubblychef:chat:conversationId');
  }, seeded);
}

const send = async (page, text) => {
  await page.getByLabel('Message Bubbly').fill(text);
  await page.getByRole('button', { name: 'Send' }).click();
};

/** Distance of an element's top from the top of the scrolling thread. */
const topWithinThread = (page, locator) =>
  locator.evaluate((el) => {
    const scroller = el.closest('.overflow-y-auto');
    return el.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  });

test.describe('chat anchors a new reply to the top (#811)', () => {
  test('a meal-options reply: the sent message is at the top, the first card is in view, the pill brings you to the end', async ({ page }) => {
    await stubChat(page, { seeded: true });
    await page.goto('/chat');
    // Opening a saved conversation lands at the bottom, with no pill.
    await expect(page.getByText('Answer 6:').first()).toBeInViewport();
    await page.waitForTimeout(500);
    await expect(page.getByTestId('jump-to-latest')).toHaveCount(0);

    await send(page, 'What is for dinner tonight?');
    const sent = page.getByText('What is for dinner tonight?').first();
    const firstCard = page.getByText('Spinach frittata night').first();
    await expect(firstCard).toBeVisible();
    await page.waitForTimeout(1200); // smooth scroll settles

    // The sent message sits near the top of the thread, the reply below it.
    const sentTop = await topWithinThread(page, sent);
    expect(sentTop).toBeGreaterThanOrEqual(0);
    expect(sentTop).toBeLessThan(40);
    await expect(firstCard).toBeInViewport();
    // The reply is taller than the screen, so its end is below: the pill shows.
    await expect(page.getByTestId('jump-to-latest')).toBeVisible();

    await page.getByTestId('jump-to-latest').click();
    await expect(page.getByText('Green shakshuka supper').first()).toBeInViewport();
    await expect(page.getByTestId('jump-to-latest')).toHaveCount(0);
  });

  test('scrolling during the stream stops all auto-scrolling for that turn', async ({ page }) => {
    await stubChat(page, { seeded: true, tokens: 60 }); // ~1.2s of tokens at 20ms each
    await page.goto('/chat');
    await expect(page.getByText('Answer 6:').first()).toBeInViewport();
    await page.waitForTimeout(500);

    await send(page, 'What is for dinner tonight?');
    const sent = page.getByText('What is for dinner tonight?').first();
    await expect(sent).toBeInViewport();
    await page.waitForTimeout(900); // anchored by now, still streaming

    await page.mouse.move(195, 400);
    await page.mouse.wheel(0, -250);
    await page.waitForTimeout(200);
    const before = await topWithinThread(page, sent);
    expect(before).toBeGreaterThan(150); // the wheel moved it down the screen

    await expect(page.getByText('Spinach frittata night').first()).toBeVisible(); // reply finished
    await page.waitForTimeout(500);
    expect(Math.abs((await topWithinThread(page, sent)) - before)).toBeLessThan(2);
  });

  test('New Chat after an anchored reply returns to a clean empty state with no pill', async ({ page }) => {
    await stubChat(page, { seeded: true });
    await page.goto('/chat');
    await expect(page.getByText('Answer 6:').first()).toBeInViewport();
    await send(page, 'What is for dinner tonight?');
    await expect(page.getByText('Spinach frittata night').first()).toBeVisible();
    await page.waitForTimeout(1200);
    await expect(page.getByTestId('jump-to-latest')).toBeVisible();

    await page.getByRole('button', { name: 'New Chat' }).click();
    await expect(page.getByText('Chat with Bubbly')).toBeVisible();
    await expect(page.getByTestId('jump-to-latest')).toHaveCount(0);
  });
});
