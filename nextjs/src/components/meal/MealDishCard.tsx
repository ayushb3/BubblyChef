'use client'

/**
 * Issue #652 — a full recipe card for one dish on the meal screen (main or
 * side). Presentational only: quantities in `ingredients` are already scaled
 * by the caller (`meal.servings / recipe.servings`) — this component only
 * formats them, via the shared `ingredientLabel` helper from
 * `lib/recipe-helpers` (the same one the #650 minimal meal page uses through
 * `scaledIngredientLabel`). Steps render in `instructions` order; when the
 * parallel `steps` array is present, each row also gets its structured
 * duration and a hands-on/hands-off marker, following the same
 * ✋ hands-on / ⏳ hands-off convention `MealTimelineTable` uses for its start
 * cells. No new visual language — the same `rounded-3xl` card shell as the
 * #650 minimal page's `DishCard` and `RecipePage`'s ingredient/method layout.
 */

import type { ReactNode } from 'react'
import Link from 'next/link'
import { ingredientLabel } from '@/lib/recipe-helpers'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { RecipeIngredient, Step } from '@/types/recipes'

export type MealDishCardRole = 'main' | 'side'

const ROLE_LABELS: Record<MealDishCardRole, string> = {
  main: 'Main',
  side: 'Side',
}

export interface MealDishCardProps {
  role: MealDishCardRole
  title: string
  /** Already scaled by the caller — this component only formats them. */
  ingredients: RecipeIngredient[]
  instructions: Recipe['instructions']
  /** Structured steps (issue #648), same length/order as `instructions` when present. */
  steps?: Step[] | null
  /** Shows a small "times are estimates" note under the method. */
  stepsEstimated?: boolean
  /** Slot for Swap / Remove controls — rendered in the card header. */
  actions?: ReactNode
  /** The dish's own recipe page; when set, the title links there (favourite, edit, delete live there). */
  href?: string
}

export default function MealDishCard({
  role,
  title,
  ingredients,
  instructions,
  steps,
  stepsEstimated = false,
  actions,
  href,
}: MealDishCardProps) {
  return (
    <section
      className="rounded-3xl p-4"
      style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', fontFamily: 'Nunito, sans-serif' }}
      data-testid="meal-dish-card"
      aria-label={`${title} — ${ROLE_LABELS[role]}`}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <span
          className="text-[10px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full"
          style={{ background: 'var(--color-accent)', color: 'var(--color-text)' }}
          data-testid="meal-dish-role"
        >
          {ROLE_LABELS[role]}
        </span>
        {actions && <div className="flex items-center gap-2 flex-wrap justify-end">{actions}</div>}
      </div>

      <h3 className="text-lg font-extrabold leading-tight mb-3" style={{ color: 'var(--color-text)' }}>
        {href ? (
          <Link href={href} className="underline-offset-2 hover:underline">
            {title}
          </Link>
        ) : (
          title
        )}
      </h3>

      {ingredients.length > 0 && (
        <div className="mb-4">
          <h4 className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Ingredients
          </h4>
          <ul className="flex flex-col gap-1">
            {ingredients.map((ing, i) => (
              <li key={i} className="flex items-center gap-2 text-sm" style={{ color: 'var(--color-text)' }}>
                <span
                  aria-hidden="true"
                  className="flex-shrink-0 w-1.5 h-1.5 rounded-full"
                  style={{ background: 'var(--color-primary)' }}
                />
                <span>{ingredientLabel(ing)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {instructions.length > 0 && (
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wide mb-1.5" style={{ color: 'var(--color-muted)' }}>
            Method
          </h4>
          <ol className="flex flex-col gap-2">
            {instructions.map((step, i) => {
              const text = typeof step === 'string' ? step : (step.text ?? step.step ?? '')
              const structured = steps?.[i]
              return (
                <li key={i} className="flex items-start gap-3 text-sm" style={{ color: 'var(--color-text)' }}>
                  <span
                    aria-hidden="true"
                    className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold"
                    style={{ background: 'var(--color-accent)', color: 'var(--color-text)' }}
                  >
                    {i + 1}
                  </span>
                  <span className="flex-1">
                    {text}
                    {structured && (
                      <span
                        className="ml-2 inline-block px-2 py-0.5 rounded-full text-[11px] font-semibold align-middle"
                        style={{ background: 'var(--color-bg)', border: '1px solid var(--color-border)', color: 'var(--color-muted)' }}
                        data-testid="meal-dish-step-meta"
                      >
                        {structured.hands_on ? '✋' : '⏳'} {structured.duration_minutes} min
                      </span>
                    )}
                  </span>
                </li>
              )
            })}
          </ol>
          {stepsEstimated && (
            <p
              className="mt-2 text-xs italic"
              style={{ color: 'var(--color-muted)' }}
              data-testid="meal-dish-steps-estimated"
            >
              Times for this dish are estimates.
            </p>
          )}
        </div>
      )}
    </section>
  )
}
