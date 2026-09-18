/**
 * Smoke suite — runs after every merge against production and (per
 * docs/plans/2026-09-17-autonomous-agent-loop.md step 7) triggers an
 * automatic revert on failure. Small and stable over broad: a flaky test
 * here is worse than a missing one, so every assertion below is scoped to
 * "the feature runs" rather than "the feature is exactly right" — content,
 * copy and AI output are never asserted on.
 *
 * Run with: npx playwright test e2e/smoke
 *
 * Auth: reuses e2e/global-setup.ts (TEST_USERNAME / TEST_PASSWORD), the same
 * mechanism every other e2e spec uses — see fixtures/auth.ts.
 */
import { test, expect } from '../fixtures/auth';

// ---------------------------------------------------------------------------
// (a) + (b) + (d) — sign-in reuse, pantry loads, recipes loads
// ---------------------------------------------------------------------------

test.describe('smoke — navigation', () => {
  test('signed-in session lands on the dashboard, pantry loads, recipes loads', async ({ page }) => {
    // (a) Sign-in: fixtures/auth's storageState (from global-setup) already
    // authenticated us. Landing on '/' without a login redirect is the proof.
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
    // The dashboard renders Bubbles more than once (nav avatar + hero), so scope
    // this to the first match — the assertion is "the dashboard mounted", not
    // "there is exactly one mascot".
    await expect(page.getByAltText(/Bubbles/).first()).toBeVisible();

    // (b) Pantry page loads with its main UI. The "+ Add Item" FAB is present
    // regardless of how many items the shared test account currently holds,
    // unlike any item-count-dependent text.
    await page.getByRole('link', { name: 'Pantry' }).click();
    await expect(page).toHaveURL(/\/pantry/);
    await expect(page.getByRole('button', { name: '+ Add Item' })).toBeVisible({ timeout: 10_000 });

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
  test('add a pantry item through the Type tab, then delete it', async ({ page }) => {
    // Clearly-marked, timestamp-unique name — self-cleaning even if a run
    // gets interrupted before the delete step, a leftover is unmistakably a
    // smoke-test artifact and safe to remove by hand.
    const itemName = `smoke-${Date.now()}`;

    // ?add=type opens the Add sheet straight to the manual-entry tab (mirrors
    // ?add=scan in receipt-ingestion.spec.ts — see pantry/page.tsx's addParam
    // handling).
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
// (f) — one AI round trip. Never assert on content — only that a response
// arrived with no error state, per the smoke-suite scope in the plan doc.
// ---------------------------------------------------------------------------

test.describe('smoke — AI round trip', () => {
  test('sending a chat message gets a reply with no error', async ({ page }) => {
    await page.goto('/chat');

    const input = page.getByLabel('Message Bubbles');
    await expect(input).toBeVisible({ timeout: 10_000 });
    await input.fill('What can I make with pasta?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    // Streaming starts (Send becomes Stop) ...
    await expect(page.getByRole('button', { name: 'Stop', exact: true })).toBeVisible({ timeout: 10_000 });
    // ... and finishes (Stop reverts to Send). Generous timeout: this is a
    // real LLM call, not a stub.
    await expect(page.getByRole('button', { name: 'Send', exact: true })).toBeVisible({ timeout: 60_000 });

    // An assistant message arrived...
    const assistantBubble = page.getByTestId('chat-message-assistant').last();
    await expect(assistantBubble).toBeVisible();
    const content = (await assistantBubble.textContent()) ?? '';
    expect(content.trim().length).toBeGreaterThan(0);

    // ...and it is not the client's own injected failure message (useChat.ts —
    // the "Oops! Something went wrong" fallback on a non-2xx/network error).
    expect(content).not.toMatch(/Oops! Something went wrong/);
  });
});
