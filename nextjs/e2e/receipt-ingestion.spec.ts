/**
 * Receipt ingestion e2e tests
 *
 * Two variants — read the comment on each describe block:
 *
 *  3b — Deterministic / always-on CI (no live services needed).
 *       Stubs POST /api/ai/scan and POST /api/pantry/bulk via page.route().
 *       Drives the real Pantry Add Sheet -> Scan tab -> hand-off to the kitchen
 *       home -> put-away sheet (issue #753). Asserts: nothing is written until
 *       "Put away N items", and the bulk call carries the right payload.
 *
 *  3a — Full live (opt-in, env-gated: BUBBLY_E2E_LIVE_SCAN=1).
 *       Uploads grocery-mart.png to the running app → real Gemini OCR.
 *       Requires BOTH servers running (Next.js on 3000 + ai-service on 8888).
 *       Loose assertions to tolerate OCR noise.
 *
 * Traced files (verify before changing selectors):
 *   - nextjs/src/components/dashboard/HeroHome.tsx — /?add=scan opens the add sheet
 *                                                    (/pantry?add=scan redirects there, #750)
 *   - nextjs/src/components/pantry/ScanTab.tsx — input[type=file], upload trigger
 *   - nextjs/src/components/kitchen/PutAwaySheet.tsx - "Put away N items" key,
 *                                                      POST /api/pantry/bulk call
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
  // Issue #753: a scan no longer reviews and confirms inside the add sheet. The
  // parsed scan is handed to the kitchen home, whose put-away sheet is the
  // review, and its "Put away N items" tap is the only write.

  async function stubPantryReads(page) {
    await page.route('**/api/pantry', async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ items: [], count: 0 }),
        });
      } else {
        await route.continue();
      }
    });
    await page.route('**/api/pantry/expiring*', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ items: [], count: 0 }) }),
    );
  }

  test('scan hands off to the kitchen; nothing is written until "Put away"', async ({ page }) => {
    await page.route('**/api/ai/scan', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(GROCERY_MART_SCAN_RESULT) }),
    );
    await stubPantryReads(page);

    let capturedBulkBody: { items: Array<Record<string, unknown>> } | null = null;
    await page.route('**/api/pantry/bulk', async (route) => {
      capturedBulkBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(makeBulkResponse()) });
    });

    await page.goto('/pantry?add=scan');
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(RECEIPT_STUB_PNG);

    // Handed to the kitchen home, where the put-away sheet opens.
    await expect(page).toHaveURL(/\/$/, { timeout: 10_000 });
    const sheet = page.getByTestId('put-away-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByText('Put the shopping away?')).toBeVisible();
    await expect(sheet.getByRole('group', { name: /Fridge, 6 items/ })).toBeVisible();
    await expect(sheet.getByText('Nothing goes in until you tap this.')).toBeVisible();

    // Nothing has been written yet.
    expect(capturedBulkBody).toBeNull();

    await sheet.getByRole('button', { name: 'Put away 8 items' }).click();
    await expect(sheet).not.toBeVisible({ timeout: 8_000 });

    expect(capturedBulkBody).not.toBeNull();
    expect(capturedBulkBody!.items).toHaveLength(8);
    for (const item of capturedBulkBody!.items) {
      expect(typeof item.name).toBe('string');
      expect((item.name as string).length).toBeGreaterThan(0);
      expect(typeof item.category).toBe('string');
    }
  });

  test('the put-away carries each item name, quantity and place to the bulk route', async ({ page }) => {
    const captured: Array<Record<string, unknown>> = [];

    await page.route('**/api/ai/scan', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...GROCERY_MART_SCAN_RESULT,
          ready_to_add: GROCERY_MART_SCAN_RESULT.ready_to_add.slice(0, 2),
          total_items: 2,
        }),
      }),
    );
    await stubPantryReads(page);
    await page.route('**/api/pantry/bulk', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      captured.push(...body.items);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ count: 2, items: makeBulkResponse().items.slice(0, 2) }),
      });
    });

    await page.goto('/pantry?add=scan');
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(RECEIPT_STUB_PNG);

    const sheet = page.getByTestId('put-away-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await sheet.getByRole('button', { name: 'Put away 2 items' }).click();
    await expect(sheet).not.toBeVisible({ timeout: 8_000 });

    expect(captured).toHaveLength(2);
    expect(captured[0].name).toBe('Eggs');
    expect(captured[0].quantity).toBe(12);
    expect(captured[0].unit).toBe('item');
    expect(captured[0].category).toBe('dairy');
    expect(captured[0].storage_location).toBe('fridge');
    expect(captured[0].source).toBe('scan');
    expect(captured[1].name).toBe('Whole Milk');
    expect(captured[1].quantity).toBe(1);
  });

  test('lines the scan was unsure about stay out until answered Yes', async ({ page }) => {
    const captured: Array<Record<string, unknown>> = [];
    const unsure = (name: string) => ({
      name, quantity: 1, unit: 'item', category: 'other', location: 'pantry', confidence: 0.6,
    });

    await page.route('**/api/ai/scan', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ...GROCERY_MART_SCAN_RESULT,
          ready_to_add: GROCERY_MART_SCAN_RESULT.ready_to_add.slice(0, 3),
          needs_review: [unsure('Org Cane Sugar'), unsure('Chdr Blk')],
          total_items: 5,
        }),
      }),
    );
    await stubPantryReads(page);
    await page.route('**/api/pantry/bulk', async (route) => {
      const body = JSON.parse(route.request().postData() ?? '{}');
      captured.push(...body.items);
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ count: body.items.length, items: makeBulkResponse().items.slice(0, 3) }),
      });
    });

    await page.goto('/pantry?add=scan');
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(RECEIPT_STUB_PNG);

    const sheet = page.getByTestId('put-away-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByText('2 still to check, they stay out until you tap Yes')).toBeVisible();

    // Answer one Yes; the other stays out.
    await sheet.getByRole('button', { name: 'Yes, Org Cane Sugar is right' }).click();
    await sheet.getByRole('button', { name: 'Put away 4 items' }).click();
    await expect(sheet).not.toBeVisible({ timeout: 8_000 });

    expect(captured.map((i) => i.name)).toEqual(['Eggs', 'Whole Milk', 'Bananas', 'Org Cane Sugar']);
  });

  test('a scan judged not to be a receipt asks first; nothing is written until "Use it anyway"', async ({ page }) => {
    // Issue #856. Screenshots only when a verify run asks for them.
    const shots = process.env.VERIFY_SHOTS_DIR;
    const shot = async (name: string) => {
      if (!shots) return;
      await page.waitForTimeout(900); // let the sheets finish sliding
      await page.screenshot({ path: path.join(shots, `${name}.png`) });
    };
    let bulkCalls = 0;

    await page.route('**/api/ai/scan', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ocr_text: 'BubblyChef\nFresh bread\nExpires in 2 days',
          ready_to_add: [
            { name: 'Fresh bread', quantity: 1, unit: 'item', category: 'bakery', location: 'pantry', confidence: 0.9 },
          ],
          needs_review: [],
          skipped: [],
          total_items: 1,
          warnings: [],
          is_receipt: false,
        }),
      }),
    );
    await stubPantryReads(page);
    await page.route('**/api/pantry/bulk', async (route) => {
      bulkCalls += 1;
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ count: 1, items: makeBulkResponse().items.slice(0, 1) }),
      });
    });

    await page.goto('/pantry?add=scan');
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(RECEIPT_STUB_PNG);

    const sheet = page.getByTestId('put-away-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });
    await expect(sheet.getByText("This doesn't look like a receipt")).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Nothing to put away' })).toBeDisabled();
    await expect(sheet.getByText('Fresh bread')).toHaveCount(0);
    await shot('01-not-a-receipt');
    expect(bulkCalls).toBe(0);

    await sheet.getByRole('button', { name: 'Use it anyway' }).click();
    await expect(sheet.getByText("This doesn't look like a receipt")).toHaveCount(0);
    await expect(sheet.getByText('Fresh bread')).toBeVisible();
    await shot('02-use-it-anyway');
    expect(bulkCalls).toBe(0);

    await sheet.getByRole('button', { name: 'Put away 1 item' }).click();
    await expect(sheet).not.toBeVisible({ timeout: 8_000 });
    expect(bulkCalls).toBe(1);
  });

  test('"Try another photo" drops the scan and reopens the scan tab', async ({ page }) => {
    await page.route('**/api/ai/scan', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ocr_text: 'BubblyChef\nFresh bread',
          ready_to_add: [
            { name: 'Fresh bread', quantity: 1, unit: 'item', category: 'bakery', location: 'pantry', confidence: 0.9 },
          ],
          needs_review: [],
          skipped: [],
          total_items: 1,
          warnings: [],
          is_receipt: false,
        }),
      }),
    );
    await stubPantryReads(page);

    await page.goto('/pantry?add=scan');
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(RECEIPT_STUB_PNG);
    const sheet = page.getByTestId('put-away-sheet');
    await expect(sheet).toBeVisible({ timeout: 10_000 });

    await sheet.getByRole('button', { name: 'Try another photo' }).click();
    await expect(sheet).not.toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/Drop your receipt here/)).toBeVisible();
  });

  test('error from /api/ai/scan shows an error message and stays on upload state', async ({ page }) => {
    await page.route('**/api/ai/scan', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ error: 'OCR service unavailable' }),
      }),
    );
    await stubPantryReads(page);

    await page.goto('/pantry?add=scan');
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();
    await page.locator('input[type="file"][accept="image/*"]').setInputFiles(RECEIPT_STUB_PNG);

    // A failed scan shows friendly copy, not the raw backend error string.
    await expect(page.getByText(/Couldn't read that receipt/)).toBeVisible({ timeout: 8_000 });
    await expect(page.getByText(/OCR service unavailable/)).toHaveCount(0);
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
    await expect(page.getByTestId('put-away-sheet')).toBeVisible({ timeout: 45_000 });

    // Loose count check: grocery-mart has 8 items; tolerate partial parse (≥6)
    // Sections show "(N)" — grab the combined count from the found-items line.
    // Source: ScanTab.tsx ~L170: "Found {total} items"
    const countText = await page.getByText(/Put away \d+ items?/).first().textContent();
    const found = parseInt(countText?.match(/(\d+)/)?.[1] ?? '0', 10);
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
    const confirmBtn = page.getByRole('button', { name: /Put away \d+ items?/ });
    await expect(confirmBtn).toBeVisible();
    await confirmBtn.click();

    // Sheet closes on success
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).not.toBeVisible({ timeout: 15_000 });

    // Expiry loop assertion: at least one tile should show an expiry badge.
    // If the bulk route estimated expiries (fix #158), items like Chicken Breasts
    // or Milk will show "Xd left" badges immediately.
    // Source: pantry/page.tsx ~L86: expiryBadge renders "{N}d left"
    // (#750: the pantry grid is the storage sheet's List now; the badge is the food tag.)
    await page.getByRole('button', { name: /^Fridge/ }).click();
    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.getByTestId('storage-expiry-pill').first()).toBeVisible({ timeout: 10_000 });
  });

  test('city-harvest.png → OCR → confirm → ≥5 items with non-null expiry', async ({ page }) => {
    const CITY_HARVEST_PNG = path.join(__dirname, 'fixtures/receipts/city-harvest.png');

    await page.goto('/pantry?add=scan');
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).toBeVisible();

    const fileInput = page.locator('input[type="file"][accept="image/*"]');
    await fileInput.setInputFiles(CITY_HARVEST_PNG);

    // city-harvest has 7 items (bread, yogurt, spinach, tomatoes, ground beef, cereal, coffee)
    await expect(page.getByTestId('put-away-sheet')).toBeVisible({ timeout: 45_000 });

    const countText = await page.getByText(/Put away \d+ items?/).first().textContent();
    const foundCount = parseInt(countText?.match(/(\d+)/)?.[1] ?? '0', 10);
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
    const confirmBtn = page.getByRole('button', { name: /Put away \d+ items?/ });
    await confirmBtn.click();
    await expect(page.getByRole('heading', { name: 'Add to Pantry' })).not.toBeVisible({ timeout: 15_000 });

    // At least one expiry badge should appear after the pantry refetches
    // (#750: the pantry grid is the storage sheet's List now; the badge is the food tag.)
    await page.getByRole('button', { name: /^Fridge/ }).click();
    await page.getByRole('button', { name: 'List' }).click();
    await expect(page.getByTestId('storage-expiry-pill').first()).toBeVisible({ timeout: 10_000 });
  });
});
