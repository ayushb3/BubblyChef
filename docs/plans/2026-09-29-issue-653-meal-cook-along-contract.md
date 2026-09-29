# Issue #653: meal cook-along, the contract

The contract shared by the two slices of issue #653, *meal cook-along*: the `lib/` logic and pages (frontend) and the presentational components (ui-ux). The parent spec is issue #647 ("Chat and meal UI", cook-along; "The deterministic meal scheduler (contract)", the `progress` input). The previous slice's contract is `2026-09-29-issue-652-meal-screen-contract.md`. Where this doc is silent, the issue and then the spec rule.

There is **no ai-service work** in this ticket. Every re-plan is local and synchronous: no network request after the cook-along has loaded the meal.

## Words

- **Step key**: `${dish_id}:${step_index}`, the scheduler's own `progress.steps` key. `dish_id` is the dish's recipe id, as on the meal screen.
- **Baseline plan**: `scheduleMeal` for the meal with no `progress`. It's the plan the meal screen shows, and the one the cook-along starts from.
- **Live plan**: `scheduleMeal` with the cook's `progress`. It's recomputed on every tap, timer event and clock tick.

## 1. Scheduler changes (`lib/meal-scheduler.ts`, frontend)

Both are additive. With no `progress`, or without the new flag, the output is byte-for-byte what it is today, and the existing #649 tests keep passing unchanged.

### 1a. `progress.hold_to_plan?: boolean`: re-plans keep the dishes landing together

Today a re-plan schedules every pending step *as soon as possible* from `now_minutes`. The baseline plan is as-late-as-possible from a common finish, so the first tap in a cook-along would pull every side forward and they would finish early and go cold. That breaks the spec's story 48 ("so that the other dishes still land together").

With `hold_to_plan: true`, every pending step (one with no `progress` entry) also gets a floor: it can't start before `baseline_start + lateness`.

- `baseline_start` is that step's start in the baseline plan. It's computed internally by the same call on the same dishes, so it's deterministic and needs no new input.
- `lateness` = `max(0, max over every step with progress of (its fixed end − its baseline end))`. It only ever grows. A +2 min on any step pushes every pending step 2 minutes later, so everything still lands together. A Skip, or a Done tapped early, never pulls the rest earlier than the baseline: the cook waits rather than finishing a dish early.
- The existing guarantee 7 still holds: nothing new is placed before `now_minutes`, and done, skipped and running steps are unchanged.

The cook-along always passes `hold_to_plan: true`.

### 1b. `step_index` on row cells

Add `step_index: number` to `RowCellStart` and `RowCellOngoing`, so the table can mark a cell as done or current. The column identifies the dish.

## 2. The meal cook session (`lib/meal-cook-session.ts`, frontend)

This is a sibling of `lib/cook-session.ts` in the same module family, with the same storage discipline: `localStorage`, every read defensive against corrupt or absent storage, SSR-safe. It uses its own keys (`bubblychef:mealcook:activeSession`, `bubblychef:mealcook:endedMealIds`), so it never touches single-recipe cook state.

```ts
export interface MealCookStepRecord {
  status: 'done' | 'skipped' | 'running'
  started_at_minutes: number
  extra_minutes: number
  /** The dock timer started for a hands-off step, while it runs. */
  timer_id?: string
}

export interface MealCookSession {
  meal_id: string
  /** Epoch ms when cooking actually started. Offsets are minutes from here. */
  started_at_ms: number
  /** The dish recipe ids at start, by position. A later mismatch makes the session stale. */
  dish_ids: string[]
  steps: Record<string /* step key */, MealCookStepRecord>
  /** Reserved for issue #654 / the amendments work: per-dish ingredient amendments. Always {} here. */
  ingredient_amendments: Record<string /* dish_id */, unknown[]>
}
```

API (the names mirror `cook-session.ts`):

- `startMealCookSession(mealId, dishIds, nowMs)`: clears a stale ended record for this meal (a later cook of the same meal on another day must not be blocked) and writes a fresh active session. There is **one active meal session at a time**: starting one replaces any other.
- `saveMealCookProgress(session)`: a no-op when the meal is recorded as ended.
- `getActiveMealCookSession(mealId?)`: returns `null` when there's none, when storage is corrupt, when it's for another meal (if `mealId` is given), or when the meal is recorded as ended. **Ended is a one-way door** (issue #440's pattern).
- `clearActiveMealCookSession(mealId)`: the cook left without finishing ("Start over" and "Stop cooking"). This isn't "ended".
- `endMealCookSession(mealId)`: the ended list (capped at 20, oldest evicted first, like `MAX_ENDED_RECORDS`), and it clears the active record. In this ticket it's called from the finished screen's "Back to meal". Issue #654 moves it to after the combined deduction is confirmed.
- `isMealCookSessionEnded(mealId)`.

**Stale session:** if the meal's current dish recipe ids don't equal `session.dish_ids` (a side was swapped after cooking started), the session isn't resumable. The meal screen offers only "Start over", and the cook route redirects to the meal screen.

## 3. The stream (`lib/meal-cook-stream.ts`, frontend)

A pure function, with no clock read of its own. It's the one place that decides what the Now card is, and it's unit-tested directly.

```ts
export interface StreamStep {
  key: string
  dish_id: string
  column: Column
  dish_title: string
  step_index: number
  label: string
  /** The step's in-progress clause ("the sauce simmers"), for hands-off steps; null when absent. */
  ongoing_label: string | null
  text: string
  duration_minutes: number
  hands_on: boolean
  start: number        // live-plan offsets, minutes from started_at_ms
  end: number
}

export type NowCard =
  | { kind: 'active'; step: StreamStep }                          // do it now
  | { kind: 'upcoming'; step: StreamStep; starts_in_minutes: number;
      waiting_on?: StreamStep }                                   // next thing, not yet due
  | { kind: 'finished' }

export interface StreamState {
  timeline: MealTimeline      // the live plan (for the table sheet)
  now: NowCard
  next_up: StreamStep | null  // the step after the Now card's step, whichever dish
  running: StreamStep[]       // hands-off steps currently running (their timers are in the dock)
}

export function deriveStream(input: {
  dishes: SchedulerDish[]
  exclusive_tags: string[]
  session: MealCookSession
  now_minutes: number
}): StreamState
```

Rules:

1. The live plan is `scheduleMeal({ dishes, constraints: { exclusive_tags }, progress: { now_minutes, steps, hold_to_plan: true } })`.
2. A running **hands-on** step is always the Now card (`active`). At most one step is ever current. If the cook is past its planned end, its end is extended to `now` before scheduling, so the plan shows the lateness honestly (see 4, "overdue").
3. Otherwise the Now card is the first **pending** step in live-plan order (start, then column order main → side 1 → side 2, then step index):
   - If its start ≤ `now_minutes`, it's `active`.
   - If its start is later, it's `upcoming`, with `starts_in_minutes`. `waiting_on` names the running step it depends on, if any ("after the sauce simmers").
4. `finished` is when every step is done or skipped.
5. `next_up` is the pending step after the Now card's step in the same order.

## 4. What each action records (the cook-along page, frontend)

The cook-along keeps the `MealCookSession` in state, writes it through `saveMealCookProgress` on every change, and derives everything else with `deriveStream`. `now_minutes` = `floor((Date.now() − started_at_ms) / 60000)`, and it ticks every 15 seconds while the page is visible.

- **Becoming active:** when a hands-on step becomes the `active` Now card, record it as `running` at `max(its planned start, now)`, rounded down to a whole minute. A hands-off step isn't recorded until it's started.
- **Done on a hands-on step:** `done`. If it's late (now > start + duration + extra), set `extra_minutes` so the recorded end equals now. The scheduler already caps an early Done at `now`.
- **Done on a hands-off step ("Start"):** `running` at now, and start a dock timer with `useCookingTimers().start(step.label, duration*60)`. Store the returned id as `timer_id`. The dock names it with the step's short label, e.g. "Simmer the sauce".
- **+2 min** (only on an active hands-on step): `extra_minutes += 2`.
- **Skip:** `skipped` at `started_at_minutes = now`. It holds no resources, and its dependents unblock.
- **Start early** (on an `upcoming` card): records it as if it had become active now. The cook chose to get ahead.
- **Overdue hands-on running step:** before scheduling, if `now > start + duration + extra`, bump `extra` so the end = now (ceil). This is persisted only when something else is saved, and it never shrinks.
- **A running hands-off step's end follows its dock timer:** `end = now + ceil(remainingSeconds / 60)`, so `extra = max(0, end − start − duration)`. That makes a dock pause or a dock "+2 min" re-plan on the next derive.
- **Timer events:**
  - When the linked timer completes (`TIMER_COMPLETED_EVENT` while mounted, or found `completed` or missing on mount or reload), the step is `done` with its end at now. The dependent step comes up through rule 3.
  - A dismissed linked timer counts as done too.
- **Starting over:** "Start over" dismisses the session's running dock timers, then `clearActiveMealCookSession`.

### Timer store: `extend` (`lib/useCookingTimers.tsx`, frontend)

Add `extend(id, seconds)` to `CookingTimersContextValue`. On a running timer it adds to `endAt`, and on a paused one it adds to the frozen remaining time. It does nothing on a completed timer. The inert fallback gets a no-op.

## 5. Routes and wiring (frontend)

- **`/meals/[id]/cook`**: a full-screen cook-along page. It loads the meal with the same query as the meal screen, and builds scheduler dishes with the **same** helper the meal screen uses. Move `columnFor`, `fallbackSteps` and the dish building from `app/meals/[id]/page.tsx` into `lib/meal-dishes.ts`, so both pages schedule the identical meal. It then restores the active session for this meal.
  - With no session for this meal, or when the session is ended or stale, it redirects (`router.replace`) to `/meals/[id]`.
  - A reload mid-cook lands back on this route and restores directly. Being on the cook route is the "same flow, reloaded" signal, so no `sessionStorage` flag is needed.
- **The meal screen, `/meals/[id]`:**
  - With no active session: a **Start cooking** button. It calls `startMealCookSession` with `Date.now()` and navigates to `/cook`. It's disabled while any dish op is in flight, or when any dish has no steps and is still being upgraded (the existing `ensureSteps` pass).
  - With an active, non-stale session for this meal: a **"Resume cooking?"** banner with **Resume** (navigate) and **Start over** (clear, then start fresh). It never force-opens.
  - A stale session shows "This meal changed since you started cooking" with **Start over**.
- **Exit:** the cook-along header has a close control. It goes back to the meal screen and leaves the session active, so the banner offers Resume.

## 6. Components (`components/meal/`, ui-ux)

All presentational: props in, callbacks out, no fetching, no timers and no storage. They reuse the guided cook flow's layout pieces, the existing pill buttons and the table. **No new visual language:** the final look is Goal 3. The dish colours are `MealTimelineTable`'s `COLUMN_COLORS`. Export them so every dish tag uses the same pink/mint/peach.

- **`MealNowCard`**: `{ card: NowCard; clockLabel: (offsetMinutes) => string; onDone(); onExtend(); onSkip(); onStartEarly(); disabled?: boolean }`.
  - `active`, hands-on: a colour tag with the dish name, the step label (big), the step text, the duration, a "Hands-on" badge, and the pills **Done**, **+2 min** and **Skip**.
  - `active`, hands-off: the same, with a "Hands-off" badge and the pills **Start timer** (calls `onDone`) and **Skip**.
  - `upcoming`: "Next at 7:15 (in 6 min)", plus "after <waiting_on.label>" when set, a preview of the step, and **Start now** (calls `onStartEarly`) and **Skip**.
  - `finished` isn't rendered by this card. The page shows `MealCookFinished` instead.
- **`MealNextUp`**: `{ step: StreamStep | null; clockLabel }`. A small preview row: the dish colour dot, the dish name, the label and the clock time. It says "That's the last step" when null.
- **`MealRunningStrip`**: `{ steps: StreamStep[]; clockLabel }`. A compact list of the hands-off steps running now, e.g. "the sauce simmers · until 7:22". The live countdown stays in the dock.
- **`MealCookFinished`**: `{ mealTitle: string; onBackToMeal() }`. "Dinner's ready", and **Back to meal** only. The combined deduction arrives in issue #654.
- **`MealTimelineTable` progress props**, additive: `progress?: { statuses: Record<string /* `${column}:${step_index}` */, 'done' | 'skipped' | 'running'>; current?: { column: Column; step_index: number } }`. Done and skipped cells are faded (skipped is struck through), and the current cell is highlighted with a ring in its dish colour. With no `progress`, the output is unchanged.
- **`MealTimelineSheet`**: `{ open; onClose; children }`. A bottom sheet on the existing sheet pattern (the pantry add sheet's), with focus trapped and closed on Escape, that the page fills with the table in clock mode (`anchor = { status: 'clock', start_at }`).
- **`TimerDock` "+2 min"**: a button on running and paused timers, calling `extend(id, 120)`. Its aria-label is `Add 2 minutes to <label> timer`.

## 7. Tests

- **Scheduler** (frontend): `hold_to_plan`:
  - (a) The first Done on the main doesn't pull the sides earlier than the baseline.
  - (b) +2 min on a step shifts every pending step by 2.
  - (c) A skip doesn't pull the rest earlier than the baseline.
  - (d) Guarantee 7 still holds.
  - (e) Without the flag, output is unchanged (the existing suite).
- **The stream** (frontend), pure unit tests on `deriveStream`:
  - an active hands-on step;
  - an upcoming card with `waiting_on`;
  - at most one active step;
  - `next_up` across dishes;
  - `finished`;
  - a degraded (sequential-fallback) dish flowing through in order;
  - an overdue running step extending the plan.
- **The session** (frontend), mirroring `cook-session-resume` and `cook-session-teardown`:
  - save and restore;
  - the ended guard;
  - a start clearing a stale ended record;
  - one active session at a time;
  - corrupt storage;
  - a stale dish-id mismatch.
- **Component and page** (frontend and ui-ux), the ACs:
  - The Now-card stream: Done advances; +2 min and Skip re-plan, and the next-up and table update with no fetch.
  - A hands-off Start calls `timers.start` with the label.
  - A `TIMER_COMPLETED_EVENT` for the linked timer surfaces the dependent step.
  - A dock `extend` re-plans.
  - A reload restores the stream.
  - The meal screen shows "Resume cooking?" rather than redirecting.
  - The finished screen appears.
