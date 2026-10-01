/**
 * Issue #745 — per-dish progress for the cook-along's strip: how many of a
 * dish's steps are done or skipped. Pure, no clock, no I/O; the cook page
 * passes `allStreamSteps` and the session's step records.
 *
 * A step counts as progressed once it is `done` or `skipped` (the same two
 * statuses `isMealCookFinished` treats as finished); `running` does not.
 */

import type { Column } from '@/lib/meal-scheduler'
import type { StreamStep } from '@/lib/meal-cook-stream'

export interface DishProgress {
  column: Column
  title: string
  done: number
  total: number
}

export function dishProgress(
  steps: StreamStep[],
  records: Record<string, { status: 'done' | 'skipped' | 'running' }>,
): DishProgress[] {
  const byDish = new Map<string, DishProgress>()
  for (const step of steps) {
    let entry = byDish.get(step.dish_id)
    if (!entry) {
      entry = { column: step.column, title: step.dish_title, done: 0, total: 0 }
      byDish.set(step.dish_id, entry)
    }
    entry.total += 1
    const status = records[step.key]?.status
    if (status === 'done' || status === 'skipped') entry.done += 1
  }
  return [...byDish.values()]
}
