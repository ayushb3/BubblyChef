# Issues #663, #664, #657 and #621: four cook-flow fixes, the contract

One PR fixes four small cook-flow bugs. The PR body carries **`Fixes #663`**, **`Fixes #664`**, **`Fixes #657`** and **`Fixes #621`**, each on its own line.

- **Issue #663**, *Cook-along offers Start now on a step whose own dish's previous step is still running* (open). While *the rice simmers* runs, the Now card shows the next rice step as `upcoming` ("after the rice simmers") with **Start now**. Tapping it starts the rest while the simmer is still running.
- **Issue #664**, *Expanded timer dock clips +2 min and hides Dismiss with three timers at phone width* (open). With three timers, the expanded dock squeezes every badge into one row. "+2 min" breaks onto two lines, badges overlap, and the last ✕ (Dismiss) is covered or off-screen.
- **Issue #657**, *Timer dock is hidden behind the guided-cook overlay* (open). A timer started in guided cook mode isn't visible until you leave cook mode.
- **Issue #621**, *Cook confirm: deductions the server skips are never shown to the user* (open). When the server refuses a deduction (the row is gone, or there's no base unit), the user is still told everything was deducted.

The slices: **frontend** owns `lib/`, `types/` and `app/`; **ui-ux** owns `components/`. Everything below was checked against `origin/main` at `69ad84f`.

**Starts after PR #670 merges** (§6). Build it on `fix/issue-663-cook-flow-fixes` off that `main`, and copy this file to `docs/plans/2026-09-30-cook-flow-fixes-contract.md` in the PR.

## 0. What already exists (on `main` at `69ad84f`; re-locate by symbol after PR #670)

### Issue #663

- **`lib/meal-cook-stream.ts`:**
  - `NowCard`'s `upcoming` variant (:48–53) has an optional `waiting_on?: StreamStep`.
  - `deriveStream` (:415) sets it at :510–522, in branch (3) only. It's the first of `sanitizedDependencyKeys(dishes, first.dish_id, first.step_index)` whose status is `running`. `sanitizedDependencyKeys` (`lib/meal-scheduler.ts`:255) returns the same dish's dependencies only.
  - A pending dependency can't sit behind `pending[0]`, because the plan orders by start time. So in that branch, `waiting_on` set means "a direct dependency is still running".
  - **The skip hole.** Only direct dependencies are checked (:514). A skipped step is `skipped` (:384) and counts as finished (:407), so if the dependency was skipped while *its own* predecessor still runs, `waiting_on` is empty and Start now reappears: issue #663 again.
  - `recordStartEarly` (:288–299) has no dependency check, and isn't given `dishes`.
- **`MealNowCard.tsx`:** the `upcoming` branch (:102–142) prints "after ‹label›" (:108–112), then renders **Start now unconditionally** (:119–129), then Skip (:130–139).
- **The cook page** (`app/meals/[id]/cook/page.tsx`): `handleStartEarly` (:382–392) checks only `kind === 'upcoming'` and the tap guard.
- **Tests:**
  - `meal-now-card.test.tsx`:103–129 clicks Start now on a card **with** `waiting_on`. It encodes the bug and has to change.
  - `meal-cook-page.test.tsx`:312–344 already reproduces the bug's state: *Simmer sauce* is running on `timer-1`, and *Plate up* is upcoming "after Simmer sauce".

### Issue #664

- **`components/timers/TimerDock.tsx`** is mounted globally (`components/Providers.tsx`:35).
  - The shell (:232–236) is `fixed left-0 right-0 z-40 … px-3`, at `bottom: calc(64px + safe-area)`.
  - The inner bar (:237–246) is **one row**: `flex items-center gap-2 rounded-full … max-w-full overflow-x-auto`.
- **`TimerBadge`** (:68–164):
  - Its root is `… rounded-full px-3 py-2 min-w-0` (:89).
  - When expanded, it adds the label (`truncate max-w-[90px]`, :114–121), pause/resume (:128–138), **+2 min** (`Add 2 minutes to ‹label› timer`, :139–150) and **✕** (`Dismiss ‹label› timer`, :151–161).
  - The controls are `text-xs`, with no `whitespace-nowrap`, no `flex-shrink-0` and no minimum hit size.
  - A completed badge pulses at `scale 1.05` (:78–87).
- **Root cause:** `min-w-0` plus the default `flex-shrink: 1` shrink each badge below its content. The content overflows onto the next badge, and `overflow-x-auto` never engages.
- `timer-dock-extend.test.tsx` and `timer-dock-announcements.test.tsx` query by those aria-labels.

### Issue #657: every fixed layer the dock can meet

| Layer | z | Relation to the dock |
|---|---|---|
| `GuidedCookFlow` root (`GuidedCookFlow.tsx`:587, :600) | `z-[9990]` | Covers the dock today: **the bug** |
| Guided's Ask Bubbles overlay (:305, rendered **inside** the guided root, :819–837) | `z-[9998]` | Inside the guided root's stacking context, so no global z can sit between the root and it |
| PR #670's meal Ask Bubbles overlay (the cook page, not in guided) | `z-[9998]` | Above the dock (z-40) |
| `CookModal` (`CookModal.tsx`:196) | `z-[60]` | Above the dock. It's never open with guided: `onFinish` closes guided, then opens it (`RecipeBook.tsx`:1057–1062) |
| All sheets and modals: `MealCookSheet`:155, `MealTimelineSheet`:31/44, `AddItemModal`:142/156, `PantryAddSheet`:145/159, the RecipeEdit, Import and Refinement modals, `KitchenThemePicker`:87/99 | `z-[60]` | Above the dock, which is correct |
| `TourOverlay` (:244, :251, :281, :306) | `z-[60]`–`[63]` | Above the dock, which is correct. It has no z-50 layer: :238 is a comment naming BottomNav's |
| `BottomNav` (`BottomNav.tsx`:43) | `z-50` | The dock sits above it by offset (64px), not by z |
| Pantry FAB (`fixed bottom-24 right-6 z-40`, `pantry/page.tsx`:410) | `z-40` | The expanded stack (full width at 375px, up to 50vh from 64px) can cover it. **Accepted:** the stack is opened on purpose and one tap collapses it; the collapsed dock is centred and short |
| `NotificationBell` panel (:171) | `z-20` | Unchanged |
| `BubblePop` (`ui/BubblePop.tsx`:76) | `z-[9999]` | `pointer-events-none`, top-right; harmless |

- **The guided footer** (Back/Next) is `sticky bottom-0` (:782–816): `py-4` plus `py-3` buttons, about 76px tall, with no safe-area padding.
- GuidedCookFlow holds `chatOpen` (:527); the Ask Bubbles open button is `Ask Bubbles about this step` (:759). The step scroll body is `flex-1 … overflow-y-auto` (:641); the step timer chips are `step-timer-chip` / `structured-step-timer-chip` (`StepTimerChip.tsx`:50, :99).
- The dock's expand toggle (`TimerDock.tsx`:247–255) is `flex-shrink-0 text-sm`, with no minimum hit size.

### Issue #621

- **The single-recipe confirm:**
  - `POST /v1/recipes/cook/confirm` returns `{ success, deductions_applied, deductions_requested, deductions_skipped }` (`recipes_ai.py`:332–337).
  - `deductions_skipped` lists the **pantry item ids** that `deduct_pantry_item` refused (`services/meal_cook.py`:628–674).
  - The Next proxy (`app/api/ai/recipes/cook/confirm/route.ts`:32, :63) passes the body through.
  - **`confirmCook()` (`lib/api/recipes.ts`:107–123) returns `Promise<void>`** and never reads the body.
  - `CookModal.handleConfirm` (:152–190) awaits it, shows "Pantry updated!" (:305–313) and "Ingredients deducted — taking you to chat." (:350), and auto-redirects after 1200ms (:179–185, non-draft only).
  - CookModal's other exits all call bare `onClose`: Escape via `useModalFocusTrap(true, onClose, …)` (:111), the backdrop (:202) and ✕ (`aria-label="Close"`, :244). None runs `onCooked`.
- **The meal confirm (from PR #668): it also drops the list.**
  - `confirmMealCook` (`lib/api/meals.ts`:274–285) does return `MealCookConfirmResponse`, which includes `deductions_skipped: string[]` (`types/meals.ts`:256; the backend is `meals_ai.py`:401).
  - But `doConfirm` (`page.tsx`:472–494) **discards the result**, sets `success` and redirects after 1200ms.
  - `MealCookSheet`'s success state (:238–248) is "Pantry updated!" only. Its ✕ (:203), backdrop (:161) and Escape (:116) all go through `guardedClose` (:113), which calls `onClose` = the page's `handleSheetClose` (:579, just `setSheetOpen(false)`).
  - The sheet already takes **`onBackToMeal`** (:44, used by the error footer :312) = `handleSheetBackToMeal` (:565–577). With no `errorKind` it calls `endMealCookSession` (idempotent, `lib/meal-cook-session.ts`:342), invalidates, and pushes `/meals/${id}`.
  - The proxy (`app/api/ai/meals/cook/confirm/route.ts`:74) reads the list only to exclude it from rescue awards.
- **The names.** A pantry id maps to a name through the proposal:
  - `matches[].pantry_item_id` → `pantry_item_name` (`types/recipes.ts`:134–151);
  - `compound_suggestions[].component_items[].pantry_item_id` → `name` (:161–193).
  - **Both are not always present.** `MealCookProposal.compound_suggestions` is required (`types/meals.ts`:236), but `CookProposal.compound_suggestions?` is optional (`types/recipes.ts`:216), and `CompoundSuggestion.component_items?` is optional on both (:192).
- **A test that mocks the old return:** `chat-cook-two-tab-guard.test.tsx`:150 has `confirmCook.mockResolvedValue(undefined)`.
- **Two meanings of "skipped".** `summariseDeductions` already uses "skipped" for rows the *client* never sends (`needs_quantity`). The server-refused list here is separate.

### PR #670 overlap

PR #670 (open, *feat: ask Bubbles to change a dish's ingredients mid meal-cook (#654, PR B)*, head `3d6b586`) lets the cook ask Bubbles about the current dish mid meal-cook and apply the suggested change to that dish's pantry deduction.

- **`MealNowCard.tsx` will conflict.** PR #670 changes the upcoming row's `flex gap-2` (:119) to `flex-wrap`, and appends an Ask Bubbles pill after Skip.
- **`GuidedCookFlow.tsx`:** PR #670 extracts `AskBubblesOverlay` (−226 lines) but keeps `chatOpen` and the in-root mount. This PR adds hook calls beside `chatOpen` and a class on :641.
- **`page.tsx`:** PR #670 adds handlers after `handleClose` and an overlay mount. This PR edits `handleStartEarly` and `doConfirm`, which are separate hunks.
- `meal-now-card.test.tsx` and `meal-cook-page.test.tsx`: both PRs add tests.
- **No overlap:** `TimerDock`, `CookModal` and `MealCookSheet`.

## 1. Issue #663: Start now only when nothing it follows is running

- **frontend (`lib/meal-cook-stream.ts`):** add a type guard, since `handleStartEarly` reads `stream.now.step` right after it:
  `export function canStartEarly(card: NowCard): card is Extract<NowCard, { kind: 'upcoming' }> { return card.kind === 'upcoming' && !card.waiting_on }`.
- **frontend (`deriveStream`, :510–522): close the skip hole.** `waiting_on` walks `sanitizedDependencyKeys` through `skipped` steps (recursing on each skipped step's own keys, with a visited set) to the first unfinished, non-skipped ancestors, and takes the first of those that is `running`. So in simmers → rests (skipped) → fluff, *fluff* is waiting on *simmers*. `NowCard` and `recordStartEarly` are unchanged.
- **frontend (`page.tsx`):** `handleStartEarly` returns unless `canStartEarly(stream.now)`. This replaces its `kind` check.
- **ui-ux (`MealNowCard.tsx`):** render Start now only when `canStartEarly(card)`. Skip and the "after ‹label›" line stay. The props don't change.
- When the dependency finishes, the next derive clears `waiting_on`, and Start now (or the `active` card) returns.

## 2. Issue #664: the expanded dock stacks (ui-ux, `TimerDock.tsx`)

- **Collapsed:** the same row, but the 44px toggle (below) makes the bar a little taller. Badges gain `flex-shrink-0`, so five or more scroll horizontally instead of squashing.
- **The expand toggle** gets `min-h-[44px] min-w-[44px] inline-flex items-center justify-center` in both layouts, so §8's `h >= 44` holds for every button in the dock.
- **Expanded:** the inner bar becomes `flex-col items-stretch rounded-3xl w-full max-w-md max-h-[50vh] overflow-y-auto p-2 gap-2`, with the toggle as the first row. Each timer is one full-width row:
  - the icon is `flex-shrink-0`;
  - the label is `flex-1 min-w-0 truncate` (drop `max-w-[90px]`);
  - the time is `flex-shrink-0 whitespace-nowrap`;
  - each control is `flex-shrink-0 whitespace-nowrap min-h-[44px] min-w-[44px] inline-flex items-center justify-center`.
  - The completed pulse is `scale 1.02` in the stack (1.05 collapsed).
- **Test hook:** the inner bar gets `data-testid="timer-dock-list"` and `data-layout="row" | "stack"`.
- Every aria-label, testid, the live region, the chime and the vibration are unchanged.

## 3. Issue #657: the dock rises above guided cook (ui-ux)

- **The stacking values:**
  - The dock stays **`z-40`** everywhere by default, so every `z-[60]` sheet and modal still covers it.
  - While a guided cook flow is open **and its Ask Bubbles overlay is closed**, the dock is **`z-[9991]`**: above the guided root (9990), below `BubblePop` (9999).
  - While Ask Bubbles is open inside guided, the dock drops back to `z-40`, under the guided root. The overlay sits inside that root's stacking context, so the only way to keep the overlay above the dock is to stop raising the dock.
- **Position while raised:** `bottom: calc(96px + env(safe-area-inset-bottom, 0px))`, which clears the roughly 76px guided footer. Default stays `64px`.
- **The mechanism.** A new `components/timers/TimerDockLayer.tsx` holds a ref-counted context:
  - `TimerDockLayerProvider`;
  - `useRaiseTimerDock(active: boolean)`, which adds one while `active` and mounted and removes it on cleanup (safe under StrictMode);
  - `useTimerDockRaised(): boolean`.
  - With no provider, the default is "not raised", and `useRaiseTimerDock` is a no-op, so existing isolated renders are unchanged.
- **Wiring:**
  - `Providers.tsx` wraps `CookingTimersProvider`'s children (the routed content and `<TimerDock />`) in `TimerDockLayerProvider`.
  - `GuidedCookFlow` calls `useRaiseTimerDock(!chatOpen)`, `useTimerDockRaised()` and `useCookingTimers()` at the top level, above the empty-steps early return (:584), so both returns raise it and the hook order is stable.
  - The shell gets `data-raised="true" | "false"` as its test hook.
- **Room for the dock.** While `useTimerDockRaised()` is true and `useCookingTimers()` has a timer, guided's step scroll body (:641) adds `pb-[calc(6rem+env(safe-area-inset-bottom))]`, so the last line, the timer chips and Ask Bubbles can scroll clear of the collapsed dock. The expanded stack can still cover them; collapsing is the way out.

## 4. Issue #621: say what wasn't deducted

**frontend:**
- `types/recipes.ts`: `export interface CookConfirmResponse { success: true; deductions_applied: number; deductions_requested: number; deductions_skipped: string[] }`.
- **`confirmCook()` returns `Promise<CookConfirmResponse>`.** On a 2xx response it parses the body with `.catch(() => ({}))`, and coerces `deductions_skipped` to a string array (default `[]`).
  - A 2xx with an unreadable body must **never throw**: the deduction already landed, and an error state would invite a double-deduct retry.
  - The error path is unchanged.
- New pure **`lib/cook-skipped.ts`**:
  `skippedDeductionNames(proposal: { matches: IngredientMatch[]; compound_suggestions?: CompoundSuggestion[] }, ids: string[]): { names: string[]; unnamed: number }`.
  - It resolves ids through the matches' `pantry_item_name` (falling back to `ingredient_name` when that is null), then the compound `component_items[].name`, treating a missing `compound_suggestions` or `component_items` as empty (§0).
  - It de-duplicates and keeps the order of `ids`; an id it can't resolve counts toward `unnamed`.
- **Meal page `doConfirm`:**
  - It keeps `confirmMealCook`'s result and stores `skippedNames = skippedDeductionNames(proposal, res?.deductions_skipped ?? [])`. The `?.` is needed because the page tests' mocks resolve `undefined`.
  - **When `names.length + unnamed > 0`, it schedules no redirect.** It passes `skipped={skippedNames}` to the sheet. The continue path is the existing `onBackToMeal` (`handleSheetBackToMeal`); no new prop. Its second `endMealCookSession` call is harmless, because that function is idempotent.
  - With nothing skipped, it behaves exactly as today.

**ui-ux:**
- **New `components/cook/SkippedDeductionsNotice.tsx`** (`{ names, unnamed }`). It renders `role="status"`, in the muted, rounded card style:
  > "Couldn't update 2 items: butter, flour. Check your pantry."
  - It names at most 3; the rest read "… and N more".
  - It renders nothing when the count is 0.
- **`CookModal`:**
  - It computes the names from `proposal` using `(await confirmCook(...))?.deductions_skipped ?? []`. The `?.` is deliberate, so a mock that resolves `undefined` still works.
  - In `success`, it shows the notice under "Pantry updated!".
  - When the notice shows, it **doesn't auto-redirect**. A **Continue** pill (44px) runs the same `onCooked(); onClose(); router.push(...)` the timer would, and "Ingredients deducted — taking you to chat." (:350) is hidden.
  - **Every other exit does the same.** A `dismiss` wrapper runs the Continue path only when `state === 'success' && !isDraft && names.length + unnamed > 0` (the same expression that shows the notice), and plain `onClose` otherwise. A `continuedRef` makes the Continue path run once, so Continue then a quick Escape can't call `onCooked` twice. It replaces `onClose` at Escape (:111), the backdrop (:202) and ✕ (:244), so `onCooked` still runs.
  - Draft mode shows the notice above "Add to library?", and nothing else changes: it never auto-redirected, and its exits stay as they are.
  - With nothing skipped, it's exactly today's flow.
- **`MealCookSheet`:** new optional `skipped?: { names: string[]; unnamed: number }`. When `skipped` is non-empty, the success state shows the notice and a **Back to meal** pill wired to `onBackToMeal`, and, only while `state === 'success'`, `guardedClose` calls `onBackToMeal` instead of `onClose`, so ✕, the backdrop and Escape all end the session and leave.

## 5. Ownership

| Role | Owns |
|---|---|
| **frontend** | `lib/meal-cook-stream.ts` (`canStartEarly`); `lib/api/recipes.ts` (`confirmCook`); `types/recipes.ts` (`CookConfirmResponse`); `lib/cook-skipped.ts`; `app/meals/[id]/cook/page.tsx` (the `handleStartEarly` guard, `doConfirm`'s skipped handling); their tests; `verify`; the PR body |
| **ui-ux** | `components/meal/MealNowCard.tsx`; `components/timers/TimerDock.tsx`; `components/timers/TimerDockLayer.tsx`; `components/Providers.tsx`; `components/recipes/GuidedCookFlow.tsx` (the raise hook and the scroll padding); `components/recipes/CookModal.tsx`; `components/meal/MealCookSheet.tsx`; `components/cook/SkippedDeductionsNotice.tsx`; their tests |

**Build order:**
1. frontend commits `canStartEarly`, `CookConfirmResponse`, `confirmCook` and `lib/cook-skipped.ts` first.
2. ui-ux works from that commit (`TimerDock` and `TimerDockLayer` can start at once).
3. frontend wires the page.
4. `verify`.

## 6. Where it's built

The shared worktree is on PR #670's branch mid-verify, and other worktrees can't be written. So this starts after PR #670 merges. That also resolves the `MealNowCard` conflict by building on PR #670's row.

There's no migration and no backend change.

## 7. Tests (jest; `npx tsc --noEmit`; `npx eslint src`)

Each **(fails on main)** test must be seen red at `69ad84f` first, and the PR body says so.

**Issue #663:**
- **`meal-cook-stream.test.ts`:**
  - `canStartEarly` is false with `waiting_on`, true without, and false for `active`, `waiting` and `finished` **(fails on main)**.
  - Through `deriveStream`, a second dish's not-yet-due first step, while the first dish's hands-off step runs, is `true`. So the rule is per-dish.
  - **Skip chain:** *simmers* running, *rests* skipped, *fluff* upcoming: `waiting_on` is *simmers* and `canStartEarly` is false **(fails on main)**.
- **`meal-now-card.test.tsx`:**
  - **Change :103–129:** with `waiting_on`, there's no Start now, and Skip fires **(fails on main)**. The PR body names this as a changed test, because it encoded the bug.
  - Extend :131–144: without `waiting_on`, Start now fires `onStartEarly`.
- **`meal-cook-page.test.tsx`**, on the :312 fixture:
  - the waiting-on line reads "Simmer sauce", there's no Start now, and Skip is present **(fails on main)**;
  - after `timer-1` completes, the waiting-on line is gone and Start now is present. It doesn't assert `active`: the fixture's `hold_to_plan` floor keeps *Plate up* at 13, so "turns active" is left to §8 step 2.

**Issue #664 (new `timer-dock-layout.test.tsx`, mocking `useCookingTimers`; three long-label timers):**
- Collapsed is `data-layout="row"` with `flex-shrink-0` badges; expanded is `"stack"` **(fails on main)**. The toggle has `min-h-[44px] min-w-[44px]` in both.
- For each timer, the pause, +2 min and Dismiss buttons have `whitespace-nowrap`, `flex-shrink-0` and `min-h-[44px]`, and the labels have `min-w-0 truncate` without `max-w-[90px]` **(fails on main)**.
- The third timer's Dismiss and +2 min call `dismiss('t3')` and `extend('t3', 120)`; four timers render four rows. These are wiring guards.
- jsdom can't measure layout; §8 proves the fit.

**Issue #657 (new `timer-dock-layer.test.tsx`, reusing `guided-cook-flow.test.tsx`'s mocks, with one running timer):**
- Rendering `TimerDockLayerProvider` › (`TimerDock` + `GuidedCookFlow`), then clicking `Expand timers`: the `timer-dock` shell has `data-raised="true"` and `z-[9991]` **(fails on main)**; the shell renders there, with neither. jsdom ignores z-index, so the test makes no "reachable" claim; §8 proves that.
- The step scroll body has `pb-[calc(6rem+env(safe-area-inset-bottom))]` while raised with a timer, and not without one.
- Clicking `Ask Bubbles about this step` gives `data-raised="false"` and `z-40`. Closing it restores `"true"`.
- Unmounting `GuidedCookFlow` gives `"false"`.
- `TimerDock` with no provider stays `z-40`.
- The existing dock tests and `guided-cook-flow.test.tsx` pass unmodified.

**Issue #621:**
- **`recipes-api-confirm.test.ts`:**
  - `confirmCook` resolves to the body with `deductions_skipped` **(fails on main: it resolves `undefined`)**;
  - a 200 with a non-JSON body resolves `deductions_skipped: []` and doesn't throw;
  - a 500 still throws.
- **`cook-skipped.test.ts`:** names come from the matches and from compound components; duplicates collapse; an unknown id counts as `unnamed`; an empty list gives zero.
- **`skipped-deductions-notice.test.tsx`:** renders "Couldn't update 2 items: Butter, Flour. Check your pantry.", uses "and 2 more" past three, and renders nothing at zero.
- **`CookModal`** (a new file, or added to `cook-flow-redesign.test.tsx`), with `confirmCook` resolving `{ deductions_skipped: ['p-butter'] }`:
  - the success state shows the notice naming Butter **(fails on main)**;
  - with fake timers, `router.push` isn't called after 1200ms, and **Continue** pushes `/chat?cooking=…`;
  - dismissing via ✕ (`Close`) and via Escape each call `onCooked`, `onClose` and that push; Continue then Escape calls `onCooked` once;
  - a draft with the notice, dismissed with ✕, calls only `onClose`;
  - `[]` keeps today's redirect;
  - `chat-cook-two-tab-guard.test.tsx` passes **unmodified** (it resolves `undefined`).
- **`meal-cook-page.test.tsx`**, with `confirmMealCook` resolving `{ ...CONFIRM_RESPONSE, deductions_skipped: [<a match's id>] }`:
  - the sheet shows the notice with that item's name, and there's no redirect after 1200ms **(fails on main)**;
  - **Back to meal** pushes `/meals/meal-1`, and so do ✕ and Escape;
  - `[]` keeps the redirect.
- **`cook-skipped.test.ts`** also covers a proposal with no `compound_suggestions`, a suggestion with no `component_items`, and a match with a null `pantry_item_name` (named by `ingredient_name`).

## 8. `verify` (375×812; screenshots as absolute `blob/<sha>/…?raw=true` URLs)

Run each bug's reproduction on `main` first, then on the branch.

**Issue #663:**
1. In a meal cook-along, start a hands-off step whose dish has a dependent step. The upcoming card reads "after ‹step›" with **no Start now**; Skip is present. On main, Start now shows.
2. Use a two-dish meal where dish B's first step has no dependency and starts later than dish A's hands-off step. While A's step runs, B's first step (when it is the upcoming card) still offers Start now. When A's step completes, its dependent turns `active`.

**Issue #664:**

3. Get three long-label timers running (hands-off steps, or a recipe page's Prep/Cook/Total quick-set), then expand the dock.
   - Screenshot.
   - Run this and paste the output:
     ```js
     [...document.querySelectorAll('[data-testid="timer-dock"] button')].map(b => {
       const r = b.getBoundingClientRect(), hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
       const tn = [...b.childNodes].find(n => n.nodeType === 3), rg = document.createRange(); if (tn) rg.selectNodeContents(tn)
       return { label: b.getAttribute('aria-label'), onScreen: r.left >= 0 && r.right <= innerWidth, uncovered: hit?.closest('button') === b, oneLine: !tn || rg.getClientRects().length === 1, h: Math.round(r.height) }
     })
     ```
   - Every row must be `onScreen`, `uncovered` and `oneLine`, with `h >= 44`. On main, a Dismiss fails `uncovered` or `onScreen`, and "+2 min" fails `oneLine`.
4. Repeat with four timers. Tap the fourth timer's +2 min, then its Dismiss. Collapse. Screenshot each.

**Issue #657:**

5. Open a recipe's guided cook and start a step timer. Screenshot: **the dock over cook mode**.
   - Scroll the step body to its end, then run the step 3 snippet with `[data-testid="guided-cook-back"], [data-testid="guided-cook-next"], [data-testid="step-timer-chip"], [data-testid="structured-step-timer-chip"], [data-testid="guided-cook-ask-bubbles"]` added to the selector. The dock's controls, **Back/Next**, the timer chips and **Ask Bubbles about this step** must all be `uncovered`.
   - Also check `dock.getBoundingClientRect().bottom <= next.parentElement.getBoundingClientRect().top`.
   - Repeat with the dock expanded and three timers, checking only the dock's buttons plus Back and Next. The chips and Ask Bubbles may be covered by the expanded stack; that's accepted (collapse is one tap).
6. Tap **Ask Bubbles about this step**. Screenshot: the overlay covers the dock (`elementFromPoint` at the dock's centre isn't inside `timer-dock`). Close it, and the dock is back on top.
7. Exit guided cook. The dock is back at its normal position. Open the pantry's add sheet: the sheet covers the dock. Screenshot.

**Issue #621:**

8. Open **I already made this** (CookModal) for a recipe with a matched pantry item. In a second tab, delete that pantry item, then confirm in the first tab.
   - Screenshot the notice naming it. It stays; there's no redirect until **Continue** (or ✕, which does the same).
   - On main, it shows "Pantry updated!" and redirects.
9. Do the same for a meal cook's combined sheet (delete a matched item before **Update pantry**). Screenshot the notice and **Back to meal**.
10. A normal confirm with nothing refused still auto-redirects as today.

## 9. Reversible product calls (log each in the sprint doc)

1. **#663:** the rule is a pure `canStartEarly` over the existing `waiting_on`, shared by the card and the page guard.
   - *Rejected:* a new `NowCard` field, which duplicates `waiting_on` and touches every fixture.
   - *Rejected:* a check only in the card.
2. **#663:** hide Start now; don't disable it. *Rejected:* a disabled button with a hint; the "after" line already explains the wait. Only the step's own dish's running dependencies block it. *Rejected:* also blocking on another dish's oven or the cook's hands (§10).
3. **#664:** the expanded dock stacks one full-width row per timer, with 44px controls, capped at 50vh.
   - *Rejected:* `flex-wrap`, where a wide badge still overflows.
   - *Rejected:* horizontal scroll, which leaves Dismiss off-screen.
   - *Rejected:* a per-timer popover.
   - The collapsed dock keeps its single row (44px toggle, non-shrinking badges).
4. **#657:** raise the dock above guided (`z-[9991]`, `bottom 96px`) only while guided is open.
   - *Rejected:* a global z bump, which would put the dock over every `z-[60]` sheet on every route.
   - *Rejected:* an inline timer strip in cook mode, which duplicates the dock's controls and live region.
   - *Rejected:* portalling the dock into guided, which remounts the live region and loses announcements.
5. **#657:** the dock drops under guided while Ask Bubbles is open. *Rejected:* portalling the overlay out of the guided root to slot the dock between them, which is a larger move inside a file PR #670 just reshaped.
6. **#621:** show the notice in the same success state, and pause the auto-redirect until the user taps.
   - *Rejected:* keeping the 1.2s redirect, which is too short to read.
   - *Rejected:* a toast on the next page, which needs cross-route state.
   - *Rejected:* an error state; the cook did land.
7. **#621:** names are resolved on the client from the proposal. *Rejected:* having the backend return names, which changes two ai-service responses for data the client already holds.

## 10. Out of scope

- **Start now overlapping another dish's oven or the cook's hands** (a scheduler rule).
- **The due-now edge.** An overdue running dependency (for example, its timer is paused) lets its dependent turn `active` at the same minute. Noted in the PR body as a known gap.
- **The expanded dock floating over page content** (it now caps at 50vh), and tap-outside-to-collapse.
- **Why a deduction was refused.** The server returns ids only, so the notice says "check your pantry", not the reason.
- **A `replay_applied` meal confirm** returns `deductions_skipped: []` (`meals_ai.py`:331–340), so items refused on the first attempt are lost if the confirm is auto-retried. Accepted: it needs a lost response plus a refusal, which is rare.
- **Issue #671**, *Single-recipe cook confirm awards the rescue bonus for items the server refused to deduct* (open). The single-recipe proxy builds its rescue ids from the request, so refused items still earn the bonus; the meal proxy already excludes them. Filed separately.
- **A Playwright e2e.** §8's in-page hit-tests are the layout evidence.
- **The final visual design** (Goal 3).

## 11. Needs the human

None. All four fixes are reversible UI calls within v1 scope, with no cost.

## §R Review 1 resolutions

| Finding | Where applied | Decision |
|---|---|---|
| S1 | §1 | `canStartEarly` is a type guard, `card is Extract<NowCard, { kind: 'upcoming' }>`, so `handleStartEarly` can read `stream.now.step` |
| S2 | §0 #663, §1, §7 | `deriveStream` walks deps through skipped steps to the first unfinished, non-skipped ancestors; stream test for simmers → rests (skipped) → fluff |
| S3 | §0 #621, §4, §7, §8 | CookModal's ✕, backdrop and Escape run the Continue path (`onCooked` included) while the notice shows, and "taking you to chat" is hidden; the sheet's `guardedClose` calls `onBackToMeal`. Tests cover ✕ and Escape in both |
| S4 | §7 #657 | The test expands the dock, then asserts `data-raised` / `z-[9991]`; the "reachable by role" claim is dropped (jsdom ignores z-index) |
| S5 | §0, §2, §7 | The expand toggle gets `min-h-[44px] min-w-[44px]`, so every dock button meets `h >= 44` |
| S6 | §0, §3, §7, §8 | Guided's scroll body (:641) gets bottom padding while raised with a timer (value per §R2 S4); the timer chips and Ask Bubbles join the step 5 hit-test |
| N1 | §0, §4, §7 | `compound_suggestions` and `component_items` are optional in `skippedDeductionNames`; the §0 "both carry both" claim is corrected |
| N2 | §10 | `replay_applied` returns `deductions_skipped: []`, so refusals before an auto-retry are lost. Accepted as rare |
| N3 | §0 layer table | Checked on `origin/main`: `TourOverlay` has no z-50 layer (:238 is a comment about BottomNav); its z-[60]–[63] rows got exact lines. The pantry FAB row now says the expanded stack can cover it, accepted with the reason |
| N4 | §0, §4 | The sheet reuses `onBackToMeal`; `onSuccessContinue` is dropped. `endMealCookSession` is idempotent |
| N5 | §8 step 2 | Names the two-dish shape: dish B's first step has no dependency, so it still offers Start now |
| Out of scope | §10 | Issue #671 (single-recipe rescue bonus for refused items) listed as filed separately |

## §R2 Review 2 resolutions

| Finding | Where applied | Decision |
|---|---|---|
| S1 | §7 #663 | The page test asserts no waiting-on line and Start now present after `timer-1`; `hold_to_plan` keeps *Plate up* at 13, so "turns active" stays only in §8 step 2 |
| S2 | §4 CookModal, §7 | `dismiss` is gated on `success && !isDraft && names.length + unnamed > 0`; a `continuedRef` stops a double `onCooked`. Tests: draft + ✕ calls only `onClose`; Continue then Escape calls `onCooked` once |
| S3 | §8 step 5 | The expanded repeat checks the dock's buttons plus Back and Next only; chips and Ask Bubbles are accepted as coverable |
| S4 | §2, §3, §7 | Padding is `pb-[calc(6rem+env(safe-area-inset-bottom))]`; §2 now says the 44px toggle makes the collapsed bar taller |
| N1 | §4 MealCookSheet | `guardedClose → onBackToMeal` only while `state === 'success'` |
| N2 | §4 `doConfirm` | `res?.deductions_skipped ?? []` |
| N3 | §4, §7 | Falls back to `ingredient_name` when `pantry_item_name` is null |
| N4 | §3 wiring | `useTimerDockRaised()` and `useCookingTimers()` sit above the early return with `useRaiseTimerDock` |

## §R3 Review 3 resolutions

| Finding | Where applied | Decision |
|---|---|---|
| N1 | §9 item 3 | Reworded: the collapsed dock keeps one row, with a 44px toggle and non-shrinking badges. |
| N2 | §4, §R2 S2 row | `dismiss` is gated on `names.length + unnamed > 0`, the same expression that shows the notice. |
