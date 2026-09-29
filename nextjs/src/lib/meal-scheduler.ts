/**
 * Issue #649 / #647 "The deterministic meal scheduler (contract)".
 *
 * A pure, framework-free module: no LLM call, no clock read (`Date.now()`),
 * no I/O, no randomness. Given a meal's dishes (each a `column` plus its
 * structured `Step[]`, from `@/types/recipes`, added by issue #648) and
 * optional constraints/progress, produces a `MealTimeline`: per-step
 * placements, display rows with cues, and warnings.
 *
 * Algorithm (the spec's own "intended approach"): backward, as-late-as-
 * possible list scheduling from a common finish time, with the cook (one
 * hands-on step at a time, across all dishes) and each exclusive tag as
 * unary resources, then shifted so the earliest start is 0. Implemented as
 * forward ("as soon as possible") resource-constrained list scheduling run
 * on the *reversed* dependency graph (successors become predecessors) —
 * mathematically the same thing, and it reuses one simulation engine for
 * every mode below. Every dish's last step is a source in the reversed
 * graph, so they all become eligible near reverse-time 0 and are scheduled
 * onto free resources as early as possible — which is exactly what makes
 * dish finishes land close together in real time (guarantee 4), without a
 * separate "pull finishes together" pass.
 *
 * Re-planning (progress supplied) instead runs the same engine *forward* in
 * real time from `now_minutes`, with done/skipped/running steps as fixed
 * placements and (for a running step) its resources pre-occupied until it
 * ends — see `scheduleWithProgress`.
 *
 * Guarantee 6 ("never longer than cooking the dishes one after another") is
 * additionally enforced as an explicit safety net on the initial-plan path:
 * the backward-ALAP plan is compared against a literal sequential plan
 * (main, then side 1, then side 2, each run alone) and the shorter of the
 * two is returned.
 */

import type { Step } from '@/types/recipes'

// ---------------------------------------------------------------------------
// Public input types
// ---------------------------------------------------------------------------

export type Column = 'main' | 'side_1' | 'side_2'

/** Column display/priority order — also guarantee 5's tie-break order. */
export const COLUMN_ORDER: readonly Column[] = ['main', 'side_1', 'side_2']

export interface SchedulerDish {
  dish_id: string
  column: Column
  title: string
  /** Structured steps in order — `depends_on` indices are positions in this array. */
  steps: Step[]
}

export interface SchedulerConstraints {
  /** Every dish's last step should end within this many minutes of the latest. Default 2. */
  finish_window_minutes?: number
}

export type StepProgressStatus = 'done' | 'skipped' | 'running'

export interface StepProgress {
  status: StepProgressStatus
  /** Offset (minutes from the real meal start) at which this step actually started. */
  started_at_minutes: number
  /** Sum of +2 min taps applied to this step. */
  extra_minutes: number
}

export interface MealProgress {
  /** The current offset from the actual meal start. */
  now_minutes: number
  /** Keyed by `${dish_id}:${step_index}`. */
  steps: Record<string, StepProgress>
}

export interface ScheduleMealInput {
  dishes: SchedulerDish[]
  constraints?: SchedulerConstraints
  progress?: MealProgress
}

// ---------------------------------------------------------------------------
// Public output types (the "Meal timeline")
// ---------------------------------------------------------------------------

export interface StepPlacement {
  dish_id: string
  column: Column
  step_index: number
  start: number
  end: number
  hands_on: boolean
  label: string
  text: string
  ongoing_label: string | null
  duration_minutes: number
}

export interface RowCellStart {
  kind: 'start'
  label: string
  text: string
  duration_minutes: number
  hands_on: boolean
}

export interface RowCellOngoing {
  kind: 'ongoing'
  /** Raw `ongoing_label` — null when the step has none (only ever required for hands-off steps). */
  ongoing_label: string | null
  /** The step's own short label, for display when `ongoing_label` is null. */
  label: string
  remaining_minutes: number
  hands_on: boolean
}

export interface RowCellWaiting {
  kind: 'waiting'
}

export interface RowCellDone {
  kind: 'done'
}

export type RowCell = RowCellStart | RowCellOngoing | RowCellWaiting | RowCellDone

export interface TimelineRow {
  offset_minutes: number
  cells: Partial<Record<Column, RowCell>>
  cue?: string
}

export type SchedulerWarning = 'finish_spread' | 'estimated_duration' | 'sequential_fallback'

/** Fixed output order for `MealTimeline.warnings`, independent of discovery order. */
const WARNING_ORDER: readonly SchedulerWarning[] = [
  'estimated_duration',
  'sequential_fallback',
  'finish_spread',
]

export interface MealTimeline {
  placements: StepPlacement[]
  total_minutes: number
  hands_on_minutes: number
  finish_spread_minutes: number
  rows: TimelineRow[]
  warnings: SchedulerWarning[]
  degraded: boolean
}

const DEFAULT_FINISH_WINDOW_MINUTES = 2

// ---------------------------------------------------------------------------
// Internal sanitized representation
// ---------------------------------------------------------------------------

interface SanitizedStep {
  index: number
  text: string
  label: string
  ongoing_label: string | null
  duration_minutes: number
  hands_on: boolean
  depends_on: number[]
  exclusive: string[]
}

interface SanitizedDish {
  dish_id: string
  column: Column
  title: string
  steps: SanitizedStep[]
}

/**
 * Defensive per-dish cleanup, ahead of scheduling:
 *  - A missing/invalid duration defaults to 3 minutes and raises `estimated_duration`
 *    (also raised when the step already carries `duration_estimated: true` from #648).
 *  - A `depends_on` entry that isn't a strictly-earlier valid index is dropped. #648's
 *    validators already guarantee this for anything that reached the DB, but the
 *    scheduler is defensive against any caller passing raw/unvalidated steps.
 *  - If any entry had to be dropped, the whole dish falls back to running its steps
 *    strictly in order (each step additionally depends on the one before it), and the
 *    `sequential_fallback` warning is raised with `degraded: true`.
 */
function sanitizeDish(
  dish: SchedulerDish,
  warnings: Set<SchedulerWarning>,
): { dish: SanitizedDish; degraded: boolean } {
  let sawInvalidDep = false

  const steps: SanitizedStep[] = dish.steps.map((s, i) => {
    let duration = s.duration_minutes
    let estimated = !!s.duration_estimated
    if (!Number.isFinite(duration) || duration <= 0) {
      duration = 3
      estimated = true
    }
    duration = Math.round(duration)
    if (estimated) warnings.add('estimated_duration')

    const rawDeps = s.depends_on ?? []
    const validDeps = rawDeps.filter((d) => Number.isInteger(d) && d >= 0 && d < i)
    if (validDeps.length !== rawDeps.length) sawInvalidDep = true

    return {
      index: i,
      text: s.text,
      label: s.label,
      ongoing_label: s.ongoing_label ?? null,
      duration_minutes: duration,
      hands_on: s.hands_on,
      depends_on: validDeps,
      exclusive: s.exclusive ?? [],
    }
  })

  let degraded = false
  if (sawInvalidDep) {
    degraded = true
    warnings.add('sequential_fallback')
    for (let i = 1; i < steps.length; i++) {
      const deps = new Set(steps[i].depends_on)
      deps.add(i - 1)
      steps[i].depends_on = Array.from(deps).sort((a, b) => a - b)
    }
  }

  return {
    dish: { dish_id: dish.dish_id, column: dish.column, title: dish.title, steps },
    degraded,
  }
}

// ---------------------------------------------------------------------------
// Generic resource-constrained list-scheduling engine
// ---------------------------------------------------------------------------

interface Node {
  key: string
  dish_id: string
  column: Column
  index: number
  duration: number
  hands_on: boolean
  exclusive: string[]
  /** Node keys (in the *active* graph direction) this node depends on. */
  deps: string[]
  /** Earliest this node could start due to a dependency outside the active node set. */
  ready_floor: number
}

function keyOf(dishId: string, index: number): string {
  return `${dishId}:${index}`
}

function columnRank(c: Column): number {
  return COLUMN_ORDER.indexOf(c)
}

/** guarantee 5's final tie-break: column order, then step index. */
function compareNode(a: Node, b: Node): number {
  return columnRank(a.column) - columnRank(b.column) || a.index - b.index
}

/**
 * Longest duration-chain from each node to a sink of the *active* node set
 * (forward graph: to the end of the dish; reversed graph: back to the start
 * of the dish — see `buildNodes`). Used to prioritize resource contention:
 * when two ready steps could start at the same time and need the same
 * resource, the one with more chained work still ahead of it goes first.
 *
 * This matters concretely: without it, two reverse-source hands-on steps
 * (e.g. a quick, dependency-free "grill the steak" and a "mash the
 * potatoes" that must follow a long boil) tie at reverse-time 0 for the
 * cook resource. Breaking that tie by column order alone serializes them
 * back-to-back in reverse time — which, once flipped to real time, pushes
 * the flexible step (grill) all the way to the end instead of letting it
 * run alongside the long hands-off boil, degrading a genuinely concurrent
 * meal into an effectively sequential one. Prioritizing the step with the
 * longer chain (mash, via its 15-minute boil predecessor) fixes it: mash
 * claims the earlier reverse slot (so it lands late in real time, right
 * where its dependency forces it), freeing grill to land early instead.
 */
function computeCriticalPath(nodes: Node[]): Map<string, number> {
  const dependents = new Map<string, string[]>()
  for (const n of nodes) dependents.set(n.key, [])
  for (const n of nodes) {
    for (const d of n.deps) {
      const arr = dependents.get(d)
      if (arr) arr.push(n.key)
    }
  }
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const memo = new Map<string, number>()
  function cp(key: string): number {
    const cached = memo.get(key)
    if (cached !== undefined) return cached
    const n = byKey.get(key)!
    let best = 0
    for (const k of dependents.get(key) ?? []) best = Math.max(best, cp(k))
    const val = n.duration + best
    memo.set(key, val)
    return val
  }
  for (const n of nodes) cp(n.key)
  return memo
}

type GraphDirection = 'forward' | 'reversed'

/**
 * Builds scheduling nodes for one or more dishes. `forward` uses each step's
 * own `depends_on`; `reversed` inverts every edge within each dish (a step's
 * dependents become its "deps"), which is what turns ASAP list scheduling
 * into the ALAP-from-a-common-deadline plan once transformed back — see the
 * module doc comment.
 */
function buildNodes(dishes: SanitizedDish[], direction: GraphDirection): Node[] {
  const forward: Node[] = []
  for (const dish of dishes) {
    for (const s of dish.steps) {
      forward.push({
        key: keyOf(dish.dish_id, s.index),
        dish_id: dish.dish_id,
        column: dish.column,
        index: s.index,
        duration: s.duration_minutes,
        hands_on: s.hands_on,
        exclusive: s.exclusive,
        deps: s.depends_on.map((d) => keyOf(dish.dish_id, d)),
        ready_floor: 0,
      })
    }
  }
  if (direction === 'forward') return forward

  const dependents = new Map<string, string[]>()
  for (const n of forward) dependents.set(n.key, [])
  for (const n of forward) for (const d of n.deps) dependents.get(d)!.push(n.key)
  return forward.map((n) => ({ ...n, deps: [...(dependents.get(n.key) ?? [])] }))
}

function resourceKeysOf(n: Node): string[] {
  return [...(n.hands_on ? ['__cook__'] : []), ...n.exclusive.map((t) => `tag:${t}`)]
}

/**
 * Serial schedule-generation: repeatedly schedules the ready node with the
 * smallest feasible start time (ties broken by column order then step
 * index — guarantee 5) onto its required resources — the single shared
 * "cook" resource for hands-on steps (guarantee 1), and one resource per
 * exclusive tag (guarantee 3). Dependencies gate readiness (guarantee 2).
 * Never idles a resource while eligible work exists, so it never does worse
 * than a fully sequential schedule of the same nodes (guarantee 6).
 *
 * `floor` is the earliest anything may start (0 for a from-scratch plan,
 * `now_minutes` when re-planning). `preBusy` seeds resources as already
 * occupied until a given time (used by re-planning for a running step).
 */
function simulateForward(
  nodes: Node[],
  floor: number,
  preBusy: Map<string, number> = new Map(),
): Map<string, { start: number; end: number }> {
  const byKey = new Map(nodes.map((n) => [n.key, n]))
  const scheduled = new Map<string, { start: number; end: number }>()
  const resourceFree = new Map(preBusy)
  const remaining = new Set(nodes.map((n) => n.key))
  const priority = computeCriticalPath(nodes)

  const getFree = (key: string) => Math.max(floor, resourceFree.get(key) ?? floor)
  const compareCandidates = (aKey: string, bKey: string) =>
    (priority.get(bKey) ?? 0) - (priority.get(aKey) ?? 0) ||
    compareNode(byKey.get(aKey)!, byKey.get(bKey)!)

  while (remaining.size > 0) {
    let bestKey: string | null = null
    let bestStart = Infinity

    for (const key of remaining) {
      const n = byKey.get(key)!
      if (!n.deps.every((d) => scheduled.has(d))) continue

      const depReady = n.deps.reduce(
        (acc, d) => Math.max(acc, scheduled.get(d)!.end),
        Math.max(floor, n.ready_floor),
      )
      const resReady = resourceKeysOf(n).reduce((acc, r) => Math.max(acc, getFree(r)), floor)
      const start = Math.max(depReady, resReady)

      if (bestKey === null || start < bestStart || (start === bestStart && compareCandidates(key, bestKey) < 0)) {
        bestKey = key
        bestStart = start
      }
    }

    if (bestKey === null) {
      // Defensive only — sanitizeDish() guarantees each dish's deps form a
      // DAG, so every node eventually becomes ready. Kept so this function
      // is total rather than looping forever on a future bug.
      const fallback = [...remaining]
        .map((k) => byKey.get(k)!)
        .sort(compareNode)[0]
      bestKey = fallback.key
      bestStart = floor
    }

    const n = byKey.get(bestKey)!
    const end = bestStart + n.duration
    scheduled.set(bestKey, { start: bestStart, end })
    for (const r of resourceKeysOf(n)) resourceFree.set(r, end)
    remaining.delete(bestKey)
  }

  return scheduled
}

function totalMinutesOf(placements: Map<string, { start: number; end: number }>): number {
  if (placements.size === 0) return 0
  let minStart = Infinity
  let maxEnd = -Infinity
  for (const { start, end } of placements.values()) {
    if (start < minStart) minStart = start
    if (end > maxEnd) maxEnd = end
  }
  return maxEnd - minStart
}

// ---------------------------------------------------------------------------
// The three planning modes
// ---------------------------------------------------------------------------

/** Backward ALAP-from-a-common-deadline plan, shifted so the earliest start is 0. */
function scheduleInitial(dishes: SanitizedDish[]): Map<string, { start: number; end: number }> {
  const reversedNodes = buildNodes(dishes, 'reversed')
  if (reversedNodes.length === 0) return new Map()

  const rev = simulateForward(reversedNodes, 0)
  const maxRevEnd = Math.max(...[...rev.values()].map((v) => v.end))

  const real = new Map<string, { start: number; end: number }>()
  for (const [key, { start, end }] of rev) {
    real.set(key, { start: maxRevEnd - end, end: maxRevEnd - start })
  }
  return real
}

/** Cook each dish fully, one after another, in column order — the guarantee-6 baseline. */
function scheduleSequential(dishes: SanitizedDish[]): Map<string, { start: number; end: number }> {
  const result = new Map<string, { start: number; end: number }>()
  let floor = 0
  for (const dish of dishes) {
    if (dish.steps.length === 0) continue
    const nodes = buildNodes([dish], 'forward')
    const sched = simulateForward(nodes, floor)
    for (const [k, v] of sched) result.set(k, v)
    floor = Math.max(floor, ...[...sched.values()].map((v) => v.end))
  }
  return result
}

/**
 * Re-plan from `progress`: done/skipped/running steps are fixed at their
 * recorded placement (guarantee 7), a running step's resources stay
 * occupied until it ends, and everything else is scheduled forward from
 * `now_minutes` — nothing new is placed earlier.
 */
function scheduleWithProgress(
  dishes: SanitizedDish[],
  progress: MealProgress,
): Map<string, { start: number; end: number }> {
  const result = new Map<string, { start: number; end: number }>()
  const preBusy = new Map<string, number>()
  const fixedKeys = new Set<string>()

  for (const dish of dishes) {
    for (const step of dish.steps) {
      const key = keyOf(dish.dish_id, step.index)
      const p = progress.steps[key]
      if (!p) continue

      const end = p.started_at_minutes + step.duration_minutes + (p.extra_minutes ?? 0)
      result.set(key, { start: p.started_at_minutes, end })
      fixedKeys.add(key)

      if (step.hands_on) {
        preBusy.set('__cook__', Math.max(preBusy.get('__cook__') ?? 0, end))
      }
      for (const tag of step.exclusive) {
        const rk = `tag:${tag}`
        preBusy.set(rk, Math.max(preBusy.get(rk) ?? 0, end))
      }
    }
  }

  const remainingNodes: Node[] = []
  for (const dish of dishes) {
    for (const step of dish.steps) {
      const key = keyOf(dish.dish_id, step.index)
      if (fixedKeys.has(key)) continue

      let readyFloor = 0
      const deps: string[] = []
      for (const d of step.depends_on) {
        const dk = keyOf(dish.dish_id, d)
        if (fixedKeys.has(dk)) {
          readyFloor = Math.max(readyFloor, result.get(dk)!.end)
        } else {
          deps.push(dk)
        }
      }

      remainingNodes.push({
        key,
        dish_id: dish.dish_id,
        column: dish.column,
        index: step.index,
        duration: step.duration_minutes,
        hands_on: step.hands_on,
        exclusive: step.exclusive,
        deps,
        ready_floor: readyFloor,
      })
    }
  }

  const sim = simulateForward(remainingNodes, progress.now_minutes, preBusy)
  for (const [k, v] of sim) result.set(k, v)
  return result
}

// ---------------------------------------------------------------------------
// Rows and cues
// ---------------------------------------------------------------------------

function buildCue(
  cells: Partial<Record<Column, RowCell>>,
): string | undefined {
  const startingCol = COLUMN_ORDER.find((col) => cells[col]?.kind === 'start')
  if (!startingCol) return undefined
  const startCell = cells[startingCol] as RowCellStart

  let bestCol: Column | null = null
  let bestRemaining = -1
  for (const col of COLUMN_ORDER) {
    const c = cells[col]
    if (c && c.kind === 'ongoing' && !c.hands_on) {
      if (c.remaining_minutes > bestRemaining) {
        bestRemaining = c.remaining_minutes
        bestCol = col
      }
    }
  }
  if (bestCol === null) return undefined

  const ongoingCell = cells[bestCol] as RowCellOngoing
  if (ongoingCell.ongoing_label) {
    return `While ${ongoingCell.ongoing_label}, ${startCell.label}`
  }
  return `Meanwhile, ${startCell.label}`
}

function buildTimeline(
  dishes: SanitizedDish[],
  placementsMap: Map<string, { start: number; end: number }>,
  finishWindowMinutes: number,
  warnings: Set<SchedulerWarning>,
  degraded: boolean,
): MealTimeline {
  if (dishes.every((d) => d.steps.length === 0)) {
    return {
      placements: [],
      total_minutes: 0,
      hands_on_minutes: 0,
      finish_spread_minutes: 0,
      rows: [],
      warnings: WARNING_ORDER.filter((w) => warnings.has(w)),
      degraded,
    }
  }

  const placements: StepPlacement[] = []
  for (const dish of dishes) {
    for (const s of dish.steps) {
      const key = keyOf(dish.dish_id, s.index)
      const p = placementsMap.get(key)
      if (!p) continue // defensive — every sanitized step should have a placement
      placements.push({
        dish_id: dish.dish_id,
        column: dish.column,
        step_index: s.index,
        start: p.start,
        end: p.end,
        hands_on: s.hands_on,
        label: s.label,
        text: s.text,
        ongoing_label: s.ongoing_label,
        duration_minutes: s.duration_minutes,
      })
    }
  }
  placements.sort(
    (a, b) =>
      a.start - b.start || columnRank(a.column) - columnRank(b.column) || a.step_index - b.step_index,
  )

  const total_minutes = totalMinutesOf(placementsMap)
  const hands_on_minutes = placements
    .filter((p) => p.hands_on)
    .reduce((acc, p) => acc + p.duration_minutes, 0)

  const placementsByDish = new Map<string, StepPlacement[]>()
  for (const dish of dishes) placementsByDish.set(dish.dish_id, [])
  for (const p of placements) placementsByDish.get(p.dish_id)!.push(p)

  const dishesWithSteps = dishes.filter((d) => d.steps.length > 0)
  const dishEnds = dishesWithSteps.map((d) =>
    Math.max(...placementsByDish.get(d.dish_id)!.map((p) => p.end)),
  )
  const finish_spread_minutes =
    dishEnds.length > 0 ? Math.max(...dishEnds) - Math.min(...dishEnds) : 0
  if (finish_spread_minutes > finishWindowMinutes) warnings.add('finish_spread')

  const startOffsets = Array.from(new Set(placements.map((p) => p.start))).sort((a, b) => a - b)

  const rows: TimelineRow[] = startOffsets.map((offset) => {
    const cells: Partial<Record<Column, RowCell>> = {}
    for (const dish of dishes) {
      const dishPlacements = placementsByDish.get(dish.dish_id)!
      if (dishPlacements.length === 0) {
        cells[dish.column] = { kind: 'done' }
        continue
      }

      const startingHere = dishPlacements.find((p) => p.start === offset)
      if (startingHere) {
        cells[dish.column] = {
          kind: 'start',
          label: startingHere.label,
          text: startingHere.text,
          duration_minutes: startingHere.duration_minutes,
          hands_on: startingHere.hands_on,
        }
        continue
      }

      const ongoing = dishPlacements.find((p) => p.start < offset && p.end > offset)
      if (ongoing) {
        cells[dish.column] = {
          kind: 'ongoing',
          ongoing_label: ongoing.ongoing_label,
          label: ongoing.label,
          remaining_minutes: ongoing.end - offset,
          hands_on: ongoing.hands_on,
        }
        continue
      }

      const dishEnd = Math.max(...dishPlacements.map((p) => p.end))
      cells[dish.column] = offset >= dishEnd ? { kind: 'done' } : { kind: 'waiting' }
    }

    const cue = buildCue(cells)
    return cue !== undefined ? { offset_minutes: offset, cells, cue } : { offset_minutes: offset, cells }
  })

  return {
    placements,
    total_minutes,
    hands_on_minutes,
    finish_spread_minutes,
    rows,
    warnings: WARNING_ORDER.filter((w) => warnings.has(w)),
    degraded,
  }
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function scheduleMeal(input: ScheduleMealInput): MealTimeline {
  const finishWindowMinutes =
    input.constraints?.finish_window_minutes ?? DEFAULT_FINISH_WINDOW_MINUTES
  const warnings = new Set<SchedulerWarning>()
  let degraded = false

  const sanitizedDishes: SanitizedDish[] = []
  for (const d of input.dishes) {
    const { dish, degraded: dishDegraded } = sanitizeDish(d, warnings)
    sanitizedDishes.push(dish)
    if (dishDegraded) degraded = true
  }
  sanitizedDishes.sort((a, b) => columnRank(a.column) - columnRank(b.column))

  if (input.progress) {
    const placements = scheduleWithProgress(sanitizedDishes, input.progress)
    return buildTimeline(sanitizedDishes, placements, finishWindowMinutes, warnings, degraded)
  }

  const initialPlacements = scheduleInitial(sanitizedDishes)
  const sequentialPlacements = scheduleSequential(sanitizedDishes)
  const placements =
    totalMinutesOf(initialPlacements) <= totalMinutesOf(sequentialPlacements)
      ? initialPlacements
      : sequentialPlacements

  return buildTimeline(sanitizedDishes, placements, finishWindowMinutes, warnings, degraded)
}
