/**
 * Guest walkthrough e2e — issue #518.
 *
 * Proves a truly fresh, cookie-less visitor can do the whole app: land on
 * the dashboard without being pushed to /login, add a pantry item that
 * survives a reload, save a recipe that survives a reload, chat and get a
 * reply, and load every other core route without an error boundary, a 401,
 * or a redirect to /login. All of it runs on one anonymous Supabase user
 * (`auth.signInAnonymously()`, wired in `lib/supabase/middleware.ts`), whose
 * `auth.users` row this spec deletes again in `afterAll` so the hosted
 * project doesn't collect throwaway guests.
 *
 * Deliberately NOT `fixtures/auth` — that fixture pins the pre-authenticated
 * storageState from global-setup.ts. This spec needs the opposite: zero
 * cookies, so middleware takes the `sign-in-anonymously` branch on the very
 * first request. Same override `e2e/auth.spec.ts` uses for the same reason.
 *
 * AI calls (recipe import, chat) are stubbed via page.route — this spec
 * proves the guest *flow*, not AI output, matching the stubbing style in
 * e2e/receipt-ingestion.spec.ts. The recipe *save* itself is a real
 * POST /api/recipes so it's a genuine DB write under the guest's RLS-scoped
 * UID — that's what proves persistence.
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import * as dotenv from 'dotenv';
import path from 'path';
import type { ChatResponse } from '../src/types/chat';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });

test.use({ storageState: { cookies: [], origins: [] } });

// ---------------------------------------------------------------------------
// Guest UID capture + cleanup
// ---------------------------------------------------------------------------

/**
 * Decode a JWT's payload without verifying it — this only ever reads a
 * token this same browser context was just issued by our own Supabase
 * project, so there's nothing to verify against; we just need `sub`.
 */
function decodeJwtSub(accessToken: string): string | null {
  try {
    const payload = accessToken.split('.')[1];
    const json = Buffer.from(payload, 'base64').toString('utf-8');
    const parsed = JSON.parse(json) as { sub?: string };
    return parsed.sub ?? null;
  } catch {
    return null;
  }
}

/**
 * Read the anonymous session's user id from the auth cookie Playwright's
 * context holds. Same cookie name global-setup.ts computes
 * (`sb-<project-ref>-auth-token`) — @supabase/ssr's middleware wrote it on
 * the very first request via the `signInAnonymously()` branch.
 */
async function readGuestUid(context: BrowserContext): Promise<string | null> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) return null;
  const projectRef = new URL(supabaseUrl).hostname.split('.')[0];
  const cookieName = `sb-${projectRef}-auth-token`;

  const cookies = await context.cookies();
  const cookie = cookies.find((c) => c.name === cookieName);
  if (!cookie) return null;

  // @supabase/ssr's browser cookie is `base64-<base64 of the JSON session>`,
  // not raw JSON (global-setup.ts's own cookie is a special case: it writes
  // raw JSON by hand for the *pre-authenticated* fixture, which the SDK
  // still reads fine either way — but a real signInAnonymously() session
  // written by the SDK itself always uses the base64- prefix).
  const value = cookie.value;
  const candidates = value.startsWith('base64-')
    ? [Buffer.from(value.slice('base64-'.length), 'base64').toString('utf-8')]
    : [value, decodeURIComponent(value)];

  let session: { access_token?: string } | [string] | null = null;
  for (const candidate of candidates) {
    try {
      session = JSON.parse(candidate);
      break;
    } catch {
      // try the next candidate
    }
  }
  if (!session) return null;

  const accessToken = Array.isArray(session) ? session[0] : session.access_token;
  if (!accessToken) return null;
  return decodeJwtSub(accessToken);
}

let guestUid: string | null = null;

test.afterAll(async () => {
  if (!guestUid) return;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    console.warn(
      `[guest-walkthrough] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY — ` +
        `could not delete guest user ${guestUid}. Clean up by hand.`,
    );
    return;
  }
  const admin = createClient(supabaseUrl, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await admin.auth.admin.deleteUser(guestUid);
  if (error) {
    console.warn(`[guest-walkthrough] Failed to delete guest user ${guestUid}: ${error.message}`);
  }
});

// ---------------------------------------------------------------------------
// Chat SSE stub — minimal ChatResponse, typed against the real shape so
// tsc --noEmit catches a drift between this stub and types/chat.ts.
// ---------------------------------------------------------------------------

const ASSISTANT_STUB_MESSAGE = 'Guest walkthrough stub reply — pasta sounds great!';

const CHAT_RESPONSE_STUB: ChatResponse = {
  request_id: 'e2e-guest-req',
  workflow_id: 'e2e-guest-workflow',
  conversation_id: 'e2e-guest-conv',
  intent: 'general_chat',
  assistant_message: ASSISTANT_STUB_MESSAGE,
  proposal: null,
  confidence: { overall: 1 },
  requires_review: false,
  next_action: 'none',
};

function chatStreamStubBody(): string {
  return `event: envelope\ndata: ${JSON.stringify({ type: 'envelope', data: CHAT_RESPONSE_STUB })}\n\n`;
}

// ---------------------------------------------------------------------------
// Recipe import stub — a fixed RecipeCard-shaped payload. No live AI call.
// ---------------------------------------------------------------------------

const IMPORT_URL = 'https://www.allrecipes.com/recipe/e2e-guest-stub';
const IMPORTED_TITLE = `Guest Walkthrough Stub Recipe ${Date.now()}`;

const IMPORTED_RECIPE_STUB = {
  title: IMPORTED_TITLE,
  description: 'A stubbed recipe for the guest walkthrough e2e.',
  ingredients: [{ name: 'Pasta', quantity: 1, unit: 'box' }],
  instructions: ['Boil water.', 'Cook pasta.', 'Serve.'],
  prep_time_minutes: 5,
  cook_time_minutes: 10,
  servings: 2,
};

test.describe('guest walkthrough (issue #518)', () => {
  test('a fresh guest can pantry-add, save a recipe, chat, and load every core route', async ({ page, context }) => {
    // ── 1. Landing — no login redirect, dashboard mounted ──────────────────
    await page.goto('/');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByAltText(/Bubbles/).first()).toBeVisible();

    guestUid = await readGuestUid(context);
    expect(guestUid, 'Expected an anonymous Supabase session cookie after landing on /').not.toBeNull();

    // ── 2. Pantry add (Manual tab), then reload — same UID keeps the item ──
    // Mirrors e2e/smoke/smoke.spec.ts's "add a pantry item through the
    // Manual tab" flow, minus the delete step.
    const itemName = `guest-e2e-${Date.now()}`;

    await page.goto('/pantry?add=type');
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();
    await page.getByLabel('Item name').fill(itemName);
    await page.getByRole('button', { name: /Add 1 Item/ }).click();
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).not.toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(new RegExp(itemName, 'i'))).toBeVisible({ timeout: 10_000 });

    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(new RegExp(itemName, 'i'))).toBeVisible({ timeout: 10_000 });

    // ── 3. Save a recipe via the import flow (stubbed fetch, real save) ────
    await page.route('**/api/recipes/import', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(IMPORTED_RECIPE_STUB),
      });
    });

    await page.goto('/recipes');
    await expect(page).not.toHaveURL(/\/login/);
    await page.getByRole('button', { name: 'Import recipe from URL' }).click();
    await expect(page.getByRole('heading', { name: /Import from URL/ })).toBeVisible();
    await page.getByPlaceholder(/https:\/\/www\.allrecipes\.com/).fill(IMPORT_URL);
    await page.getByRole('button', { name: 'Import', exact: true }).click();

    // RecipeImportModal hands off to RecipeEditModal (review/edit before the
    // real save) pre-filled with the stubbed title. The Title field has no
    // programmatic <label> association in RecipeEditModal.tsx (plain text
    // label, no htmlFor/aria-labelledby), so getByLabel can't find it —
    // scope to the dialog and take the first text input instead.
    const editDialog = page.getByRole('dialog', { name: 'Edit Recipe' });
    await expect(editDialog).toBeVisible({ timeout: 10_000 });
    await expect(editDialog.locator('input[type="text"]').first()).toHaveValue(IMPORTED_TITLE);

    // Real POST /api/recipes — not stubbed. This is the write that proves
    // persistence for this guest's UID.
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'Edit Recipe' })).not.toBeVisible({ timeout: 10_000 });

    await page.goto('/recipes');
    await page.reload();
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(IMPORTED_TITLE)).toBeVisible({ timeout: 10_000 });

    // Capture the saved recipe's id for the /recipes/[id] sweep step below —
    // read it back from the list endpoint rather than parsing internal state.
    const listRes = await page.request.get('/api/recipes');
    expect(listRes.ok()).toBeTruthy();
    const listBody = await listRes.json();
    const savedRecipes: Array<{ id: string; title: string }> = Array.isArray(listBody)
      ? listBody
      : (listBody.recipes ?? listBody.items ?? []);
    const savedRecipe = savedRecipes.find((r) => r.title === IMPORTED_TITLE);
    expect(savedRecipe, 'Expected the imported recipe to be findable via GET /api/recipes').toBeTruthy();
    const savedRecipeId = savedRecipe!.id;

    // ── 4. Chat — stubbed SSE, a reply renders, no error state ─────────────
    await page.route('**/v1/chat/stream', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'text/event-stream',
        body: chatStreamStubBody(),
      });
    });

    await page.goto('/chat');
    await expect(page).not.toHaveURL(/\/login/);
    const chatInput = page.getByLabel('Message Bubbles');
    await expect(chatInput).toBeVisible({ timeout: 10_000 });
    await chatInput.fill('What can I make with pasta?');
    await page.getByRole('button', { name: 'Send', exact: true }).click();

    const assistantBubble = page.getByTestId('chat-message-assistant').last();
    await expect(assistantBubble).toContainText(ASSISTANT_STUB_MESSAGE, { timeout: 10_000 });
    await expect(page.getByText(/Oops! Something went wrong/)).toHaveCount(0);

    // ── 5. Sweep the remaining core routes ──────────────────────────────────
    // Each: not redirected to /login, no visible error-boundary/"Something
    // went wrong" text, plus one page-specific "it rendered" landmark.
    await page.goto('/profile');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
    // Guest-only content: the persistent save-account section (issue #393),
    // visible for a guest without collapse/dismiss affordances.
    await expect(page.getByText(/Save your account/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('Dietary Preferences')).toBeVisible();

    await page.goto('/scan');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
    await expect(page.getByText('Drop your receipt here')).toBeVisible({ timeout: 10_000 });

    await page.goto('/pantry/use-soon');
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Something went wrong/)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Use Soon' })).toBeVisible({ timeout: 10_000 });

    await page.goto(`/recipes/${savedRecipeId}`);
    await expect(page).not.toHaveURL(/\/login/);
    await expect(page.getByText(/Could not load recipe/)).toHaveCount(0);
    await expect(page.getByText('Recipe not found')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Edit with AI' })).toBeVisible({ timeout: 10_000 });
  });
});
