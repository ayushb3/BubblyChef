'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { titleCase } from '@/lib/format'
import Chip from '@/components/ui/Chip'
import type { TermSuggestion } from '@/types/chat'

interface ClarificationCardProps {
  terms: TermSuggestion[]
  /**
   * Called whenever the selection changes. Receives the full current selection
   * map (term → selected item names) so the parent can build the staged text.
   */
  onStagePick?: (selections: Record<string, string[]>) => void
  disabled?: boolean
}

/**
 * Rendered instead of PantryProposalCard when every item in a pantry-update
 * turn was too vague to add directly. Offers concrete tappable suggestions
 * per vague term; tapping toggles selection and stages natural-language text
 * in the input field rather than auto-sending.
 */
export default function ClarificationCard({ terms, onStagePick, disabled = false }: ClarificationCardProps) {
  // Hooks must run unconditionally on every render — declared before the
  // terms.length early return below (React rules-of-hooks).
  const [selections, setSelections] = useState<Record<string, string[]>>({})

  if (terms.length === 0) return null

  const togglePill = (term: string, item: string) => {
    if (disabled) return
    setSelections((prev) => {
      const current = prev[term] ?? []
      const next = current.includes(item)
        ? current.filter((i) => i !== item)
        : [...current, item]
      const updated = { ...prev }
      if (next.length > 0) {
        updated[term] = next
      } else {
        delete updated[term]
      }
      onStagePick?.(updated)
      return updated
    })
  }

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
              {suggestions.map((item) => {
                const isSelected = (selections[term] ?? []).includes(item)
                return (
                  <Chip
                    key={item}
                    tone={isSelected ? 'fresh' : 'accent'}
                    onClick={() => togglePill(term, item)}
                    ariaLabel={`${isSelected ? 'Deselect' : 'Select'} ${item}`}
                  >
                    {titleCase(item)}
                  </Chip>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
