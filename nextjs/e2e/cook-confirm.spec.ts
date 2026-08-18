/**
 * Cook-confirm e2e tests — the "Yes, I cooked this" path.
 *
 * PR #221 fixed a data-corruption bug in `deduct_pantry_item`: `deduct_qty`
 * always arrives in an item's *base* unit, but when a row had no
 * `quantity_base` the base amount was subtracted straight from the *display*
 * quantity, so `2 kg rice − 100 g` computed `max(0, 2 - 100) = 0` and destroyed
 * the whole row. Every row on the live account has `quantity_base = NULL`
 * (#224), so that was the default path, not an edge case.
 *
 * The arithmetic is unit-tested in ai-service/tests/test_pantry_deduction.py.
 * What was never exercised is the button that triggers it — #221 records this
 * as out of scope: "the confirm button is still not exercised by the demo",
 * because confirming deducts real stock. These tests close that gap.
 *
 * Two variants — read the comment on each describe block:
 *
 *  4b — Deterministic / always-on CI (no live services needed).
 *       Stubs POST /api/ai/recipes/cook and POST /api/ai/recipes/cook/confirm
 *       via page.route(). Drives the real RecipeBook → CookModal → confirm UI.
 *       Asserts the *client contract*: which matches become deductions, that
 *       they carry the proposal's base unit, that rows sharing one pantry item
 *       are summed, and that unit_conflict overrides are honoured.
 *
 *       These cannot fail on the pre-#221 server, because the bug was in
 *       Python. They lock the payload the fixed server depends on receiving.
 *
 *  4a — Full live (opt-in, env-gated: BUBBLY_E2E_LIVE_COOK=1).
 *       Creates its own pantry row and recipe, cooks through the real UI, then
 *       reads the row back. This is the variant that actually reproduces the
 *       corruption: it asserts a mass deduction against a NULL-base row leaves
 *       stock proportionally reduced rather than zeroed. Gated because it
 *       mutates real pantry data — it creates and deletes its own row rather
 *       than touching existing stock.
 *
 *       Confirmed non-vacuous by replaying it against the pre-fix ai-service,
 *       one half at a time:
 *         - Whole of #221 reverted: the row never reaches "Ready" — it reads
 *           "Unit conflict", so the conversion half is what the mid-test
 *           assertion catches.
 *         - Only `supabase_repo.py` reverted (conversion fix kept): the flow
 *           runs to completion and the final read returns `quantity = 0` —
 *           the corruption itself, reproduced live and caught.
 *
 * Traced files (verify before changing selectors):
 *   - nextjs/src/components/recipes/RecipeBookLoader.tsx — GET /api/recipes → { recipes: [] }
 *   - nextjs/src/components/recipes/RecipeBook.tsx       — button aria-label "Cook this recipe"
 *   - nextjs/src/components/recipes/CookModal.tsx        — heading "Mark as cooked",
 *                                                          "Yes, I cooked this", "Pantry updated!",
 *                                                          handleConfirm() payload construction
 *   - nextjs/src/lib/api/recipes.ts                      — cookRecipe / confirmCook endpoints
 *   - nextjs/src/types/recipes.ts                        — CookProposal, IngredientMatch, DeductionItem
 */

// @ts-nocheck
// NOTE: @ts-nocheck matches receipt-ingestion.spec.ts — '@playwright/test' has no
// type declarations in this repo yet (issue #149). Do NOT fix here.
import { test, expect } from './fixtures/auth';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const RECIPE_ID = 'e2e-cook-recipe-1';

/** Minimal Recipe shape — see RecipePage.tsx::Recipe. */
const STUB_RECIPE = {
  id: RECIPE_ID,
  user_id: 'e2e-user',
  title: 'E2E Rice Bowl',
  description: 'Fixture recipe for the cook-confirm path.',
  ingredients: ['100 g basmati rice', '20 g butter'],
  instructions: ['Cook the rice.', 'Stir in the butter.'],
  servings: 2,
  created_at: '2026-01-01T00:00:00Z',
};

/** One IngredientMatch, with the fields CookModal actually reads. */
function match(overrides = {}) {
  return {
    ingredient_name: 'basmati rice',
    ingredient_qty: 100,
    ingredient_unit: 'g',
    pantry_item_id: 'pantry-rice',
    pantry_item_name: 'Basmati Rice',
    pantry_qty_available: 2000,
    deduct_qty: 100,
    base_unit: 'g',
    status: 'ready',
    shortfall: null,
    match_type: 'exact',
    substitution_note: null,
    ...overrides,
  };
}

function proposal(matches, missing = []) {
  return {
    recipe_id: RECIPE_ID,
    recipe_title: STUB_RECIPE.title,
    matches,
    missing,
    unit_conflicts: [],
  };
}

/**
 * Stubs GET /api/recipes and POST /api/ai/recipes/cook, and captures the
 * confirm payload. Returns a getter for what confirm received — null until the
 * request fires.
 *
 * `confirmStatus` lets a test drive the failure path.
 */
async function stubCookFlow(page, cookProposal, confirmStatus = 200) {
  let captured = null;

  await page.route('/api/recipes', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ recipes: [STUB_RECIPE] }),
      });
    } else {
      await route.continue();
    }
  });

  await page.route('/api/ai/recipes/cook', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(cookProposal),
    });
  });

  await page.route('/api/ai/recipes/cook/confirm', async (route) => {
    captured = JSON.parse(route.request().postData() ?? '{}');
    await route.fulfill({
      status: confirmStatus,
      contentType: 'application/json',
      body:
        confirmStatus === 200
          ? JSON.stringify({ ok: true })
          : JSON.stringify({ error: 'Deduction failed upstream' }),
    });
  });

  return () => captured;
}

/**
 * Opens the recipe book and the cook modal.
 *
 * RecipeBook renders the cook button twice (the mobile and desktop layouts both
 * mount), so this scopes to the first — the assertion is "the cook affordance is
 * reachable", not "there is exactly one".
 */
async function openCookModal(page) {
  await page.goto('/recipes');
  await expect(page.getByText('E2E Rice Bowl').first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Cook this recipe' }).first().click();
  await expect(page.getByRole('heading', { name: 'Mark as cooked' })).toBeVisible();
}

// ---------------------------------------------------------------------------
// 4b — Deterministic seam tests (always runs in CI)
// ---------------------------------------------------------------------------

test.describe('4b — cook confirm (stubbed, CI-safe)', () => {
  test('confirm sends one base-unit deduction per matched row and reports success', async ({ page }) => {
    const captured = await stubCookFlow(
      page,
      proposal([
        match(),
        match({
          ingredient_name: 'butter',
          ingredient_qty: 20,
          ingredient_unit: 'g',
          pantry_item_id: 'pantry-butter',
          pantry_item_name: 'Butter',
          pantry_qty_available: 250,
          deduct_qty: 20,
        }),
      ]),
    );

    await openCookModal(page);

    // The proposal rendered before anything is written — nothing has been
    // deducted at this point.
    //
    // Scoped to the table cell: the ingredient name, the pantry name, and the
    // recipe's own ingredient line all contain this text, and getByText matches
    // case-insensitively on a substring, so a bare getByText resolves to three
    // elements and trips strict mode. The cell role plus exact is the only
    // locator here that means "the pantry match column".
    await expect(page.getByRole('cell', { name: 'Basmati Rice', exact: true })).toBeVisible();
    await expect(page.getByRole('cell', { name: 'Butter', exact: true })).toBeVisible();
    expect(captured()).toBeNull();

    await page.getByRole('button', { name: 'Yes, I cooked this' }).click();

    await expect(page.getByText('Pantry updated!')).toBeVisible({ timeout: 8_000 });

    const body = captured();
    expect(body).not.toBeNull();
    expect(body.recipe_id).toBe(RECIPE_ID);
    expect(body.deductions).toHaveLength(2);

    const byId = Object.fromEntries(body.deductions.map((d) => [d.pantry_item_id, d]));
    expect(byId['pantry-rice'].deduct_qty).toBe(100);
    // The base unit must ride along — the server applies deduct_qty in this
    // unit, and guessing it is exactly how stock got wiped before #221.
    expect(byId['pantry-rice'].base_unit).toBe('g');
    expect(byId['pantry-butter'].deduct_qty).toBe(20);
    expect(byId['pantry-butter'].base_unit).toBe('g');

    // Success hands off to chat with this recipe as context (issue #122).
    await expect(page).toHaveURL(new RegExp(`/chat\\?cooking=${RECIPE_ID}`), { timeout: 8_000 });
  });

  test('two recipe lines on one pantry row are summed into a single deduction', async ({ page }) => {
    // CookModal.handleConfirm() collapses these deliberately: the server applies
    // each entry as a read-modify-write, so emitting two would deduct twice.
    const captured = await stubCookFlow(
      page,
      proposal([
        match({ ingredient_name: 'cheddar', pantry_item_id: 'pantry-cheese', pantry_item_name: 'Cheese', deduct_qty: 30 }),
        match({ ingredient_name: 'parmesan', pantry_item_id: 'pantry-cheese', pantry_item_name: 'Cheese', deduct_qty: 45 }),
      ]),
    );

    await openCookModal(page);
    await page.getByRole('button', { name: 'Yes, I cooked this' }).click();
    await expect(page.getByText('Pantry updated!')).toBeVisible({ timeout: 8_000 });

    const body = captured();
    expect(body.deductions).toHaveLength(1);
    expect(body.deductions[0].pantry_item_id).toBe('pantry-cheese');
    expect(body.deductions[0].deduct_qty).toBe(75);
  });

  test('missing rows and un-overridden unit conflicts contribute no deduction', async ({ page }) => {
    const captured = await stubCookFlow(
      page,
      proposal(
        [
          match(),
          // A conflict the user leaves blank must not become a silent zero-qty
          // entry, and must never be guessed at.
          match({
            ingredient_name: 'baby spinach',
            pantry_item_id: 'pantry-spinach',
            pantry_item_name: 'Baby Spinach',
            deduct_qty: null,
            base_unit: null,
            status: 'unit_conflict',
          }),
          // status 'missing' is skipped outright, even with a pantry id attached.
          match({
            ingredient_name: 'lemon juice',
            pantry_item_id: 'pantry-lemon',
            pantry_item_name: 'Lemon',
            deduct_qty: 5,
            status: 'missing',
          }),
        ],
        ['black pepper'],
      ),
    );

    await openCookModal(page);
    await expect(page.getByText('Unit conflict')).toBeVisible();
    await expect(page.getByText('black pepper')).toBeVisible();

    await page.getByRole('button', { name: 'Yes, I cooked this' }).click();
    await expect(page.getByText('Pantry updated!')).toBeVisible({ timeout: 8_000 });

    const body = captured();
    expect(body.deductions).toHaveLength(1);
    expect(body.deductions[0].pantry_item_id).toBe('pantry-rice');
  });

  test('a typed unit-conflict override is sent as the deduction', async ({ page }) => {
    const captured = await stubCookFlow(
      page,
      proposal([
        match({
          ingredient_name: 'baby spinach',
          pantry_item_id: 'pantry-spinach',
          pantry_item_name: 'Baby Spinach',
          deduct_qty: null,
          base_unit: null,
          status: 'unit_conflict',
        }),
      ]),
    );

    await openCookModal(page);

    await page.getByLabel('Deduct quantity for baby spinach').fill('0.5');
    await page.getByRole('button', { name: 'Yes, I cooked this' }).click();
    await expect(page.getByText('Pantry updated!')).toBeVisible({ timeout: 8_000 });

    const body = captured();
    expect(body.deductions).toHaveLength(1);
    expect(body.deductions[0].deduct_qty).toBe(0.5);
    // No base unit was derivable for this row, so the modal falls back to 'item'.
    expect(body.deductions[0].base_unit).toBe('item');
  });

  test('a failed confirm surfaces the error and does not navigate away', async ({ page }) => {
    await stubCookFlow(page, proposal([match()]), 500);

    await openCookModal(page);
    await page.getByRole('button', { name: 'Yes, I cooked this' }).click();

    await expect(page.getByText(/Deduction failed upstream/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText('Pantry updated!')).not.toBeVisible();
    await expect(page).toHaveURL(/\/recipes/);
  });
});

// ---------------------------------------------------------------------------
// 4a — Full live tests (opt-in: BUBBLY_E2E_LIVE_COOK=1)
// ---------------------------------------------------------------------------
//
// Preconditions:
//   1. Next.js dev server on port 3000 (playwright webServer handles this)
//   2. ai-service on port 8888  (cd ai-service && uvicorn bubbly_chef.main:app --port 8888)
//   3. TEST_USERNAME / TEST_PASSWORD in nextjs/.env.local (for global-setup auth)
//
// Run:
//   BUBBLY_E2E_LIVE_COOK=1 npx playwright test cook-confirm --project=chromium-mobile
//
// This test writes to the real test-user pantry. It creates and deletes its own
// row and recipe rather than touching existing stock, and cleans up in a finally
// block so a mid-test failure does not leave fixtures behind.

const LIVE = !!process.env.BUBBLY_E2E_LIVE_COOK;

test.describe('4a — cook confirm (live, opt-in)', () => {
  test.skip(!LIVE, 'Set BUBBLY_E2E_LIVE_COOK=1 to run the live deduction test (requires both servers)');

  // Serial: unstubbed, sharing one real pantry. Concurrency only adds contention.
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test('deducting 100 g from a 2 kg row reduces it proportionally instead of zeroing it', async ({ page }) => {
    // The pre-#221 bug in full: the row is created through the Next.js CRUD
    // route, which never populates quantity_base (#224). A 100 g deduction
    // against `2 kg` then computed `max(0, 2 - 100)` and destroyed the stock.
    const itemRes = await page.request.post('/api/pantry', {
      data: {
        name: 'E2E Deduction Rice',
        quantity: 2,
        unit: 'kg',
        category: 'dry_goods',
        storage_location: 'pantry',
      },
    });
    expect(itemRes.ok()).toBeTruthy();
    const item = await itemRes.json();

    const recipeRes = await page.request.post('/api/recipes', {
      data: {
        title: 'E2E Deduction Probe',
        ingredients: [{ name: 'E2E Deduction Rice', quantity: 100, unit: 'g' }],
        instructions: ['Cook it.'],
        servings: 1,
      },
    });
    expect(recipeRes.ok()).toBeTruthy();
    const recipe = await recipeRes.json();

    try {
      await page.goto('/recipes');
      await expect(page.getByText('E2E Deduction Probe').first()).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Cook this recipe' }).first().click();

      await expect(page.getByRole('heading', { name: 'Mark as cooked' })).toBeVisible();
      // The matcher must resolve g against a kg row at all — that is the
      // conversion half of #221. Without it this row reads "Unit conflict" and
      // the deduction never happens.
      await expect(page.getByText('E2E Deduction Rice')).toBeVisible({ timeout: 20_000 });
      await expect(page.getByText('Ready')).toBeVisible();

      await page.getByRole('button', { name: 'Yes, I cooked this' }).click();
      await expect(page.getByText('Pantry updated!')).toBeVisible({ timeout: 20_000 });

      const afterRes = await page.request.get(`/api/pantry/${item.id}`);
      expect(afterRes.ok()).toBeTruthy();
      const after = await afterRes.json();

      // The assertion that fails on pre-#221 ai-service: stock survives.
      expect(after.quantity).toBeGreaterThan(0);
      // 100 g off 2 kg leaves 1.9 kg. Tolerance covers rounding in the
      // proportional display rescale, not a different answer.
      expect(after.quantity).toBeGreaterThan(1.85);
      expect(after.quantity).toBeLessThan(1.95);
    } finally {
      await page.request.delete(`/api/pantry/${item.id}`);
      await page.request.delete(`/api/recipes/${recipe.id}`);
    }
  });
});
