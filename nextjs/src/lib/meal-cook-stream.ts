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

function dependencyKeysOf(dishes: SchedulerDish[], dishId: string, stepIndex: number): string[] {
  const dish = dishes.find((d) => d.dish_id === dishId)
  const step = dish?.steps[stepIndex]
  return (step?.depends_on ?? []).map((i) => `${dishId}:${i}`)
}

function withStep(session: MealCookSession, key: string, record: MealCookStepRecord): MealCookSession {
  return { ...session, steps: { ...session.steps, [key]: record } }
}

function buildStreamSteps(dishes: SchedulerDish[], timeline: MealTimeline): StreamStep[] {
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
 * A running hands-off step's end follows its dock timer: `end = now +
 * ceil(remainingSeconds / 60)`, so `extra = max(0, end - start - duration)`.
 * A dock pause or a dock "+2 min" changes `remainingSeconds`, so calling this
 * again picks that up and re-plans on the next `deriveStream`. Does nothing
 * for a step whose linked timer is missing or `completed` — that transition
 * is `findTimerCompletedSteps` + `recordDone` instead, not an extra-minutes
 * adjustment.
 */
export function applyTimerState(
  session: MealCookSession,
  timers: Pick<CookingTimer, 'id' | 'status' | 'remainingSeconds'>[],
  dishes: SchedulerDish[],
  nowMinutes: number,
): MealCookSession {
  const durationByKey = durationLookup(dishes)
  const timerById = new Map(timers.map((t) => [t.id, t]))
  let changed = false
  const steps: Record<string, MealCookStepRecord> = { ...session.steps }

  for (const [key, rec] of Object.entries(session.steps)) {
    if (rec.status !== 'running' || !rec.timer_id) continue
    const timer = timerById.get(rec.timer_id)
    if (!timer || timer.status === 'completed') continue
    const duration = durationByKey.get(key)
    if (duration === undefined) continue
    const end = nowMinutes + Math.ceil(timer.remainingSeconds / 60)
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
 */
export function recordDone(session: MealCookSession, step: StreamStep, nowMinutes: number): MealCookSession {
  const existing = session.steps[step.key]
  const startedAt = existing?.started_at_minutes ?? step.start
  const existingExtra = existing?.extra_minutes ?? 0
  const nominalEnd = startedAt + step.duration_minutes + existingExtra
  const extra = nowMinutes > nominalEnd ? nowMinutes - startedAt - step.duration_minutes : existingExtra
  return withStep(session, step.key, { status: 'done', started_at_minutes: startedAt, extra_minutes: extra })
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
 * Skip: `skipped` at `started_at_minutes = now`. Holds no resources (the
 * scheduler frees a skipped step's resources immediately — see
 * `scheduleWithProgress`), so its dependents unblock right away.
 */
export function recordSkip(session: MealCookSession, step: StreamStep, nowMinutes: number): MealCookSession {
  return withStep(session, step.key, {
    status: 'skipped',
    started_at_minutes: Math.floor(nowMinutes),
    extra_minutes: 0,
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

  // Rule 4: finished when every step is done or skipped. (Status checks use
  // the real `session`, not `effective` — `applyOverdueRunningSteps` only
  // ever touches `extra_minutes`, never `status`, so they agree either way.)
  const isDoneOrSkipped = (s: StreamStep) => {
    const status = session.steps[s.key]?.status
    return status === 'done' || status === 'skipped'
  }
  if (streamSteps.length > 0 && streamSteps.every(isDoneOrSkipped)) {
    return {
      timeline,
      now: { kind: 'finished' },
      next_up: null,
      running: streamSteps.filter((s) => !s.hands_on && session.steps[s.key]?.status === 'running'),
    }
  }

  const runningHandsOff = streamSteps.filter(
    (s) => !s.hands_on && session.steps[s.key]?.status === 'running',
  )

  // Rule 2: a running hands-on step is always the Now card — at most one is
  // ever current (guarantee 1 on the scheduler side: a single shared cook
  // resource).
  const runningHandsOn = streamSteps.find((s) => s.hands_on && session.steps[s.key]?.status === 'running')

  // Rule 3: otherwise, the first pending step (no progress entry yet) in
  // live-plan order.
  const pending = streamSteps.filter((s) => !session.steps[s.key])

  let now: NowCard
  if (runningHandsOn) {
    now = { kind: 'active', step: runningHandsOn }
  } else {
    const first = pending[0]
    if (!first) {
      // Nothing running, nothing pending, but not every step is done/skipped
      // either — shouldn't happen with a consistent session (every step is
      // exactly one of pending/running/done/skipped), but stay total rather
      // than throwing on a future bug.
      return { timeline, now: { kind: 'finished' }, next_up: null, running: runningHandsOff }
    }
    if (first.start <= now_minutes) {
      now = { kind: 'active', step: first }
    } else {
      const waitingOnKey = dependencyKeysOf(dishes, first.dish_id, first.step_index).find(
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

  // Rule 5: next_up is the pending step after the Now card's step. When the
  // Now card is the running hands-on override (not itself pending), that's
  // simply the first pending step; otherwise it's the one after `first`.
  const next_up = runningHandsOn ? pending[0] ?? null : pending[1] ?? null

  return { timeline, now, next_up, running: runningHandsOff }
}
