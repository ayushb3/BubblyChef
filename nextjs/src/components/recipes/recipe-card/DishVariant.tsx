'use client'

/**
 * Recipe card, `dish` variant: one dish on the meal screen (issues #652 / #744).
 * Presentational: quantities in `ingredients` are already scaled by the caller
 * (`meal.servings / recipe.servings`).
 *
 * A pastel header band carries the role tag and the minutes (the same pastel
 * colours the dish's timeline column). The body is the title, the expiring
 * badge, then either the key-ingredients line (collapsed) or the full
 * ingredient rows and the method (expanded), the "N to buy" line and the
 * actions: "Open recipe" plus whatever the caller slots in (Swap, Remove).
 * A main starts expanded and a side collapsed; the "Show details" key flips
 * either. Steps render in `instructions` order; when the parallel `steps` array
 * is present each row also gets its duration and a hands-on / hands-off marker.
 */

import { useId, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ingredientParts } from '@/lib/recipe-helpers'
import type { Recipe } from '@/components/recipes/RecipePage'
import type { RecipeIngredient, Step } from '@/types/recipes'
import { dishPastel, ROLE_LABEL, type DishRole } from './dishPastel'
import {
  CARD_FRAME,
  ExpiringBadge,
  KEYCAP_LINK,
  Minutes,
  RoleTag,
  TITLE_FONT,
  ToBuyLine,
} from './parts'

export type MealDishCardRole = DishRole

export interface DishCardProps {
  role: DishRole
  /** The dish's slot: 1 and 2 are the sides, so 1 wears mint and 2 peach. Defaults to side 1. */
  position?: number
  title: string
  /** Total minutes for this dish; hidden when unknown. */
  minutes?: number | null
  /** Already scaled by the caller; this component only formats them. */
  ingredients: RecipeIngredient[]
  instructions: Recipe['instructions']
  /** Structured steps (issue #648), same length/order as `instructions` when present. */
  steps?: Step[] | null
  /** Shows a small "times are estimates" note under the method. */
  stepsEstimated?: boolean
  /** Slot beside "Open recipe" for Swap / Remove controls. */
  actions?: ReactNode
  /** The dish's own recipe page; "Open recipe" links there. */
  href?: string
  /** Start expanded (ingredients and method) or collapsed (key ingredients). Main: expanded, side: collapsed. */
  defaultExpanded?: boolean
  /** Names of expiring food this dish uses; the badge hides when empty. */
  expiring?: string[]
  /** What this dish needs that the pantry lacks. Omit when unknown: the line is hidden, not "nothing". */
  toBuy?: string[]
  /** Overrides the default write to the browser grocery list. */
  onAddToGrocery?: (items: string[]) => void | Promise<void>
}

const KEY_INGREDIENT_COUNT = 4

export default function DishVariant({
  role,
  position,
  title,
  minutes,
  ingredients,
  instructions,
  steps,
  stepsEstimated = false,
  actions,
  href,
  defaultExpanded,
  expiring = [],
  toBuy,
  onAddToGrocery,
}: DishCardProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? role === 'main')
  const detailsId = useId()
  const sideIndex = position === 2 ? 1 : 0
  const names = ingredients.map((ing) => ingredientParts(ing).name).filter(Boolean)
  const hasDetails = ingredients.length > 0 || instructions.length > 0
  const keyLine =
    names.length > KEY_INGREDIENT_COUNT
      ? `${names.slice(0, KEY_INGREDIENT_COUNT).join(', ')} +${names.length - KEY_INGREDIENT_COUNT}`
      : names.join(', ')

  return (
    <section
      className={`${CARD_FRAME} overflow-hidden`}
      data-testid="meal-dish-card"
      aria-label={`${title} — ${ROLE_LABEL[role]}`}
    >
      <div
        className="flex items-center justify-between border-b-2 border-[var(--color-text)] px-3 py-2"
        style={{ background: dishPastel(role, sideIndex) }}
        data-testid="meal-dish-band"
      >
        <RoleTag role={role} testId="meal-dish-role" />
        {minutes != null && minutes > 0 && <Minutes minutes={minutes} />}
      </div>

      <div className="flex flex-col gap-2 px-3 pt-2.5 pb-3">
        <h3 className={`${TITLE_FONT} text-[17px] leading-[22px] font-bold`}>{title}</h3>

        <ExpiringBadge names={expiring} />

        {!expanded && keyLine && (
          <p className="text-[13px] leading-[18px] text-[var(--color-muted)]" data-testid="meal-dish-key-ingredients">
            {keyLine}
          </p>
        )}

        {/* Outside the disclosure: a collapsed side must not hide that its times are guesses. */}
        {stepsEstimated && instructions.length > 0 && (
          <p className="text-xs italic text-[var(--color-muted)]" data-testid="meal-dish-steps-estimated">
            Times for this dish are estimates.
          </p>
        )}

        {expanded && (
          <div id={detailsId} className="flex flex-col gap-3">
            {ingredients.length > 0 && (
              <div>
                <h4 className="sr-only">Ingredients</h4>
                <ul>
                  {ingredients.map((ing, i) => {
                    const { name, quantityText, preparation } = ingredientParts(ing)
                    return (
                      <li
                        key={i}
                        className="flex items-baseline gap-2.5 border-b border-[var(--color-border)] py-[7px] last:border-b-0"
                      >
                        <span className="min-w-[60px] shrink-0 text-[13px] font-extrabold tabular-nums">
                          {quantityText}
                        </span>
                        <span className="flex-1 text-sm leading-[19px] font-bold">
                          {name}
                          {preparation && (
                            <span className="font-semibold text-[var(--color-muted)]">, {preparation}</span>
                          )}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              </div>
            )}

            {instructions.length > 0 && (
              <div>
                <h4 className="mb-1.5 text-xs font-extrabold tracking-wide text-[var(--color-muted)] uppercase">
                  Method
                </h4>
                <ol className="flex flex-col gap-2">
                  {instructions.map((step, i) => {
                    const text = typeof step === 'string' ? step : (step.text ?? step.step ?? '')
                    const structured = steps?.[i]
                    return (
                      <li key={i} className="flex items-start gap-3 text-sm">
                        <span
                          aria-hidden="true"
                          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px] border-[var(--color-text)] bg-[var(--color-surface)] text-xs font-extrabold"
                        >
                          {i + 1}
                        </span>
                        <span className="flex-1">
                          {text}
                          {structured && (
                            <span
                              className="ml-2 inline-block rounded-full border border-[var(--color-border)] bg-[var(--color-bg)] px-2 py-0.5 align-middle text-[11px] font-semibold text-[var(--color-muted)]"
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
              </div>
            )}
          </div>
        )}

        {toBuy !== undefined && (
          <ToBuyLine key={toBuy.join('|')} items={toBuy} onAdd={onAddToGrocery} />
        )}

        <div className="flex flex-wrap items-center gap-2">
          {href && (
            <Link href={href} className={KEYCAP_LINK}>
              Open recipe
            </Link>
          )}
          {actions}
          {hasDetails && (
            <button
              type="button"
              onClick={() => setExpanded((open) => !open)}
              aria-expanded={expanded}
              aria-controls={expanded ? detailsId : undefined}
              aria-label={`${expanded ? 'Hide' : 'Show'} details for ${title}`}
              className="min-h-[44px] px-2 text-[13px] font-extrabold underline underline-offset-2"
            >
              {expanded ? 'Hide details' : 'Show details'}
            </button>
          )}
        </div>
      </div>
    </section>
  )
}
