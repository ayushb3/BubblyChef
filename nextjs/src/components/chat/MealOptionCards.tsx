'use client'

import { motion } from 'framer-motion'
import { springs } from '@/lib/motion'
import type { MealOption } from '@/types/chat'

export interface MealOptionCardsProps {
  /** The three (or fewer, on partial generation failure) meal options this turn returned. */
  options: MealOption[]
  /** Called with the option the user tapped. */
  onSelect: (option: MealOption) => void
  /**
   * When true the cards render statically without pointer interaction
   * (applied to older option messages that are no longer the last settled
   * reply — same rule BrainstormOptions and SavedRecipeMatches apply).
   */
  disabled?: boolean
}

/**
 * Renders the `meal_options` proposal (issue #650 / spec #647) as a vertical
 * stack of tappable cards, shaped like `BrainstormOptions` / `ChatRecipeCard`
 * (same `rounded-2xl` shell, accent header strip) — no new visual language,
 * per the spec's "Chat and meal UI" note that the final look lands later
 * under Goal 3.
 *
 * Each card shows the meal name, its dishes with role, the estimated total
 * and hands-on time, pantry coverage ("uses N of your items · M to buy"),
 * and a rescue flag when the option uses an expiring-soon item. Tapping a
 * card fires `onSelect(option)` — the caller sends the pick request with
 * `context: { meal_option_id: option.option_id }`, never fuzzy-matched text.
 */
export default function MealOptionCards({
  options,
  onSelect,
  disabled = false,
}: MealOptionCardsProps) {
  if (options.length === 0) return null

  return (
    <div
      className="flex flex-col gap-2 w-full max-w-[85%]"
      role="list"
      aria-label="Meal options — tap one to build it"
    >
      {options.map((option, i) => (
        <motion.button
          key={option.option_id}
          type="button"
          role="listitem"
          aria-label={`Pick ${option.title}`}
          disabled={disabled}
          onClick={() => !disabled && onSelect(option)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.snappy, delay: i * 0.07 }}
          whileTap={disabled ? undefined : { scale: 0.97 }}
          className={[
            'rounded-2xl bg-[var(--color-surface)] border border-[var(--color-accent)] shadow-sm overflow-hidden',
            'w-full text-left',
            disabled
              ? 'cursor-default opacity-70'
              : 'cursor-pointer hover:brightness-97 active:brightness-90',
          ].join(' ')}
        >
          <div className="bg-[var(--color-accent)]/55 px-4 py-2.5 flex items-center justify-between gap-3">
            <h4 className="text-[var(--color-text)] font-bold text-sm leading-snug flex-1">
              {option.title}
            </h4>
            {!disabled && (
              <span
                aria-hidden
                className="text-[var(--color-text)] text-xs font-semibold flex-shrink-0"
              >
                Tap to build →
              </span>
            )}
          </div>

          <div className="px-4 py-3 flex flex-col gap-2">
            {option.blurb && (
              <p className="text-xs text-[var(--color-muted)] line-clamp-2">{option.blurb}</p>
            )}

            <ul className="flex flex-col gap-1">
              {option.dishes.map((dish) => (
                <li
                  key={`${dish.role}-${dish.name}`}
                  className="flex items-baseline gap-2 text-sm text-[var(--color-text)]"
                >
                  <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)] w-9 flex-shrink-0">
                    {dish.role}
                  </span>
                  <span>{dish.name}</span>
                </li>
              ))}
              {/* A main can be a whole plate, or have lost a repeated side (#758, #762). */}
              {!option.dishes.some((dish) => dish.role === 'side') && (
                <li className="flex items-baseline gap-2 text-xs text-[var(--color-muted)]">
                  <span className="w-9 flex-shrink-0" aria-hidden />
                  <span>no side</span>
                </li>
              )}
            </ul>

            <div className="flex flex-wrap gap-1.5 mt-1">
              {option.est_total_minutes != null && (
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border border-[var(--color-border)] text-[var(--color-text)]">
                  ⏱ {option.est_total_minutes} min total
                  {option.est_hands_on_minutes != null && ` · ${option.est_hands_on_minutes} min hands-on`}
                </span>
              )}
              {/* null when the user asked not to use the pantry — no coverage to report. */}
              {option.coverage && (
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold border border-[var(--color-border)] text-[var(--color-text)]">
                  uses {option.coverage.pantry_items_used} of your items · {option.coverage.to_buy.length} to buy
                </span>
              )}
              {option.rescues.length > 0 && (
                <span className="inline-block px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[var(--color-expiring)] text-[var(--color-expiring-text)]">
                  🍅 rescues {option.rescues.join(', ')}
                </span>
              )}
            </div>
          </div>
        </motion.button>
      ))}
    </div>
  )
}
