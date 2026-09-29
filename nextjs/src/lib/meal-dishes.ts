/**
 * Issue #653 — pulled out of `app/meals/[id]/page.tsx` (issue #652) so the
 * cook-along route (`app/meals/[id]/cook/page.tsx`) can build the identical
 * `SchedulerDish[]` from the same `Meal` the meal screen schedules. A pure
 * refactor: no behaviour change, same column/fallback-step rules as before.
 */

import type { Column, SchedulerDish } from '@/lib/meal-scheduler'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { Meal } from '@/types/meals'
import type { Step } from '@/types/recipes'

/** Position 0 is always the main; 1 and 2 are the two possible sides. */
export function columnFor(position: number): Column {
  if (position === 0) return 'main'
  return position === 1 ? 'side_1' : 'side_2'
}

/**
 * A dish recipe with no structured steps (the `ensureSteps` upgrade either
 * hasn't run yet or failed) is scheduled as sequential 3-min estimates built
 * from `instructions` — the scheduler's own `estimated_duration` path, with
 * an explicit dependency chain so the steps run in order rather than however
 * the scheduler would otherwise interleave unrelated steps.
 */
export function fallbackSteps(instructions: Recipe['instructions']): Step[] {
  return instructions.map((instr, i) => {
    const text = typeof instr === 'string' ? instr : instr.text ?? instr.step ?? ''
    return {
      text,
      label: text.length > 40 ? `${text.slice(0, 40)}…` : text,
      ongoing_label: null,
      duration_minutes: 3,
      duration_estimated: true,
      hands_on: true,
      depends_on: i > 0 ? [i - 1] : [],
      exclusive: [],
    }
  })
}

/**
 * Every dish in `meal`, as `SchedulerDish[]` (sorted by position — `main`,
 * then `side_1`, then `side_2`) — the same shape both the meal screen and the
 * cook-along schedule with `scheduleMeal`.
 */
export function schedulerDishesForMeal(meal: Meal): SchedulerDish[] {
  return meal.dishes
    .slice()
    .sort((a, b) => a.position - b.position)
    .map((d) => ({
      dish_id: d.recipe.id,
      column: columnFor(d.position),
      title: d.recipe.title,
      steps:
        d.recipe.steps && d.recipe.steps.length > 0 ? d.recipe.steps : fallbackSteps(d.recipe.instructions),
    }))
}
