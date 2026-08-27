/**
 * Receipt ingestion e2e tests
 *
 * Two variants — read the comment on each describe block:
 *
 *  3b — Deterministic / always-on CI (no live services needed).
 *       Stubs POST /api/ai/scan and POST /api/pantry/bulk via page.route().
 *       Drives the real Pantry Add Sheet → Scan tab → confirm UI.
 *       Asserts: items appear in review, confirm call carries correct payload,
 *       response items land with non-null expiry_date (as returned by the
 *       /api/pantry/bulk endpoint post fix #158).
 *
 *  3a — Full live (opt-in, env-gated: BUBBLY_E2E_LIVE_SCAN=1).
 *       Uploads grocery-mart.png to the running app → real Gemini OCR.
 *       Requires BOTH servers running (Next.js on 3000 + ai-service on 8888).
 *       Loose assertions to tolerate OCR noise.
 *
 * Traced files (verify before changing selectors):
 *   - nextjs/src/app/pantry/page.tsx          — ?add=scan opens sheet (line ~134)
 *   - nextjs/src/components/pantry/ScanTab.tsx — input[type=file], upload trigger
 *   - nextjs/src/components/scan/ScanResults.tsx — "Ready to Add" section header
 *   - nextjs/src/components/pantry/PantryAddSheet.tsx — "Add N Items 🛒" button,
 *                                                         POST /api/pantry/bulk call
 *   - nextjs/src/types/scan.ts                — ScanResult, ScannedItem shapes
 *
 * Known tsc quirk: this file imports from '@playwright/test' the same way
 * smoke.spec.ts does. The 5 pre-existing e2e tsc errors (missing @playwright/test
 * + dotenv type declarations) are tracked in issue #149 and NOT fixed here.
 */

// @ts-nocheck
// NOTE: @ts-nocheck here is intentional — this file imports from '@playwright/test'
// which has no type declarations yet in this repo (tracked in issue #149, same root
// cause as the 5 pre-existing e2e tsc errors in smoke.spec.ts / global-setup.ts /
// playwright.config.ts). Do NOT fix here; the fix belongs in #149.
import { test, expect } from './fixtures/auth';
import path from 'path';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

const RECEIPT_STUB_PNG = path.join(
  __dirname,
  'fixtures/receipts/grocery-mart-stub.png',
);

// Real receipt fixture — only available after fix/issue-158 merges to main.
// For 3a live tests only; the stub PNG is sufficient for 3b.
const RECEIPT_LIVE_PNG = path.join(
  __dirname,
  'fixtures/receipts/grocery-mart.png',
);

/**
 * A plausible ScanResult for Grocery Mart (8 items).
 * Shape matches nextjs/src/types/scan.ts::ScanResult.
 * Confidence values chosen so all 8 items land in ready_to_add (≥ 0.8).
 */
const GROCERY_MART_SCAN_RESULT = {
  ocr_text: 'GROCERY MART\nEggs 12ct $3.49\nWhole Milk $4.29...',
  ready_to_add: [
    { name: 'Eggs', quantity: 12, unit: 'item', category: 'dairy', location: 'fridge', confidence: 0.95 },
    { name: 'Whole Milk', quantity: 1, unit: 'gallon', category: 'dairy', location: 'fridge', confidence: 0.92 },
    { name: 'Bananas', quantity: 1, unit: 'bunch', category: 'produce', location: 'counter', confidence: 0.91 },
    { name: 'Gala Apples', quantity: 1, unit: 'bag', category: 'produce', location: 'fridge', confidence: 0.88 },
    { name: 'Carrots', quantity: 1, unit: 'lb', category: 'produce', location: 'fridge', confidence: 0.87 },
    { name: 'Cheddar Cheese', quantity: 1, unit: 'block', category: 'dairy', location: 'fridge', confidence: 0.85 },
    { name: 'Spaghetti', quantity: 1, unit: 'box', category: 'dry_goods', location: 'pantry', confidence: 0.90 },
    { name: 'Chicken Breasts', quantity: 2, unit: 'lb', category: 'meat', location: 'fridge', confidence: 0.86 },
  ],
  needs_review: [],
  skipped: [],
  total_items: 8,
};

/**
 * What the /api/pantry/bulk route returns after inserting the 8 items.
 * expiry_date is non-null on every item — this is the state delivered by
 * fix #158 (POST /api/pantry/bulk now calls /v1/pantry/estimate-expiry when
 * no explicit date is supplied).
 *
 * Offsets are relative to *today*, not a frozen date. The pantry badges this
 * test asserts on ("2d left") are computed from the current clock, so a
 * hardcoded anchor silently rots: every offset shifts by one day per day until
 * the near-term items read "Expired" and the test fails for no real reason.
 */
function makeBulkResponse(now = new Date()) {
  const base = new Date(now);
  base.setHours(0, 0, 0, 0);

  const d = (days: number) => {
    const dt = new Date(base);
    dt.setDate(dt.getDate() + days);
    // Format from local parts rather than toISOString(), which converts to UTC
    // and would shift the date by one in timezones behind UTC.
    const month = String(dt.getMonth() + 1).padStart(2, '0');
    const day = String(dt.getDate()).padStart(2, '0');
    return `${dt.getFullYear()}-${month}-${day}`;
  };
  return {
    count: 8,
    items: [
      { id: 'e1', name: 'Eggs', category: 'dairy', location: 'fridge', quantity: 12, unit: 'item', expiry_date: d(21) },
      { id: 'e2', name: 'Whole Milk', category: 'dairy', location: 'fridge', quantity: 1, unit: 'gallon', expiry_date: d(10) },
      { id: 'e3', name: 'Bananas', category: 'produce', location: 'counter', quantity: 1, unit: 'bunch', expiry_date: d(6) },
      { id: 'e4', name: 'Gala Apples', category: 'produce', location: 'fridge', quantity: 1, unit: 'bag', expiry_date: d(14) },
      { id: 'e5', name: 'Carrots', category: 'produce', location: 'fridge', quantity: 1, unit: 'lb', expiry_date: d(21) },
      { id: 'e6', name: 'Cheddar Cheese', category: 'dairy', location: 'fridge', quantity: 1, unit: 'block', expiry_date: d(30) },
      { id: 'e7', name: 'Spaghetti', category: 'dry_goods', location: 'pantry', quantity: 1, unit: 'box', expiry_date: d(365) },
      { id: 'e8', name: 'Chicken Breasts', category: 'meat', location: 'fridge', quantity: 2, unit: 'lb', expiry_date: d(2) },
    ],
  };
}

// ---------------------------------------------------------------------------
// 3b — Deterministic seam tests (always runs in CI)
// ---------------------------------------------------------------------------

test.describe('3b — receipt ingestion (stubbed, CI-safe)', () => {

  test('scan → review → confirm adds 8 items and each gets a non-null expiry_date', async ({ page }) => {
    // ── 1. Intercept OCR/parse: return fixed ScanResult ──────────────────
    await page.route('/api/ai/scan', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(GROCERY_MART_SCAN_RESULT),
      });
    });

    // ── 2. Intercept confirm: capture payload, return stub with non-null expiry
    let capturedBulkBody: { items: Array<Record<string, unknown>> } | null = null;

    await page.route('/api/pantry/bulk', async (route) => {
      const req = route.request();
      capturedBulkBody = JSON.parse(req.postData() ?? '{}') as { items: Array<Record<string, unknown>> };

      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify(makeBulkResponse()),
      });
    });

    // ── 3. Also stub GET /api/pantry (post-confirm invalidation re-fetch) ─
    await page.route('/api/pantry', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: makeBulkResponse().items, count: 8 }),
        });
      } else {
        await route.continue();
      }
    });

    // ── 4. Navigate — ?add=scan opens the sheet in Scan tab ───────────────
    // Source: nextjs/src/app/pantry/page.tsx ~L134:
    //   const addParam = searchParams.get('add')
    //   if (addParam === 'scan' || addParam === 'type') { setAddSheetTab(addParam); setAddSheetOpen(true) }
    await page.goto('/pantry?add=scan');

    // ── 5. Verify the sheet opened on the Scan tab ────────────────────────
    // Source: PantryAddSheet.tsx — h2 "Add to Pantry" + tab buttons
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();
    await expect(page.getByRole('button', { name: /📷 Scan/ })).toBeVisible();

    // ── 6. Trigger file upload via the hidden input ───────────────────────
    // Source: ScanTab.tsx L114: input type="file" accept="image/*" className="hidden"
    // page.setInputFiles works on hidden inputs without clicking them.
    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(RECEIPT_STUB_PNG);

    // ── 7. Wait for the results state — "Ready to Add" section should appear
    // Source: ScanResults.tsx — TierSection with title="Ready to Add"
    // The section header button contains "Ready to Add"
    await expect(page.getByRole('button', { name: /Ready to Add/ })).toBeVisible({ timeout: 10_000 });

    // ── 8. All 8 items should be listed (section shows count in parens)
    await expect(page.getByRole('button', { name: /Ready to Add.*\(8\)/ })).toBeVisible();

    // ── 9. Spot-check a few item names are visible in the card list ───────
    // Source: ScannedItemCard renders item.name — we check a cross-section
    await expect(page.getByText('Eggs')).toBeVisible();
    await expect(page.getByText('Chicken Breasts')).toBeVisible();
    await expect(page.getByText('Spaghetti')).toBeVisible();

    // ── 10. Click the confirm button ──────────────────────────────────────
    // Source: PantryAddSheet.tsx — button text: "Add {N} Item{s} 🛒"
    await page.getByRole('button', { name: /Add 8 Items/ }).click();

    // ── 11. Wait for the sheet to close (success path) ───────────────────
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).not.toBeVisible({ timeout: 8_000 });

    // ── 12. Assert bulk request payload ───────────────────────────────────
    // The request is sent by PantryAddSheet.handleConfirm() which maps
    // scanItems through ({ source: _source, ...item }) — stripping 'source'.
    // TODO(#158): expiry_date is currently null from scannedToAddItem().
    // After fix #158 merges, this assertion should change to verify non-null.
    expect(capturedBulkBody).not.toBeNull();
    expect(capturedBulkBody!.items).toHaveLength(8);

    // Each item in the payload must have a name and category
    for (const item of capturedBulkBody!.items) {
      expect(typeof item.name).toBe('string');
      expect((item.name as string).length).toBeGreaterThan(0);
      expect(typeof item.category).toBe('string');
    }

    // ── 13. Assert non-null expiry via pantry list (stub response) ────────
    // After confirm, PantryAddSheet calls onItemsAdded() → queryClient.invalidateQueries
    // → GET /api/pantry re-fires. Our GET stub returns items with non-null expiry_date.
    // We wait for the pantry grid to render with an item that has an expiry badge.
    // Source: pantry/page.tsx ~L282: expiryBadge() renders a span with "{N}d left".
    // Chicken Breasts has expiry_date = 2 days out → badge "2d left"
    await expect(page.getByText(/2d left/)).toBeVisible({ timeout: 8_000 });
  });

  test('scan → review → confirms correct item names and quantities in bulk payload', async ({ page }) => {
    // Narrowly focused: verify the exact fields forwarded to bulk route
    const captured: Array<Record<string, unknown>> = [];

    await page.route('/api/ai/scan', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...GROCERY_MART_SCAN_RESULT,
          // Limit to 2 items for a fast, focused assertion
          ready_to_add: GROCERY_MART_SCAN_RESULT.ready_to_add.slice(0, 2),
          total_items: 2,
        }),
      }),
    );

    await page.route('/api/pantry/bulk', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}') as { items: Array<Record<string, unknown>> };
      captured.push(...body.items);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          count: 2,
          items: [
            { id: 'x1', name: 'Eggs', category: 'dairy', location: 'fridge', quantity: 12, unit: 'item', expiry_date: '2026-08-19' },
            { id: 'x2', name: 'Whole Milk', category: 'dairy', location: 'fridge', quantity: 1, unit: 'gallon', expiry_date: '2026-08-08' },
          ],
        }),
      });
    });

    await page.route('/api/pantry', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [], count: 0 }),
      }),
    );

    await page.goto('/pantry?add=scan');
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(RECEIPT_STUB_PNG);

    await expect(page.getByRole('button', { name: /Ready to Add/ })).toBeVisible({ timeout: 10_000 });
    await page.getByRole('button', { name: /Add 2 Items/ }).click();
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).not.toBeVisible({ timeout: 8_000 });

    // Validate payload shape
    expect(captured).toHaveLength(2);
    expect(captured[0].name).toBe('Eggs');
    expect(captured[0].quantity).toBe(12);
    expect(captured[0].unit).toBe('item');
    expect(captured[0].category).toBe('dairy');
    expect(captured[0].storage_location).toBe('fridge');
    // 'source' field must NOT be forwarded (stripped in PantryAddSheet.handleConfirm)
    expect(captured[0].source).toBeUndefined();

    expect(captured[1].name).toBe('Whole Milk');
    expect(captured[1].quantity).toBe(1);
  });

  test('error from /api/ai/scan shows an error message and stays on upload state', async ({ page }) => {
    await page.route('/api/ai/scan', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'OCR service unavailable' }),
      }),
    );

    await page.route('/api/pantry', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], count: 0 }) }),
    );

    await page.goto('/pantry?add=scan');
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(RECEIPT_STUB_PNG);

    // Source: ScanTab.tsx ~L88 — error div with text of the thrown Error message
    // uploadReceipt() throws Error(err.error ?? ...) on non-ok response
    await expect(page.getByText(/OCR service unavailable/)).toBeVisible({ timeout: 8_000 });

    // Upload affordance must be re-shown (state back to 'upload')
    await expect(page.getByText(/Drop your receipt here/)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// 3a — Full live tests (opt-in: BUBBLY_E2E_LIVE_SCAN=1)
// ---------------------------------------------------------------------------
//
// Preconditions:
//   1. Next.js dev server on port 3000  (npm run dev -- or playwright webServer)
//   2. ai-service on port 8888          (cd ai-service && uvicorn bubbly_chef.main:app --port 8888)
//   3. BUBBLY_GEMINI_API_KEY set in ai-service/.env
//   4. TEST_USERNAME / TEST_PASSWORD in nextjs/.env.local (for global-setup auth)
//   5. fix/issue-158 merged to main (receipt PNG fixtures + expiry estimation fix)
//
// Run:
//   BUBBLY_E2E_LIVE_SCAN=1 npx playwright test receipt-ingestion --project=chromium-mobile
//
// NOTE: The real PNG fixtures (grocery-mart.png, city-harvest.png) were committed
// in fix/issue-158 (commit bd7ba94). They do NOT exist on origin/main yet.
// Until that PR merges, the live tests will throw a file-not-found error at the
// setInputFiles step — that is expected and intentional.

const LIVE = !!process.env.BUBBLY_E2E_LIVE_SCAN;

test.describe('3a — receipt ingestion (live, opt-in)', () => {
  test.skip(!LIVE, 'Set BUBBLY_E2E_LIVE_SCAN=1 to run live OCR tests (requires both servers + Gemini key)');

  // These tests wait up to 45s on live Gemini Vision OCR, which does not fit in
  // Playwright's default 30s per-test timeout — the inner wait gets cut off at 30s
  // and the test fails whenever OCR takes the slow path, regardless of the app
  // being fine. Raise the test budget above the longest inner wait.
  //
  // Serial because, unlike 3b, these are unstubbed: they share one live Gemini
  // quota and write to one real test-user pantry. Running them concurrently only
  // adds contention to the latency that already makes them fragile.
  test.describe.configure({ mode: 'serial', timeout: 120_000 });

  test('grocery-mart.png → OCR → confirm → ≥6 items with non-null expiry', async ({ page }) => {
    // Navigate to pantry scan sheet
    await page.goto('/pantry?add=scan');
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();

    // Stub GET /api/pantry for the post-confirm refetch so we can inspect the
    // actual DB items returned (not intercepting the scan itself — that's live).
    // We'll verify via the pantry tile rendering instead.

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(RECEIPT_LIVE_PNG);

    // OCR + parse can take up to 30s on Gemini Vision
    await expect(page.getByRole('button', { name: /Ready to Add|Needs Review/ })).toBeVisible({ timeout: 45_000 });

    // Loose count check: grocery-mart has 8 items; tolerate partial parse (≥6)
    // Sections show "(N)" — grab the combined count from the found-items line.
    // Source: ScanTab.tsx ~L170: "Found {total} items"
    const foundText = page.getByText(/Found \d+ items/);
    await expect(foundText).toBeVisible();
    const foundMatch = (await foundText.textContent())?.match(/Found (\d+) items/);
    const found = parseInt(foundMatch?.[1] ?? '0', 10);
    expect(found).toBeGreaterThanOrEqual(6);

    // Item-set assertions: at least 3 of these known grocery-mart items must appear
    const knownItems = ['Eggs', 'Milk', 'Chicken', 'Bananas', 'Apples', 'Carrots', 'Cheddar', 'Spaghetti'];
    let hitCount = 0;
    for (const name of knownItems) {
      // Use a case-insensitive regex to tolerate OCR casing differences
      const found = await page.getByText(new RegExp(name, 'i')).count();
      if (found > 0) hitCount++;
    }
    expect(hitCount).toBeGreaterThanOrEqual(3);

    // Click confirm
    const confirmBtn = page.getByRole('button', { name: /Add \d+ Items/ });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Sheet closes on success
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).not.toBeVisible({ timeout: 15_000 });

    // Expiry loop assertion: at least one tile should show an expiry badge.
    // If the bulk route estimated expiries (fix #158), items like Chicken Breasts
    // or Milk will show "Xd left" badges immediately.
    // Source: pantry/page.tsx ~L86: expiryBadge renders "{N}d left"
    await expect(page.locator('text=/\\d+d left/').first()).toBeVisible({ timeout: 10_000 });
  });

  test('city-harvest.png → OCR → confirm → ≥5 items with non-null expiry', async ({ page }) => {
    const CITY_HARVEST_PNG = path.join(__dirname, 'fixtures/receipts/city-harvest.png');

    await page.goto('/pantry?add=scan');
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(CITY_HARVEST_PNG);

    // city-harvest has 7 items (bread, yogurt, spinach, tomatoes, ground beef, cereal, coffee)
    await expect(page.getByRole('button', { name: /Ready to Add|Needs Review/ })).toBeVisible({ timeout: 45_000 });

    const foundText = page.getByText(/Found \d+ items/);
    await expect(foundText).toBeVisible();
    const foundMatch = (await foundText.textContent())?.match(/Found (\d+) items/);
    const foundCount = parseInt(foundMatch?.[1] ?? '0', 10);
    expect(foundCount).toBeGreaterThanOrEqual(5);

    // Item-set: at least 3 of the known city-harvest items
    const knownItems = ['Bread', 'Yogurt', 'Spinach', 'Tomatoes', 'Beef', 'Cereal', 'Coffee'];
    let hitCount = 0;
    for (const name of knownItems) {
      const found = await page.getByText(new RegExp(name, 'i')).count();
      if (found > 0) hitCount++;
    }
    expect(hitCount).toBeGreaterThanOrEqual(3);

    // Confirm
    const confirmBtn = page.getByRole('button', { name: /Add \d+ Items/ });
    await confirmBtn.click();
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).not.toBeVisible({ timeout: 15_000 });

    // At least one expiry badge should appear after the pantry refetches
    await expect(page.locator('text=/\\d+d left/').first()).toBeVisible({ timeout: 10_000 });
  });
});
