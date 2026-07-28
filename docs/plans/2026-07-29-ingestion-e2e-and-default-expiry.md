# Plan — Receipt-ingestion e2e tests, default expiries, and the expiry loop

_Date: 2026-07-29 · Branch (proposed): `feat/ingestion-e2e-and-default-expiry` off `main`_

## Context

Three threads converged this session, and they're really one story: **the pantry's
expiry/cook/waste loop is dormant because items land with no expiry date.**

- The user's live pantry (prod) has **every item at `expiry_date: null`** — verified
  via REST probe. The pantry screenshot shows no expiry badges and no "Cook this"
  strips anywhere, because both are gated on a non-null expiry.
- We were mid-discussion on **#146** (expired items shouldn't offer "Cook this"), but
  that bug is *invisible* until items actually have dates — so #146 is downstream of a
  bigger gap.
- The user asked for **a live e2e test for receipt ingestion** and supplied two real
  receipt photos, and asked **"we should have default expiries right?"**

This plan covers all three, in dependency order: fix default expiries → make the loop
visible → cover ingestion with e2e → then the #146 polish.

### What the code actually does today (traced, not assumed)

**Expiry estimation exists and is good** — `ai-service/bubbly_chef/domain/expiry.py`
(`estimate_expiry_days`, `calculate_expiry_date`) with `CATEGORY_DEFAULTS` +
`ITEM_OVERRIDES`, wrapped by `tools/expiry.py::estimate_expiry() -> (date, is_estimated)`.

**It's wired into every AI path:**
- `workflows/receipt_ingest.py:245` (receipt scan)
- `workflows/product_ingest.py:232` (product lookup)
- `workflows/pantry/nodes.py:253` (chat "add X to pantry")
- `services/receipt_parser.py:204`

**It is NOT wired into the manual add path.** The Next.js CRUD route
`nextjs/src/app/api/pantry/route.ts:52` does:
```ts
expiry_date: body.expiry_date || null
```
and the manual form `TypeTab.tsx:15,35` defaults `expiry_date: ''` → sent as `null`.

### ⚠️ CORRECTED by live testing (2026-07-29) — the gap is bigger than the manual path

Live end-to-end testing via `playwright-cli` against the running app disproved the
"only manual add is broken" hypothesis. **Both the receipt-scan path and the manual
Type path produce null expiries.** Verified:

- Cleared the pantry, scanned `grocery-mart.png` → OCR found all 8 items (86% conf),
  confirmed them → **all 8 landed `expiry_date: null`** in the DB.
- Manually added "yogurt" via the Type tab with no date → **also `null`** (and
  categorized "other", not "dairy").
- With 9 null-expiry items, the pantry showed **zero** expiry badges and **zero**
  "Cook this" strips (`hasBadge:false, hasCook:false`) — the whole loop is dead. This
  is exactly what the user saw. Screenshots: `/tmp/pantry-no-badges.png`,
  `/tmp/after-add.png`.
- Setting dates by hand (chicken=expired, milk=3d, banana=5d) and reloading → badges
  and strips appeared immediately (`hasExpired/hasDaysLeft/hasCook: true`), and the
  expired chicken tile showed the **#146 incoherence live** (Expired badge + Cook this
  together). Screenshot: `/tmp/pantry-with-badges.png`.

**The real root cause is a single shared write path.** Both scan-confirm and chat-add
go through `POST /v1/workflows/apply` → `repo.apply_pantry_proposal`
(`supabase_repo.py:172`), whose "add new item" branch **hardcodes `expiry_date=None`**
at `supabase_repo.py:218` — it neither reads `action.get("expiry_date")` nor calls the
estimator. So even though `receipt_parser.py:204` computes an estimate, it's discarded
three times over:

1. `ScannedItem` (`nextjs/src/types/scan.ts:5-12`) has **no expiry field** — the scan
   review UI never receives the parser's estimate.
2. `scan.ts` confirm mapping (`confirmScanItems`, ~L93-100) builds each action from
   `name/quantity/unit/category/location` and **omits `expiry_date`** (even though
   `ConfirmedItem` declares it at `scan.ts:30`).
3. `apply_pantry_proposal` add-branch hardcodes `expiry_date=None`
   (`supabase_repo.py:218`).

The `receipt_ingest.py:245` estimation path (which I originally cited) is a **different,
apparently unused** code path — the live confirm flow does not go through it.

---

## Part 1 — Default expiries at the shared write path (the root fix)

**Goal:** any item that reaches `apply_pantry_proposal` without an explicit expiry gets
a sensible estimate, so scan-confirm AND chat-add both light up the loop — fixed in one
place, server-side, in Python where the heuristic already lives.

### Recommended fix — estimate in `apply_pantry_proposal` (one place, both flows)
At `supabase_repo.py:218`, replace the hardcoded `expiry_date=None` with:
- if `action.get("expiry_date")` is present, use it (honours an explicit user date);
- else call `tools/expiry.estimate_expiry(category, location, name)` and use its date.

This is the highest-leverage fix: it's the single shared final write for both scan and
chat, it keeps the Python heuristic as the one source of truth, and it needs **no**
frontend change to make scanned/chatted items get dates. `estimate_expiry` is already
importable in the repo layer's domain.

### Complementary frontend fixes (so an *explicit* scanned estimate flows too)
Optional but tidy, and needed if we want the review UI to *show* the estimate before
confirm:
- Add `expiry_date`/`expiry_days` to `ScannedItem` (`types/scan.ts`) and surface it from
  the scan response.
- Forward `expiry_date` in `confirmScanItems`'s action map (`scan.ts`).

### Manual "+ Add Item" path
The Next.js route (`api/pantry/route.ts:52`) is a **separate** write that does not go
through `apply_pantry_proposal` — it inserts directly. So it needs its own fix: when
`body.expiry_date` is absent, call the same ai-service estimator (small
`POST /pantry/estimate-expiry` endpoint wrapping `tools/expiry.estimate_expiry`) before
insert, with graceful fallback to `null` if the service is down (never block the add).
There is **no TS-side expiry logic** (grep confirms) and we should not fork the table.

### Honesty about estimates (`is_estimated`)
Whichever path fills the date, persist/surface the existing `is_estimated` flag so
estimated dates read differently (e.g. "~Aug 5") and users can correct them. Confirm
whether `pantry_items` has an `is_estimated` column; if not and we want to persist it,
that's a migration (coordinate with the #150 train — do not stack silently).

**Files:** `ai-service/bubbly_chef/repository/supabase_repo.py:218` (the core fix),
`ai-service/bubbly_chef/tools/expiry.py` (estimator, reused), `nextjs/src/types/scan.ts`
+ `nextjs/src/lib/api/scan.ts` (surface/forward estimate — complementary),
`nextjs/src/app/api/pantry/route.ts` + a small ai-service estimate endpoint (manual
path), `TypeTab.tsx`/`AddItemRow.tsx` (estimated-date display).

---

## Part 2 — Backfill the existing null-expiry items (make the loop visible)

The user's prod pantry is all-null. Independent of Part 1's forward fix, existing rows
need dates or nothing lights up.

- **One-off backfill:** a script (or a guarded admin action) that runs
  `estimate_expiry` over every `pantry_items` row where `expiry_date IS NULL`, using
  `name` + `category` + `location`, and sets the estimate. Idempotent; skips rows that
  already have a date. Run once against prod after Part 1 lands.
- **Interim (already done this session):** 4 items were given manual dates
  (chicken breast 07-26 expired, milk 07-30, banana 07-31, carrot 08-02) to demo the
  states. **These should be nulled back or folded into the backfill** so prod isn't
  left with hand-picked demo dates. _(Ask the user before nulling — they may still be
  eyeballing the tiles.)_

---

## Part 3 — Live receipt-ingestion e2e test

**Goal:** an e2e test proving a receipt photo → OCR → parsed items → confirm → items in
pantry (with estimated expiries). The user supplied two real fixtures, now saved:
- `nextjs/e2e/fixtures/receipts/grocery-mart.png` — Grocery Mart, 8 items (eggs, milk,
  bananas, gala apples, carrots, cheddar, spaghetti, chicken breasts).
- `nextjs/e2e/fixtures/receipts/city-harvest.png` — City Harvest, 7 items (bread, greek
  yogurt, spinach, roma tomatoes, ground beef, cereal, coffee beans) — mixes perishable
  + shelf-stable, and items *not* already in the pantry.

### Harness reality (traced)
- e2e lives in `nextjs/e2e/`; `smoke.spec.ts` + `fixtures/auth.ts` (stored auth via
  `.auth/user.json`, set up in `global-setup.ts`).
- `playwright.config.ts`: `baseURL: 127.0.0.1:3000`, a `webServer` block on 3000, and
  the 5 pre-existing tsc errors (missing `@playwright/test`/`dotenv` types — the harness
  isn't fully type-wired yet). **The user runs frontend on 3100, and ai-service (8888,
  Gemini OCR) is NOT started by the webServer block.** A live ingestion test needs both
  services up and the OCR key present.

### "Live" vs "seam" — decide the boundary
A truly live test calls Gemini Vision OCR — real cost, real latency, real flakiness
(non-deterministic parse). Options:
- **3a — Full live (opt-in, gated):** upload the real PNG, hit real OCR + AI parse,
  assert the *set* of items loosely (e.g. "milk", "eggs", "chicken" appear;
  count ≥ 6), then confirm and assert they're in the pantry **with non-null expiry**.
  Gate behind an env flag (mirror `BUBBLY_RUN_LIVE_TESTS`) so CI doesn't pay per-run or
  flake. This is what the user asked for; keep assertions tolerant of OCR noise.
- **3b — Deterministic seam (for CI):** stub the OCR/parse response with a fixed JSON
  for each receipt (record one real run's output), then drive the review→confirm UI and
  assert DB state. Fast, stable, runs every CI push. Complements 3a.

**Recommendation:** build **both** — 3b as the always-on CI gate (proves the
review→confirm→persist wiring, incl. estimated expiry), 3a as an opt-in live smoke the
user can run on demand against the two real receipts. Assert on the **expiry loop
outcome** too: confirmed items land with non-null, sensible expiry (validates Part 1/3
together).

### Wiring work
- Add `POST /api/ai/scan` (already exists, `scan.ts:65`) + confirm flow coverage.
- Make the test config aware of the ai-service (either start it in `webServer`, or
  document a "both servers up" precondition for the live variant).
- Fix or scope the 5 pre-existing e2e tsc errors as part of touching this area
  (coordinate with the other agent already on #149 — **do not double-fix**; that agent
  widened #149 to include these exact errors).

---

## Part 4 — The #146 expiry-affordance fix (now unblocked)

Once items have dates (Parts 1–2), #146 becomes real and worth fixing:

- **Gate fix (ships now, 1 line)** — `nextjs/src/app/pantry/page.tsx:80`:
  `days <= 3` → `days >= 0 && days <= 3`. Expired tiles keep the red "Expired" badge
  (`expiryBadge`, `days <= 0`) but lose the incoherent "Cook this" strip.
- **"Toss it?" affordance (after PR #150)** — a second footer strip for `days < 0` that
  opens #140's resolve action ("Used it up" / "Tossed it"). #140 is in **draft PR #150**,
  not on `main` — build on top once it merges; no throwaway work.
- Mockup of the real tile UI: `docs/plans/146-affordance-flow.html`.

---

## Sequencing & dependencies

1. **Part 1** (default expiries on manual add) — root fix, unblocks everything.
2. **Part 2** (backfill existing nulls) — after Part 1; run once on prod. Null/replace
   the 4 demo dates.
3. **Part 3** (e2e: 3b always-on, 3a opt-in) — can proceed in parallel with 1–2; asserts
   the estimated-expiry outcome so it validates Part 1.
4. **Part 4a** (gate fix) — independent, ship anytime.
5. **Part 4b** (Toss it) — blocked on PR #150 (#140).

**Cross-agent:** the e2e tsc errors overlap the other agent's widened #149 — coordinate,
don't double-fix. Part 4b overlaps #150 — wait for merge.

## Verification
- Part 1: add an item via "+ Add Item" with no date → row persists with a non-null
  estimated `expiry_date`; ai-service down → falls back to `null` without blocking.
- Part 2: after backfill, `pantry_items` has no null `expiry_date`; pantry tiles show
  badges + "Cook this" on urgent items.
- Part 3: `npx playwright test` (3b) green in CI; opt-in live run (3a) against both
  receipts yields ≥6 items each with non-null expiry.
- Part 4a: expired tile shows "Expired" badge, no "Cook this"; `npx tsc --noEmit` clean
  bar known e2e errors.

## Open questions for the user
1. **Part 1 approach — A (ai-service hop) vs B (port to TS)?** Recommend A.
2. **Live e2e (3a) — is paying for real Gemini OCR on an opt-in run acceptable?**
   (CI stays on the stubbed 3b.)
3. **The 4 demo expiry dates — null them now, or leave while you eyeball the tiles?**
