'use client'

import { motion } from 'framer-motion'
import { springs } from '@/lib/motion'

export interface BrainstormOptionsProps {
  /** The list of recipe idea names to display as selectable mini cards. */
  ideas: string[]
  /** Called with the idea name the user tapped. */
  onSelect: (idea: string) => void
  /**
   * When true the cards render statically without pointer interaction
   * (applied to older brainstorm messages that are no longer the last settled reply).
   */
  disabled?: boolean
}

/**
 * Renders a vertical stack of tappable mini recipe cards modelled on
 * ChatRecipeCard's pink header strip — same `bg-[var(--color-primary)]`,
 * `rounded-2xl`, white bold title, shadow-sm treatment — so tapping one
 * feels like it "expands" into the full recipe card the backend returns.
 *
 * Each card fires `onSelect(ideaName)`, which is sent as the next chat
 * message. The backend fuzzy-matches the exact name → returns a recipe_card.
 *
 * Only the last settled brainstorm message receives interactive cards;
 * older messages receive `disabled={true}` and render as static previews.
 */
export default function BrainstormOptions({
  ideas,
  onSelect,
  disabled = false,
}: BrainstormOptionsProps) {
  if (ideas.length === 0) return null

  return (
    <div
      className="flex flex-col gap-2 w-full max-w-[85%]"
      role="list"
      aria-label="Recipe ideas — tap one to generate it"
    >
      {ideas.map((idea, i) => (
        <motion.button
          key={idea}
          type="button"
          role="listitem"
          aria-label={`Pick ${idea}`}
          disabled={disabled}
          onClick={() => !disabled && onSelect(idea)}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ...springs.snappy, delay: i * 0.07 }}
          whileTap={disabled ? undefined : { scale: 0.97 }}
          className={[
            // Outer card shell — matches ChatRecipeCard wrapper exactly
            'rounded-2xl bg-white border border-[var(--color-border)] shadow-sm overflow-hidden',
            'w-full text-left',
            disabled
              ? 'cursor-default opacity-70'
              : 'cursor-pointer hover:brightness-97 active:brightness-90',
          ].join(' ')}
        >
          {/* Header strip — identical to ChatRecipeCard's title strip */}
          <div className="bg-[var(--color-primary)] px-4 py-2.5 flex items-center justify-between gap-3">
            <h4 className="text-white font-bold text-sm leading-snug flex-1">
              {idea}
            </h4>
            {!disabled && (
              <span
                aria-hidden
                className="text-white/70 text-xs font-semibold flex-shrink-0"
              >
                Tap to make →
              </span>
            )}
          </div>
        </motion.button>
      ))}
    </div>
  )
}
