/**
 * Issue #847 — chat resume, Retry on a failed send, and the jump pill.
 *
 * Before: leaving chat after planning dinner and coming back showed the reply
 * text and chips but no option cards; a failed send ended in "Oops! Something
 * went wrong (Failed to fetch)" with only "Try another" / "Tell me more" and the
 * typed text gone; and the "Jump to latest" pill floated over the cards.
 *
 * The model is never called: everything under /v1/ is blocked, then the chat
 * stream, history and health are stubbed with page.route().
 */

// @ts-nocheck
// NOTE: @ts-nocheck matches the other specs — '@playwright/test' has no type
// declarations in this repo yet (issue #149). Do NOT fix here.
import { test, expect } from './fixtures/auth';

test.use({ viewport: { width: 390, height: 844 } });

const CONV = 'e2e-847';
const AT = new Date().toISOString();

const option = (n, title) => ({
  option_id: `opt-${n}`,
  title,
  blurb: 'A cosy plate that leans on what is already in the fridge.',
  dishes: [
    { role: 'main', name: `${title} main`, key_ingredients: ['eggs'], est_total_minutes: 30, est_hands_on_minutes: 15 },
    { role: 'side', name: `${title} side`, key_ingredients: ['bread'], est_total_minutes: 10, est_hands_on_minutes: 5 },
  ],
  est_total_minutes: 35,
  est_hands_on_minutes: 18,
  coverage: { pantry_items_used: 4, to_buy: ['lemon'] },
  rescues: [],
});

const optionsTurn = (titles) => ({
  role: 'assistant',
  content: 'Here are some dinners from your pantry. Tap one to build it.',
  intent: 'meal_plan',
  proposal: {
    proposal_type: 'meal_options',
    options: titles.map((t, i) => option(i + 1, t)),
    servings: 2,
    constraints: { kitchen_limits: [], exclusive_tags: [], recipe_constraints: {} },
  },
  metadata: { request_id: 'req-847' },
  created_at: AT,
});

const userTurn = (content) => ({ role: 'user', content, intent: null, created_at: AT });

const SET_A = ['Spinach frittata night', 'Eggs Florentine plate', 'Green shakshuka supper'];
const SET_B = ['Lemon chicken dinner', 'Sheet pan salmon'];

const okReply = (text) =>
  [
    `event: token\ndata: ${JSON.stringify({ type: 'token', content: text })}\n\n`,
    `event: envelope\ndata: ${JSON.stringify({
      type: 'envelope',
      data: {
        request_id: 'req-ok',
        workflow_id: '',
        conversation_id: CONV,
        intent: 'general_chat',
        assistant_message: text,
        proposal: null,
        confidence: { overall: 0.9 },
        requires_review: false,
        next_action: 'none',
        metadata: null,
      },
    })}\n\n`,
  ].join('');

async function stub(page, { history, stream }) {
  // Block every AI route first; Playwright runs the most recently registered
  // handler first, so the specific stubs below win and anything else is cut off.
  await page.route('**/v1/**', (route) => route.abort('blockedbyclient'));
  await page.route('**/health/ai', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ai_available: true }) }),
  );
  await page.route('**/v1/chat/history/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(history) }),
  );
  await page.route('**/v1/chat/sessions', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
  );
  const sent = [];
  await page.route('**/v1/chat/stream', async (route) => {
    sent.push(JSON.parse(route.request().postData() ?? '{}'));
    await stream(route, sent.length);
  });
  await page.addInitScript((id) => localStorage.setItem('bubblychef:chat:conversationId', id), CONV);
  return sent;
}

test.describe('chat resume, retry and jump pill (#847)', () => {
  test('resuming brings the unpicked option cards back, and a tap still picks by option id', async ({ page }) => {
    const sent = await stub(page, {
      history: [userTurn('plan dinner'), optionsTurn(SET_A)],
      stream: (route) =>
        route.fulfill({ status: 200, contentType: 'text/event-stream', body: okReply('Building it!') }),
    });
    await page.goto('/chat');

    const card = page.getByRole('listitem', { name: 'Pick Eggs Florentine plate' });
    await expect(card).toBeVisible();
    await expect(card).toBeEnabled();

    await card.click();
    await expect.poll(() => sent.length).toBe(1);
    expect(sent[0].message).toBe('Eggs Florentine plate');
    expect(sent[0].context).toEqual({ meal_option_id: 'opt-2' });
  });

  test('an older option set restores read-only; only the newest is tappable', async ({ page }) => {
    await stub(page, {
      history: [
        userTurn('plan dinner'),
        optionsTurn(SET_A),
        userTurn('Show me different meal options'),
        optionsTurn(SET_B),
      ],
      stream: (route) => route.abort('failed'),
    });
    await page.goto('/chat');

    await expect(page.getByRole('listitem', { name: 'Pick Lemon chicken dinner' })).toBeEnabled();
    const older = page.getByRole('listitem', { name: 'Pick Spinach frittata night' });
    await expect(older).toBeVisible();
    await expect(older).toBeDisabled();
  });

  test('a failed send offers Retry first, and Retry resends the identical text once', async ({ page }) => {
    const sent = await stub(page, {
      history: [userTurn('hello'), { role: 'assistant', content: 'Hi there!', intent: 'general_chat', created_at: AT }],
      stream: (route, n) =>
        n === 1
          ? route.abort('failed')
          : route.fulfill({ status: 200, contentType: 'text/event-stream', body: okReply('Here is dinner!') }),
    });
    await page.goto('/chat');
    await page.getByLabel('Message Bubbly').fill('plan dinner for two');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText(/Something went wrong/)).toBeVisible();
    await expect(page.getByRole('button', { name: /Try another/ })).toHaveCount(0);
    const retry = page.getByRole('button', { name: /Retry/ });
    await expect(retry).toBeVisible();

    await retry.click();
    await expect(page.getByText('Here is dinner!').first()).toBeVisible();
    expect(sent).toHaveLength(2);
    expect(sent[1].message).toBe('plan dinner for two');
    await expect(page.getByText('plan dinner for two')).toHaveCount(1);
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  });

  test('Dismiss on a failed send puts the text back in the input', async ({ page }) => {
    await stub(page, {
      history: [userTurn('hello'), { role: 'assistant', content: 'Hi there!', intent: 'general_chat', created_at: AT }],
      stream: (route) => route.abort('failed'),
    });
    await page.goto('/chat');
    await page.getByLabel('Message Bubbly').fill('plan dinner for two');
    await page.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText(/Something went wrong/)).toBeVisible();

    await page.getByRole('button', { name: /Dismiss/ }).click();
    await expect(page.getByLabel('Message Bubbly')).toHaveValue('plan dinner for two');
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
  });

  test('the jump pill sits between the thread and the input, never over a card', async ({ page }) => {
    await stub(page, {
      history: [userTurn('plan dinner'), optionsTurn(SET_A)],
      stream: (route) => route.abort('failed'),
    });
    await page.goto('/chat');
    await expect(page.getByRole('listitem', { name: 'Pick Eggs Florentine plate' })).toBeVisible();

    // Scroll up so the end of the thread is off screen and the pill shows.
    await page.locator('.overflow-y-auto').first().evaluate((el) => {
      el.scrollTop = el.scrollHeight / 3;
    });
    const pill = page.getByTestId('jump-to-latest');
    await expect(pill).toBeVisible();
    await page.waitForTimeout(400);

    const pillBox = await pill.boundingBox();
    const scrollBox = await page.locator('.overflow-y-auto').first().boundingBox();
    const inputBox = await page.getByLabel('Message Bubbly').boundingBox();
    // Not over the scrolling thread (and so not over any card in it) ...
    expect(pillBox.y).toBeGreaterThanOrEqual(scrollBox.y + scrollBox.height - 1);
    // ... and above the input, with clearance.
    expect(pillBox.y + pillBox.height).toBeLessThanOrEqual(inputBox.y);
    for (const title of SET_A) {
      const box = await page.getByRole('listitem', { name: `Pick ${title}` }).boundingBox();
      const overlaps =
        box.y < pillBox.y + pillBox.height &&
        box.y + box.height > pillBox.y &&
        box.x < pillBox.x + pillBox.width &&
        box.x + box.width > pillBox.x;
      expect(overlaps).toBe(false);
    }
  });
});
