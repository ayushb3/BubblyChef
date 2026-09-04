'use client'

import { motion } from 'framer-motion'
import { titleCase } from '@/lib/format'
import Chip from '@/components/ui/Chip'
import type { TermSuggestion } from '@/types/chat'

interface ClarificationCardProps {
  terms: TermSuggestion[]
  /** Called with the specific item name the user tapped — sent as the next chat message. */
  onPick: (item: string) => void
  disabled?: boolean
}

/**
 * Rendered instead of PantryProposalCard when every item in a pantry-update
 * turn was too vague to add directly (see review_gate/create_actions —
 * generic terms never reach `actions`). Rather than a plain text question,
 * offers concrete tappable suggestions per vague term (from
 * pantry.nodes.suggest_specifics) so resolving it is one tap, not a retype.
 *
 * Tapping a pill sends that item name as the next chat message, same as
 * PostMessageChips/BrainstormOptions — the backend re-parses it as a normal,
 * specific pantry item on the next turn.
 */
export default function ClarificationCard({ terms, onPick, disabled = false }: ClarificationCardProps) {
  if (terms.length === 0) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="rounded-2xl bg-white border border-[var(--color-border)] shadow-sm overflow-hidden max-w-[85%]"
    >
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
        <span className="text-lg" role="img" aria-label="thinking">🤔</span>
        <span className="font-bold text-sm text-[var(--color-text)]">What did you mean?</span>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        {terms.map(({ term, suggestions }) => (
          <div key={term} className="flex flex-col gap-1.5">
            <span className="text-xs text-[var(--color-muted)]">
              By &ldquo;{term}&rdquo; did you mean:
            </span>
            <div className="flex flex-wrap gap-2">
              {suggestions.map((item) => (
                <Chip
                  key={item}
                  tone="accent"
                  onClick={disabled ? undefined : () => onPick(item)}
                  ariaLabel={`Add ${item}`}
                >
                  {titleCase(item)}
                </Chip>
              ))}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
