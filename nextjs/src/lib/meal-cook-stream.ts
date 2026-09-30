/**
 * Issue #653 — the meal cook-along stream: the one place that decides what
 * the Now card is, and the pure per-action recorders that turn a tap (or a
 * timer event) into an updated `MealCookSession`. Both are pure and
 * framework-free, same discipline as `lib/meal-scheduler.ts`: no clock read
 * of its own (`now_minutes` is always passed in), no I/O. The cook-along page
 * (a later slice) keeps the session in state, calls these recorders, writes
 * the result through `saveMealCookProgress`, and re-derives everything else
 * by calling `deriveStream` again — so the page itself carries almost no
 * scheduling logic.
 *
 * `StreamStep.key` is the scheduler's own `${dish_id}:${step_index}` (see
 * `meal-scheduler.ts`'s `keyOf`), reused as `MealCookSession.steps`' key —
 * the two modules agree on this shape without either importing the other's
 * internals.
 */

import {
  sanitizedDependencyKeys,
  scheduleMeal,
  type Column,
  type MealTimeline,
  type SchedulerDish,
  type StepProgress,
} from '@/lib/meal-scheduler'
import type { MealCookSession, MealCookStepRecord } from '@/lib/meal-cook-session'
import type { CookingTimer } from '@/lib/useCookingTimers'

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
  /** Live-plan offsets, minutes from `session.started_at_ms`. */
  start: number
  end: number
}

export type NowCard =
  | { kind: 'active'; step: StreamStep } // do it now
  | {
      kind: 'upcoming'
      step: StreamStep
      starts_in_minutes: number
      waiting_on?: StreamStep
    } // next thing, not yet due
  | {
      kind: 'waiting'
      /**
       * Issue #653 review round 1 (B2) — nothing pending or hands-on to show,
       * but one or more hands-off steps are still running (their timers are
       * in the dock). Distinct from `finished`: the cook still has to come
       * back once a timer's done. Carries the same running list `StreamState`
       * does, so a `waiting` card can render without also reading `running`.
       */
      running: StreamStep[]
    }
  | { kind: 'finished' }

export interface StreamState {
  timeline: MealTimeline // the live plan (for the table sheet)
  now: NowCard
  next_up: StreamStep | null // the step after the Now card's step, whichever dish
  running: StreamStep[] // hands-off steps currently running (their timers are in the dock)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

/**
 * Mirrors `meal-scheduler.ts`'s own duration default (`sanitizeDish`: a
 * missing/invalid duration becomes 3 minutes) so the overdue/timer math here
 * agrees with what the scheduler will actually place. A small, deliberate
 * duplication of that one fallback rule rather than running `scheduleMeal`
 * twice per derive (once to sanitize, once for real) just to read durations
 * back out.
 */
function effectiveDuration(raw: number): number {
  if (!Number.isFinite(raw) || raw <= 0) return 3
  return Math.round(raw)
}

function durationLookup(dishes: SchedulerDish[]): Map<string, number> {
  const map = new Map<string, number>()
  for (const d of dishes) {
    d.steps.forEach((s, i) => map.set(`${d.dish_id}:${i}`, effectiveDuration(s.duration_minutes)))
  }
  return map
}

function withStep(session: MealCookSession, key: string, record: MealCookStepRecord): MealCookSession {
  return { ...session, steps: { ...session.steps, [key]: record } }
}

/**
 * Every step in `timeline`, as `StreamStep[]` in live-plan order. Exported
 * (issue #653 slice B) so the cook-along page can build a `key -> StreamStep`
 * lookup for `recordDone` when a linked timer completes — `deriveStream`'s
 * own `StreamState` only surfaces now/next_up/running, not the full list.
 */
export function buildStreamSteps(dishes: SchedulerDish[], timeline: MealTimeline): StreamStep[] {
  const titleByDish = new Map(dishes.map((d) => [d.dish_id, d.title]))
  // `timeline.placements` is already sorted (start, then column order, then
  // step index — `meal-scheduler.ts`'s `buildTimeline`), exactly the "live-
  // plan order" rule 3 asks for — no re-sort needed here.
  return timeline.placements.map((p) => ({
    key: `${p.dish_id}:${p.step_index}`,
    dish_id: p.dish_id,
    column: p.column,
    dish_title: titleByDish.get(p.dish_id) ?? '',
    step_index: p.step_index,
    label: p.label,
    ongoing_label: p.ongoing_label,
    text: p.text,
    duration_minutes: p.duration_minutes,
    hands_on: p.hands_on,
    start: p.start,
    end: p.end,
  }))
}

// ---------------------------------------------------------------------------
// Section 4 — "overdue" and "timer state" re-planning inputs
// ---------------------------------------------------------------------------

/**
 * Bumps `extra_minutes` on any running step whose nominal end
 * (`started_at_minutes + duration + extra_minutes`) has already passed
 * `now_minutes`, so its recorded end becomes `now` — "before scheduling, if
 * now > start + duration + extra, bump extra so end = now". Never shrinks an
 * existing `extra_minutes` (only called when the step is *already* overdue,
 * and the bump is exactly the amount needed to reach `now`, which is by
 * definition larger than what's there). Returns `session` unchanged (same
 * reference) when nothing needed bumping, so a caller can cheaply tell
 * whether anything changed.
 *
 * `deriveStream` calls this on every derive purely to build an honest live
 * plan — that result is never itself persisted from within `deriveStream`.
 * The page calls this same function again whenever it's about to persist a
 * session for some other reason, so the bump is "locked in" rather than lost
 * the next time the page reloads mid-overdue-step.
 */
export function applyOverdueRunningSteps(
  session: MealCookSession,
  dishes: SchedulerDish[],
  nowMinutes: number,
): MealCookSession {
  const durationByKey = durationLookup(dishes)
  let changed = false
  const steps: Record<string, MealCookStepRecord> = { ...session.steps }

  for (const [key, rec] of Object.entries(session.steps)) {
    if (rec.status !== 'running') continue
    const duration = durationByKey.get(key)
    if (duration === undefined) continue
    const nominalEnd = rec.started_at_minutes + duration + rec.extra_minutes
    if (nowMinutes > nominalEnd) {
      steps[key] = { ...rec, extra_minutes: nowMinutes - rec.started_at_minutes - duration }
      changed = true
    }
  }

  return changed ? { ...session, steps } : session
}

/**
 * A running hands-off step's end follows its dock timer. Issue #653 review
 * round 1 (S2) — computed from real elapsed wall-clock time rather than two
 * independently-floored minute counts: `end = ceil((nowMs -
 * session.started_at_ms) / 60000 + remainingSeconds / 60)`. The old
 * `nowMinutes + ceil(remainingSeconds / 60)` rounded "now" down to a whole
 * minute and the timer's remaining time up to one *separately*, so the sum
 * could drift by up to a minute either way tick to tick — including
 * oscillating back down — even though nothing about the timer had actually
 * changed. Elapsed-ms-based rounding only ever moves forward as real time
 * passes, so the same tick 15 seconds apart never disagrees enough to change
 * the rounded minute. A dock pause or a dock "+2 min" changes
 * `remainingSeconds`, so calling this again picks that up and re-plans on
 * the next `deriveStream`. Does nothing for a step whose linked timer is
 * missing or `completed` — that transition is `findTimerCompletedSteps` +
 * `recordDone` instead, not an extra-minutes adjustment.
 */
export function applyTimerState(
  session: MealCookSession,
  timers: Pick<CookingTimer, 'id' | 'status' | 'remainingSeconds'>[],
  dishes: SchedulerDish[],
  nowMs: number,
): MealCookSession {
  const durationByKey = durationLookup(dishes)
  const timerById = new Map(timers.map((t) => [t.id, t]))
  let changed = false
  const steps: Record<string, MealCookStepRecord> = { ...session.steps }
  const elapsedMinutes = (nowMs - session.started_at_ms) / 60000

  for (const [key, rec] of Object.entries(session.steps)) {
    if (rec.status !== 'running' || !rec.timer_id) continue
    const timer = timerById.get(rec.timer_id)
    if (!timer || timer.status === 'completed') continue
    const duration = durationByKey.get(key)
    if (duration === undefined) continue
    const end = Math.ceil(elapsedMinutes + timer.remainingSeconds / 60)
    const extra = Math.max(0, end - rec.started_at_minutes - duration)
    if (extra !== rec.extra_minutes) {
      steps[key] = { ...rec, extra_minutes: extra }
      changed = true
    }
  }

  return changed ? { ...session, steps } : session
}

/**
 * Step keys whose linked dock timer just completed, was dismissed, or is
 * simply gone on mount/reload — "the linked timer completes (while mounted,
 * or found completed or missing on mount or reload), the step is done ...
 * A dismissed linked timer counts as done too." The page listens for
 * `TIMER_COMPLETED_EVENT` and also runs this check once on mount/reload
 * (when a timer may have completed, or been dismissed, while the tab was
 * closed); either way it calls `recordDone` for each key this returns.
 */
export function findTimerCompletedSteps(
  session: MealCookSession,
  timers: Pick<CookingTimer, 'id' | 'status'>[],
): string[] {
  const timerById = new Map(timers.map((t) => [t.id, t]))
  const keys: string[] = []
  for (const [key, rec] of Object.entries(session.steps)) {
    if (rec.status !== 'running' || !rec.timer_id) continue
    const timer = timerById.get(rec.timer_id)
    if (!timer || timer.status === 'completed') keys.push(key)
  }
  return keys
}

/**
 * Every dock timer id linked to a currently-running step — "Starting over:
 * 'Start over' dismisses the session's running dock timers, then
 * `clearActiveMealCookSession`." The page loops this and calls
 * `timers.dismiss(id)` for each before clearing the session.
 */
export function timerIdsToDismiss(session: MealCookSession): string[] {
  const ids: string[] = []
  for (const rec of Object.values(session.steps)) {
    if (rec.status === 'running' && rec.timer_id) ids.push(rec.timer_id)
  }
  return ids
}

// ---------------------------------------------------------------------------
// Section 4 — per-action recorders
// ---------------------------------------------------------------------------

/**
 * A hands-on step becoming the `active` Now card records it as `running` at
 * `max(its planned start, now)`, rounded down to a whole minute. A no-op for
 * a hands-off step (it isn't recorded until "Start" is actually tapped —
 * `recordStartTimer`) and for a step that's already recorded (this only
 * fires once, the instant a step *becomes* the active card).
 */
export function recordBecomingActive(
  session: MealCookSession,
  step: StreamStep,
  nowMinutes: number,
): MealCookSession {
  if (!step.hands_on) return session
  if (session.steps[step.key]) return session
  const startedAt = Math.floor(Math.max(step.start, nowMinutes))
  return withStep(session, step.key, { status: 'running', started_at_minutes: startedAt, extra_minutes: 0 })
}

/**
 * "Start now" on an `upcoming` hands-on card — the cook chose to get ahead
 * of the plan. Unlike `recordBecomingActive`, this always uses `now`
 * directly rather than `max(planned start, now)`: an upcoming card's planned
 * start is always later than now (that's what makes it upcoming), so the max
 * would just reproduce the plan's own timing and never actually start it
 * early. A hands-off "start early" goes through `recordStartTimer` instead
 * (starting a hands-off step always means starting its dock timer).
 */
export function recordStartEarly(
  session: MealCookSession,
  step: StreamStep,
  nowMinutes: number,
): MealCookSession {
  if (!step.hands_on) return session
  return withStep(session, step.key, {
    status: 'running',
    started_at_minutes: Math.floor(nowMinutes),
    extra_minutes: 0,
  })
}

/**
 * "Start" on a hands-off step: `running` at now, linked to the dock timer
 * the page already started (`useCookingTimers().start(step.label,
 * duration*60)`) — pass its returned id as `timerId`.
 */
export function recordStartTimer(
  session: MealCookSession,
  step: StreamStep,
  nowMinutes: number,
  timerId: string,
): MealCookSession {
  return withStep(session, step.key, {
    status: 'running',
    started_at_minutes: Math.floor(nowMinutes),
    extra_minutes: 0,
    timer_id: timerId,
  })
}

/**
 * Marks `step` done. If it's late (`now` is past its recorded nominal end),
 * `extra_minutes` is set so the recorded end equals `now` — the scheduler's
 * own done-capping (`min(nominalEnd, now)`) already handles an *early* Done
 * without any adjustment here. Shared by every "this step is now done"
 * trigger the contract names — a hands-on Done tap, a linked timer
 * completing, and a dismissed linked timer — since all three want exactly
 * this: done, with its end at `now` when `now` is at or past the nominal
 * end. Falls back to `step.start` for `started_at_minutes` if there's
 * somehow no existing record yet (defensive — in the normal flow a running
 * record was already written by `recordBecomingActive` / `recordStartTimer`
 * / `recordStartEarly` before Done is ever reachable).
 *
 * Issue #653 review round 1 (S1) — also fixes `ended_at_minutes` at `now`,
 * floored. Without it, a done step's *recorded* end kept climbing on every
 * later `deriveStream` call (`scheduleWithProgress`'s old `min(nominalEnd,
 * now)` recomputed against whatever `now_minutes` that later call happened
 * to pass, not the minute Done was actually tapped) — a step already
 * finished in the past kept looking like it was still "catching up" to its
 * nominal end. `ended_at_minutes` is written once, here, and never
 * recomputed.
 */
export function recordDone(session: MealCookSession, step: StreamStep, nowMinutes: number): MealCookSession {
  const existing = session.steps[step.key]
  const startedAt = existing?.started_at_minutes ?? step.start
  const existingExtra = existing?.extra_minutes ?? 0
  const nominalEnd = startedAt + step.duration_minutes + existingExtra
  const extra = nowMinutes > nominalEnd ? nowMinutes - startedAt - step.duration_minutes : existingExtra
  return withStep(session, step.key, {
    status: 'done',
    started_at_minutes: startedAt,
    extra_minutes: extra,
    ended_at_minutes: Math.floor(nowMinutes),
  })
}

/**
 * "+2 min", only meaningful on the currently active running step — a no-op
 * (returns `session` unchanged) if `key` isn't currently `running`.
 */
export function recordExtend(session: MealCookSession, key: string): MealCookSession {
  const existing = session.steps[key]
  if (!existing || existing.status !== 'running') return session
  return withStep(session, key, { ...existing, extra_minutes: existing.extra_minutes + 2 })
}

/**
 * Skip: `skipped`, holding no resources (the scheduler frees a skipped
 * step's resources immediately — see `scheduleWithProgress`), so its
 * dependents unblock right away.
 *
 * Issue #653 review round 1 (S1) — `started_at_minutes` now preserves an
 * existing `running` record's own start (a step already begun and then
 * skipped keeps the minute it actually started, not the minute it was
 * skipped), falling back to `now` only when there's no running record to
 * preserve (skipping a step that was never started, or already pending).
 * `ended_at_minutes` is fixed at `now`, same as `recordDone` — see that
 * function's doc comment.
 */
export function recordSkip(session: MealCookSession, step: StreamStep, nowMinutes: number): MealCookSession {
  const existing = session.steps[step.key]
  const startedAt =
    existing?.status === 'running' ? existing.started_at_minutes : Math.floor(nowMinutes)
  return withStep(session, step.key, {
    status: 'skipped',
    started_at_minutes: startedAt,
    extra_minutes: 0,
    ended_at_minutes: Math.floor(nowMinutes),
  })
}

/**
 * True when every step across every dish (keyed `${dish_id}:${step_index}`,
 * over every dish's own `steps` — not the live timeline) is `done` or
 * `skipped`, and there's at least one step: a meal with no steps at all
 * isn't "finished" (issue #653's own non-empty guard, kept). The one
 * definition of "is this cook-along finished" (issue #654 §3, S9) —
 * `deriveStream`'s own check below delegates to it, and
 * `lib/meal-cook-deduction.ts` calls it too, so a page that needs to know
 * "is this session finished" without building a full timeline can ask
 * without duplicating the rule.
 */
export function isMealCookFinished(session: MealCookSession, dishes: SchedulerDish[]): boolean {
  const stepKeys = dishes.flatMap((d) => d.steps.map((_, i) => `${d.dish_id}:${i}`))
  if (stepKeys.length === 0) return false
  return stepKeys.every((key) => {
    const status = session.steps[key]?.status
    return status === 'done' || status === 'skipped'
  })
}

// ---------------------------------------------------------------------------
// deriveStream
// ---------------------------------------------------------------------------

export function deriveStream(input: {
  dishes: SchedulerDish[]
  exclusive_tags: string[]
  session: MealCookSession
  now_minutes: number
}): StreamState {
  const { dishes, exclusive_tags, session, now_minutes } = input

  // Rule 2's "if the cook is past its planned end, its end is extended to
  // now before scheduling" — ephemeral: this adjusted copy only feeds the
  // live-plan schedule call below, and is never written back to `session`
  // from in here (the page decides separately whether/when to persist it,
  // via this same `applyOverdueRunningSteps`).
  const effective = applyOverdueRunningSteps(session, dishes, now_minutes)
  const progressSteps: Record<string, StepProgress> = {}
  for (const [key, rec] of Object.entries(effective.steps)) {
    progressSteps[key] = {
      status: rec.status,
      started_at_minutes: rec.started_at_minutes,
      extra_minutes: rec.extra_minutes,
      // Without this the scheduler falls back to `min(nominalEnd, now)`, and
      // a Skip or early Done drifts later with the clock (PR #661 review).
      ended_at_minutes: rec.ended_at_minutes,
    }
  }

  // Rule 1: the live plan is `scheduleMeal` with the cook's progress,
  // `hold_to_plan: true` always (issue #653's whole point — see
  // `meal-scheduler.ts`).
  const timeline = scheduleMeal({
    dishes,
    constraints: { exclusive_tags },
    progress: { now_minutes, steps: progressSteps, hold_to_plan: true },
  })

  const streamSteps = buildStreamSteps(dishes, timeline)

  // Status checks use the real `session`, not `effective` —
  // `applyOverdueRunningSteps` only ever touches `extra_minutes`, never
  // `status`, so they agree either way.
  const statusOf = (s: StreamStep) => session.steps[s.key]?.status

  // Issue #653 review round 1 (B1/B2) — precedence order, replacing the old
  // rules 2/3/4/5. `finished` (5) is last and only fires when every step is
  // done or skipped; it is never returned while anything — hands-on or
  // hands-off — is still running, which is what the old rule 4 got wrong
  // (a session with nothing pending and nothing hands-on running, but a
  // hands-off step still ticking in the dock, fell through to `finished`
  // even though the cook wasn't done).
  if (streamSteps.length > 0 && isMealCookFinished(session, dishes)) {
    return { timeline, now: { kind: 'finished' }, next_up: null, running: [] }
  }

  const runningHandsOff = streamSteps.filter((s) => !s.hands_on && statusOf(s) === 'running')
  const runningHandsOn = streamSteps.find((s) => s.hands_on && statusOf(s) === 'running')
  const pending = streamSteps.filter((s) => !session.steps[s.key])

  // (1) The earliest-due pending hands-off step — "hands-off never waits
  // behind hands-on": starting it costs nothing but a tap, and once started
  // its own clock ticks independently in the dock, so there's no reason to
  // hide it behind whatever hands-on step happens to be running. `pending`
  // is already in live-plan order (start time, then column, then step
  // index), so the first match here is the earliest-due one.
  const dueHandsOffPending = pending.find((s) => !s.hands_on && s.start <= now_minutes)

  let now: NowCard
  if (dueHandsOffPending) {
    now = { kind: 'active', step: dueHandsOffPending }
  } else if (runningHandsOn) {
    // (2) A running hands-on step is the Now card — at most one is ever
    // current (guarantee 1 on the scheduler side: a single shared cook
    // resource).
    now = { kind: 'active', step: runningHandsOn }
  } else {
    // (3) Otherwise, the first pending step, active if due, upcoming if not.
    const first = pending[0]
    if (!first) {
      // (4) Nothing pending, nothing hands-on running: `waiting` while one or
      // more hands-off steps are still running in the dock, since there's
      // still something left to come back to; otherwise every step really is
      // accounted for elsewhere and this is (5) `finished` — defensive, since
      // a consistent session already reaches the done/skipped check above in
      // that case, but staying total rather than throwing on a future bug.
      return runningHandsOff.length > 0
        ? {
            timeline,
            now: { kind: 'waiting', running: runningHandsOff },
            next_up: null,
            running: runningHandsOff,
          }
        : { timeline, now: { kind: 'finished' }, next_up: null, running: [] }
    }
    if (first.start <= now_minutes) {
      now = { kind: 'active', step: first }
    } else {
      // Issue #653 review round 1 (nit) — sanitized deps, so a degraded dish
      // (its `depends_on` fell back to running strictly in order) still shows
      // the real "after X" reason instead of none at all.
      const waitingOnKey = sanitizedDependencyKeys(dishes, first.dish_id, first.step_index).find(
        (depKey) => session.steps[depKey]?.status === 'running',
      )
      const waitingOn = waitingOnKey ? streamSteps.find((s) => s.key === waitingOnKey) : undefined
      now = {
        kind: 'upcoming',
        step: first,
        starts_in_minutes: first.start - now_minutes,
        waiting_on: waitingOn,
      }
    }
  }

  // next_up: the pending step after the Now card's step, in live-plan order.
  // The Now card's step isn't always `pending[0]` any more — the due-hands-
  // off-pending and running-hands-on overrides can each promote a step that
  // sits later in (or entirely outside) `pending` — so "the one after" is
  // found by key, not by a fixed index, falling back to `pending[0]` when the
  // Now card's step isn't itself in `pending` (the running-hands-on case).
  const nowStep = now.kind === 'active' || now.kind === 'upcoming' ? now.step : undefined
  const nowIndexInPending = nowStep ? pending.findIndex((s) => s.key === nowStep.key) : -1
  const next_up = nowIndexInPending === -1 ? pending[0] ?? null : pending[nowIndexInPending + 1] ?? null

  return { timeline, now, next_up, running: runningHandsOff }
}
