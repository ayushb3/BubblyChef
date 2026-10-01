'use client'

/**
 * Recipe card, `option` variant: one meal option in chat (issue #650 / #744).
 * The whole card is one button. It shows the meal title and "N to buy", then a
 * Main row and a Side row per side (each tagged in that dish's pastel; a main
 * with no side says "no side"), the total and hands-on minutes, "N of M from
 * your pantry" and the rescue flag.
 *
 * The caller wraps a stack of these in `role="list"`; each card is a
 * `role="listitem"` button named "Pick <title>" (the same contract the side
 * alternatives use), and a tap fires `onSelect(option)` so the pick is sent by
 * `option_id`, never fuzzy-matched text.
 */

import { motion } from 'framer-motion'
import { useMotionConfig } from '@/lib/motion'
import type { MealOption } from '@/types/chat'
import { dishPastel } from './dishPastel'
import {
  CARD_FRAME,
  CARD_KEY_SHADOW,
  CARD_PRESS,
  ChevronIcon,
  ExpiringBadge,
  RoleTag,
  TITLE_FONT,
} from './parts'

export interface OptionCardProps {
  option: MealOption
  /** Called with the option the user tapped. */
  onSelect: (option: MealOption) => void
  /**
   * Renders the card statically, with no tap (an older option message that is
   * no longer the last settled reply).
   */
  disabled?: boolean
  /** Position in the stack; staggers the entrance. */
  index?: number
}

export default function OptionVariant({ option, onSelect, disabled = false, index = 0 }: OptionCardProps) {
  const { reduced, springs } = useMotionConfig()
  const hasSide = option.dishes.some((dish) => dish.role === 'side')
  let sideSeen = 0

  const coverage = option.coverage
  const toBuy = coverage ? coverage.to_buy.length : null
  const pantryTotal = coverage ? coverage.pantry_items_used + coverage.to_buy.length : 0

  return (
    <motion.button
      type="button"
      role="listitem"
      aria-label={`Pick ${option.title}`}
      disabled={disabled}
      onClick={() => !disabled && onSelect(option)}
      initial={reduced ? { opacity: 0 } : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ ...springs.snappy, delay: index * 0.07 }}
      className={[
        CARD_FRAME,
        'flex w-full flex-col gap-2 p-3 text-left',
        disabled ? 'cursor-default opacity-70' : `${CARD_KEY_SHADOW} ${CARD_PRESS} cursor-pointer`,
      ].join(' ')}
    >
      <span className="flex items-start gap-2">
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className={`${TITLE_FONT} text-[17px] leading-[22px] font-bold`}>{option.title}</span>
          {toBuy !== null && (
            <span className="text-xs leading-4 font-bold tabular-nums">
              {toBuy === 0 ? 'Nothing to buy' : <b>{toBuy} to buy</b>}
            </span>
          )}
        </span>
        {!disabled && (
          <span aria-hidden="true" className="mt-0.5">
            <ChevronIcon />
          </span>
        )}
      </span>

      {option.blurb && (
        <span className="line-clamp-2 text-xs leading-4 text-[var(--color-muted)]">{option.blurb}</span>
      )}

      <span className="flex flex-col gap-1.5">
        {option.dishes.map((dish) => {
          const pastel = dishPastel(dish.role, dish.role === 'side' ? sideSeen++ : 0)
          return (
            <span key={`${dish.role}-${dish.name}`} className="flex items-baseline gap-2 text-sm leading-[19px] font-bold">
              <span className="w-14 shrink-0">
                <RoleTag role={dish.role} pastel={pastel} />
              </span>
              <span className="min-w-0 flex-1">{dish.name}</span>
            </span>
          )
        })}
        {!hasSide && (
          <span className="flex items-center gap-2 text-xs leading-4 text-[var(--color-muted)]">
            <span className="w-14 shrink-0" aria-hidden="true" />
            <span>no side</span>
          </span>
        )}
      </span>

      <span className="flex flex-col gap-1 text-xs leading-4 font-bold tabular-nums">
        {option.est_total_minutes != null && (
          <span>
            {option.est_total_minutes} min total
            {option.est_hands_on_minutes != null && ` · ${option.est_hands_on_minutes} min hands-on`}
          </span>
        )}
        {/* null when the user asked not to use the pantry: no coverage to report. */}
        {coverage && pantryTotal > 0 && (
          <span>
            {coverage.pantry_items_used} of {pantryTotal} from your pantry
          </span>
        )}
      </span>

      <ExpiringBadge names={option.rescues} />
    </motion.button>
  )
}
