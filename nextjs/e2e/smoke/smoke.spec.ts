/**
 * Smoke suite — runs after every merge against production and (per
 * docs/plans/2026-09-17-autonomous-agent-loop.md step 7) triggers an
 * automatic revert on failure. Small and stable over broad: a flaky test
 * here is worse than a missing one, so every assertion below is scoped to
 * "the feature runs" rather than "the feature is exactly right" — AI output is
 * never asserted on, only that it is not the canned "AI unavailable" reply
 * (section f, e2e/support/ai-unavailable.ts).
 *
 * Run with: npx playwright test e2e/smoke
 *
 * Auth: reuses e2e/global-setup.ts (TEST_USERNAME / TEST_PASSWORD), the same
 * mechanism every other e2e spec uses — see fixtures/auth.ts.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../fixtures/auth';
import { AI_UNAVAILABLE_COPY, assertChatReplyIsNotAiUnavailable } from '../support/ai-unavailable';

// ---------------------------------------------------------------------------
// (a) + (b) + (d) — sign-in reuse, pantry loads, recipes loads
// ---------------------------------------------------------------------------

test.describe('smoke — navigation', () => {
  test('signed-in session lands on the kitchen, pantry loads, recipes loads', async ({ page }) => {
    // (a) Sign-in: fixtures/auth's storageState (from global-setup) already
    // authenticated us. Landing on '/' without a login redirect is the proof.
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
    // The dashboard renders Bubbles more than once (nav avatar + hero), so scope
    // this to the first match — the assertion is "the dashboard mounted", not
    // "there is exactly one mascot".
    await expect(page.getByAltText(/Bubbles/).first()).toBeVisible();

    // (b) The pantry loads through the kitchen (the Pantry tab went, #750): tap
    // the fridge, flip to List. The "Add to the fridge" key is present
    // regardless of how many items the shared test account currently holds,
    // unlike any item-count-dependent text.
    await page.getByRole('button', { name: /^Fridge/ }).click();
    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.getByRole('button', { name: 'Add to the fridge' })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: 'Close' }).click();

    // (d) Recipes page loads. "Import recipe from URL" is present whether the
    // library is empty or full — unlike anything keyed to a specific recipe.
    await page.getByRole('link', { name: 'Recipes' }).click();
    await expect(page).toHaveURL(/\/recipes/);
    await expect(page.getByRole('button', { name: 'Import recipe from URL' })).toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// (c) — add a pantry item via the real UI, then delete it
// ---------------------------------------------------------------------------

test.describe('smoke — pantry add/delete', () => {
  test('add a pantry item through the Manual tab, then delete it', async ({ page }) => {
    // Clearly-marked, timestamp-unique name — self-cleaning even if a run
    // gets interrupted before the delete step, a leftover is unmistakably a
    // smoke-test artifact and safe to remove by hand.
    const itemName = `smoke-${Date.now()}`;

    // ?add=type opens the Add sheet straight to the manual-entry tab (mirrors
    // ?add=scan in receipt-ingestion.spec.ts — see HeroHome's `add`
    // param handling; /pantry?add=type redirects to /?add=type).
    await page.goto('/pantry?add=type');
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();

    await page.getByLabel('Item name').fill(itemName);
    await page.getByRole('button', { name: /Add 1 Item/ }).click();

    // Sheet closes on success.
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).not.toBeVisible({ timeout: 10_000 });

    // Item shows up in the grid. titleCase() capitalizes the leading letter,
    // so match case-insensitively rather than assuming exact casing.
    const itemCard = page.getByText(new RegExp(itemName, 'i'));
    await expect(itemCard).toBeVisible({ timeout: 10_000 });

    // Delete it: clicking the card opens the single-item edit modal, which has
    // a two-step delete confirm (AddItemModal.tsx).
    await itemCard.click();
    await expect(page.getByRole('heading', { name: 'Edit Item' })).toBeVisible();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm Delete' }).click();

    await expect(page.getByRole('heading', { name: 'Edit Item' })).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(new RegExp(itemName, 'i'))).not.toBeVisible({ timeout: 10_000 });
  });
});

// ---------------------------------------------------------------------------
// (e) — health checks on both services
// ---------------------------------------------------------------------------

// A real commit SHA, not the health endpoints' own "unknown" fallback (which
// both return when nothing set the SHA — a config gap must fail loud here,
// not read as "healthy").
const FULL_GIT_SHA = /^[0-9a-f]{40}$/i;

test.describe('smoke — health', () => {
  test('GET /api/health reports a sha', async ({ request, baseURL }) => {
    const res = await request.get(`${baseURL}/api/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // Frontend health shape: { sha, ... } — see nextjs/src/app/api/health/route.ts.
    expect(body.sha).toMatch(FULL_GIT_SHA);
  });

  test('ai-service GET /health reports version.git_sha', async ({ request }) => {
    const aiServiceUrl = process.env.AI_SERVICE_URL || 'http://127.0.0.1:8888';
    const res = await request.get(`${aiServiceUrl}/health`);
    expect(res.status()).toBe(200);
    const body = await res.json();
    // ai-service health shape: { status, version: { git_sha, app_version } } —
    // see ai-service/bubbly_chef/main.py::build_info(). Distinct field name
    // and nesting from the frontend's — do not conflate the two.
    expect(body.version?.git_sha).toMatch(FULL_GIT_SHA);
  });
});

// ---------------------------------------------------------------------------
// (f) — one AI round trip. Never assert on reply content (model-dependent) —
// only that a reply arrived, with no error state, and that it is NOT the
// canned "AI unavailable" reply (issue #773): with the ai-service up but its
// model unreachable the stream still answers 200 with that canned text, which
// a bare "some reply arrived" check cannot tell from an answer.
// ---------------------------------------------------------------------------

/**
 * Send one chat message through the real UI and run every "the AI path works"
 * check. Throws when the reply is the AI-unavailable one. `streamReply` is
 * captured from the network (`/v1/chat/stream`), so the same function checks
 * the live service and, with `page.route`, a stubbed stream.
 *
 * `expectStreamingState: false` is for stubbed streams: a stub is fulfilled in
 * one shot, so the transient Stop button can come and go between Playwright's
 * polls. Skipping it there keeps the stubbed tests deterministic (a flake in
 * the smoke project auto-reverts a merge); the live test keeps the check.
 */
async function sendChatMessageAndExpectRealReply(
  page: Page,
  { expectStreamingState = true }: { expectStreamingState?: boolean } = {},
): Promise<void> {
  await page.goto('/chat');

  const input = page.getByLabel('Message Bubbles');
  await expect(input).toBeVisible({ timeout: 10_000 });
  await input.fill('What can I make with pasta?');

  const streamReply = page.waitForResponse((res) => res.url().includes('/v1/chat/stream'));
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  if (expectStreamingState) {
    // Streaming starts (Send becomes Stop) ...
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 10_000 });
  }
  // ... and finishes (Stop reverts to Send). Generous timeout: against the live
  // service this is a real LLM call.
  await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 60_000 });

  // An assistant message arrived...
  const assistantBubble = page.getByTestId('chat-message-assistant').last();
  await expect(assistantBubble).toBeVisible();
  // Auto-waits for text: without the Stop-button check (stubs), Send can read as
  // visible just before the first render of the reply.
  await expect(assistantBubble).toHaveText(/\S/);
  const content = (await assistantBubble.textContent()) ?? '';
  expect(content.trim().length).toBeGreaterThan(0);

  // ...and it is not the client's own injected failure message (useChat.ts —
  // the "Oops! Something went wrong" fallback on a non-2xx/network error)...
  expect(content).not.toMatch(/Oops! Something went wrong/);

  // ...nor the service's canned "AI unavailable" reply (PR #736).
  assertChatReplyIsNotAiUnavailable(await (await streamReply).text(), content);
}

test.describe('smoke — AI round trip', () => {
  test('sending a chat message gets a reply with no error', async ({ page }) => {
    await sendChatMessageAndExpectRealReply(page);
  });
});

// ---------------------------------------------------------------------------
// Pins for (f): the same check, with /v1/chat/stream stubbed through
// page.route (no model call), must FAIL on an AI-unavailable reply and PASS
// on a normal one. Without these, (f) could rot back into "some reply arrived".
// ---------------------------------------------------------------------------

function envelopeStream(assistantMessage: string, metadata: Record<string, unknown> = {}): string {
  const envelope = {
    request_id: 'smoke-stub-req',
    workflow_id: 'smoke-stub-workflow',
    conversation_id: 'smoke-stub-conv',
    intent: 'general_chat',
    assistant_message: assistantMessage,
    proposal: null,
    confidence: { overall: 1 },
    requires_review: false,
    next_action: 'none',
    metadata,
  };
  return `event: envelope
data: ${JSON.stringify({ type: 'envelope', data: envelope })}

`;
}

async function stubChatStream(page: Page, body: string): Promise<void> {
  await page.route('**/v1/chat/stream', (route) =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body }),
  );
}

// Fails loudly if the copy is reworded, instead of stubbing `undefined` and
// breaking the tests below with a confusing message.
function authUnavailableText(): string {
  const text = AI_UNAVAILABLE_COPY.find((copy) => copy.includes("can't sign in"));
  if (!text) {
    throw new Error('No "can\'t sign in" entry in AI_UNAVAILABLE_COPY; update this stub after a copy change.');
  }
  return text;
}

// A stub is fulfilled in one shot, so skip the transient Stop-button check.
const STUBBED = { expectStreamingState: false };

test.describe('smoke — AI round trip check (stubbed stream)', () => {
  test('passes on a normal reply', async ({ page }) => {
    await stubChatStream(page, envelopeStream('Try a garlic and olive oil spaghetti.', { follow_ups_pending: false }));
    await sendChatMessageAndExpectRealReply(page, STUBBED);
  });

  test('fails on the AI-unavailable reply (canned text + ai_error_kind)', async ({ page }) => {
    await stubChatStream(page, envelopeStream(authUnavailableText(), { ai_error_kind: 'auth' }));
    await expect(sendChatMessageAndExpectRealReply(page, STUBBED)).rejects.toThrow(/AI unavailable/);
  });

  test('fails on ai_error_kind alone, whatever the reply text says', async ({ page }) => {
    await stubChatStream(page, envelopeStream('Something reworded.', { ai_error_kind: 'quota_exhausted' }));
    await expect(sendChatMessageAndExpectRealReply(page, STUBBED)).rejects.toThrow(/ai_error_kind="quota_exhausted"/);
  });

  test('fails on the canned text alone, when the server sends no ai_error_kind', async ({ page }) => {
    await stubChatStream(page, envelopeStream(authUnavailableText()));
    await expect(sendChatMessageAndExpectRealReply(page, STUBBED)).rejects.toThrow(/canned AI-unavailable message/);
  });
});
