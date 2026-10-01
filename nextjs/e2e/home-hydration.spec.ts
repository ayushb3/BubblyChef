/**
 * Issue #573 — the home page (`/`) hydrates without a React error.
 *
 * Intermittent React error #418 (a hydration mismatch) was reported on the old
 * home, which read the clock and storage while rendering. The home has since
 * been rewritten (the kitchen scene, #748, and the Bubbles card, #755), and
 * every device-local or clock-dependent read there is now gated behind mount
 * (`clockReady`, `useSyncExternalStore` with a server snapshot, effect-read
 * cook sessions). This spec keeps it that way: a hydration mismatch is a
 * `pageerror` in a production build, so it loads `/` fresh many times, in the
 * states that change what the first client render could differ on, and fails
 * on any page error or React hydration console error.
 *
 * What this can and cannot see: on a production build, React reports a mismatch
 * as `Minified React error #418` only when it is in the shell (the root layout:
 * providers, bottom nav, the timer dock, the tour). A mismatch inside the home
 * page's own Suspense boundary is repaired silently by a client render and
 * raises nothing, so only a dev server (full "Hydration failed" message) shows
 * it. Run against the dev server with HYDRATION_SCRIPT_DELAY_MS=0 to check the
 * page too. Deliberately adding `typeof window` to BottomNav's label turned
 * this spec red (#418 on every load); the same in KitchenHeader did not.
 *
 * Every load is a new browser context (no cache, no leftover storage) signed
 * in as the shared e2e user. The AI-backed daily-tip endpoint is stubbed, so no
 * model is called; the pantry reads are stubbed in the states that need a known
 * pantry (empty, and food about to expire).
 */
// @ts-nocheck
// NOTE: @ts-nocheck matches the other specs — '@playwright/test' has no type
// declarations in this repo yet (issue #149). Do NOT fix here.
import { test, expect } from './fixtures/auth';

const LOADS = 10;
// 0 turns the held-back-scripts loads off (the dev server's chunks do not survive it).
const SCRIPT_DELAY_MS = Number(process.env.HYDRATION_SCRIPT_DELAY_MS ?? 2000);

const json = (body) => ({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });

const DAILY = {
  tip: { text: 'Salt your pasta water well.', category: 'technique' },
  suggestion: null,
  generated_at: '2026-10-01T12:00:00.000Z',
  source: 'fallback',
};

const EXPIRING_ITEM = {
  id: 'e2e-hydration-milk',
  name: 'Milk',
  quantity: 1,
  unit: 'carton',
  category: 'dairy',
  location: 'fridge',
  expiry_date: '2026-10-02',
  days_until_expiry: 1,
  is_expired: false,
  is_expiring_soon: true,
};

const PENDING_PUTAWAY = {
  v: 1,
  savedAt: '2026-10-01T09:00:00.000Z',
  store: 'Corner Shop',
  ready: [{ _id: 'a', name: 'Eggs', quantity: 12, unit: 'item', category: 'dairy', location: 'fridge', confidence: 0.95 }],
  review: [],
  skipped: [],
  warnings: [],
};

const PLANNED_TONIGHT = {
  v: 1,
  mealId: '00000000-0000-4000-8000-000000000573',
  title: 'Lemon pasta night',
  servings: 2,
  serveAtMs: Date.UTC(2026, 9, 1, 19, 0),
  startAtMs: Date.UTC(2026, 9, 1, 18, 0),
  startDish: null,
};

// A returning visitor: a scan waiting to be put away, a meal planned for tonight,
// a cook left mid-recipe, a saved kitchen theme, and a nudge already seen today.
const RETURNING_STORAGE = {
  'bubblychef:putaway:pending': JSON.stringify(PENDING_PUTAWAY),
  'bubblychef:planned:tonight': JSON.stringify(PLANNED_TONIGHT),
  'bubblychef:cook:activeSession': JSON.stringify({ recipeId: '00000000-0000-4000-8000-000000000574', step: 1 }),
  'bubbly-theme': 'lavender',
};

const states = {
  'default pantry': {},
  'empty pantry': {
    pantry: { items: [], total_count: 0 },
    expiring: { items: [], count: 0 },
  },
  'food expiring tomorrow': {
    pantry: { items: [EXPIRING_ITEM], total_count: 1 },
    expiring: { items: [EXPIRING_ITEM], count: 1 },
  },
  'returning visitor with saved device state': { storage: RETURNING_STORAGE },
  'slow CPU (4x)': { cpuRate: 4 },
};

for (const [name, state] of Object.entries(states)) {
  test(`/ hydrates cleanly on ${LOADS} fresh loads: ${name}`, async ({ browser }) => {
    test.setTimeout(240_000);
    const errors = [];

    for (let i = 0; i < LOADS; i++) {
      const context = await browser.newContext({
        storageState: 'e2e/.auth/user.json',
        viewport: { width: 393, height: 727 },
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`load ${i}: ${e.message.slice(0, 200)}`));
      page.on('console', (m) => {
        if (m.type() === 'error' && /hydrat|react\.dev\/errors\/(418|423|425)/i.test(m.text())) {
          errors.push(`load ${i} console: ${m.text().slice(0, 200)}`);
        }
      });

      // The onboarding tour would cover the page; the auth fixture patches it
      // per page, and this spec makes its own contexts, so patch it here too.
      await page.route('**/auth/v1/user**', async (route) => {
        if (route.request().method() !== 'GET') return route.fallback();
        const response = await route.fetch();
        const body = await response.json().catch(() => null);
        if (body && typeof body === 'object' && 'id' in body) {
          body.user_metadata = { ...(body.user_metadata ?? {}), onboarding_completed: true };
        }
        return route.fulfill({ response, json: body });
      });
      await page.route('**/api/ai/dashboard/daily**', (route) => route.fulfill(json(DAILY)));
      if (state.pantry) await page.route('**/api/pantry', (route) => route.fulfill(json(state.pantry)));
      if (state.expiring) await page.route('**/api/pantry/expiring**', (route) => route.fulfill(json(state.expiring)));
      if (state.storage) {
        await page.addInitScript((entries) => {
          for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, v);
        }, state.storage);
      }
      // Whether React compares the server HTML with the first client render at
      // all depends on a race. Home streams in behind a Suspense boundary (it
      // waits on the auth read), and if the JavaScript hydrates the boundary
      // before that chunk has arrived, React simply client-renders it and never
      // checks, so a mismatch hides. Every other load holds the scripts back
      // until the whole page is in, which is the order that checks (and, on
      // production, the order the intermittent report came from).
      if (SCRIPT_DELAY_MS > 0 && i % 2 === 1) {
        await page.route('**/_next/static/chunks/**/*.js', async (route) => {
          await new Promise((resolve) => setTimeout(resolve, SCRIPT_DELAY_MS));
          await route.continue();
        });
      }
      if (state.cpuRate) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Emulation.setCPUThrottlingRate', { rate: state.cpuRate });
      }

      await page.goto('/');
      // The eyebrow is filled in by an effect after hydration, so once it has
      // text the page has hydrated. `:visible`, because while the page streams
      // in, React briefly holds a hidden copy of the same tree.
      await expect(page.locator('[data-testid="kitchen-eyebrow"]:visible')).toHaveText(/\S/, {
        timeout: 20_000,
      });
      await page.waitForLoadState('networkidle');
      await context.close();
    }

    expect(errors, `${errors.length} hydration errors in ${LOADS} loads`).toEqual([]);
  });
}
