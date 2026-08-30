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
 * Renders a vertical stack of tappable mini recipe cards, shaped exactly like
 * ChatRecipeCard (same `rounded-2xl` white shell, header strip, shadow-sm) so
 * tapping one still feels like it "expands" into the full recipe card the
 * backend returns.
 *
 * The strip is `--color-accent`, NOT `--color-primary` (#286). Primary is the
 * user's own message colour in MessageBubble, so a primary strip made three
 * assistant suggestions read as three messages the user had just sent —
 * indistinguishable at a glance on a 480px viewport. Accent is the assistant
 * family (the assistant bubble is `--color-accent`/30 with an accent border),
 * and every theme defines accent and primary as a contrasting pair, so this
 * holds across all of them. The strip going accent → primary when the real
 * recipe card arrives now reads as a state change rather than a coincidence.
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
            // Outer card shell — ChatRecipeCard's geometry, with an accent border
            // instead of its neutral one so the whole card sits in the assistant
            // family rather than borrowing the user's colour.
            'rounded-2xl bg-[var(--color-surface)] border border-[var(--color-accent)] shadow-sm overflow-hidden',
            'w-full text-left',
            disabled
              ? 'cursor-default opacity-70'
              : 'cursor-pointer hover:brightness-97 active:brightness-90',
          ].join(' ')}
        >
          {/* Header strip — ChatRecipeCard's shape in the assistant's colour.
              Measured, not eyeballed. White on accent is 1.28–1.67:1 across the
              six themes, so the title and the affordance both use --color-text.
              Accent at /55 over --color-surface gives 5.59:1 (mint) to 8.74:1
              (lavender); solid accent would drop mint to 4.47:1, just under AA.
              The affordance is full-opacity for the same reason — at /80 it fell
              to 3.87:1 in mint — and separates by size and weight instead. */}
          <div className="bg-[var(--color-accent)]/55 px-4 py-2.5 flex items-center justify-between gap-3">
            <h4 className="text-[var(--color-text)] font-bold text-sm leading-snug flex-1">
              {idea}
            </h4>
            {!disabled && (
              <span
                aria-hidden
                className="text-[var(--color-text)] text-xs font-semibold flex-shrink-0"
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
