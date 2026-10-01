'use client'

import { useState } from 'react'
import { titleCase } from '@/lib/format'
import Chip from '@/components/ui/Chip'
import PixelPanel from '@/components/ui/PixelPanel'
import ChatCardHeader from './ChatCardHeader'
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
    <PixelPanel entrance contentClassName="p-0" className="max-w-[85%] mr-1 mb-1">
      <ChatCardHeader emoji="🤔" emojiLabel="thinking" title="What did you mean?" />

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
                    pressed={isSelected}
                  >
                    {titleCase(item)}
                  </Chip>
                )
              })}
            </div>
          </div>
        ))}
      </div>
    </PixelPanel>
  )
}
