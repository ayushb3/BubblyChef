'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import Chip from '@/components/ui/Chip'
import { titleCase } from '@/lib/format'
import type { PantryProposalData, PantryProposalAction, TermSuggestion } from '@/types/chat'

interface PantryProposalCardProps {
  proposal: PantryProposalData
  onApprove: () => void
  onReject: () => void
  state: 'pending' | 'approved' | 'rejected'
  /**
   * Vague terms ("veggies", "dairy things") raised in this turn or a later
   * one in the same still-open thread — merged in here (see useChat's
   * onDone) rather than opening a second card, so the confirmed items and
   * the still-unresolved ones read as one pantry update, not two.
   */
  clarificationTerms?: TermSuggestion[]
  /**
   * Called whenever the selection changes. Receives the full current selection
   * map (term → selected item names) so the parent can build the staged text.
   */
  onStagePick?: (selections: Record<string, string[]>) => void
}

const ACTION_ICONS: Record<PantryProposalAction['action_type'], { icon: string; colorClass: string }> = {
  add: { icon: '+', colorClass: 'bg-green-100 text-green-700' },
  remove: { icon: '−', colorClass: 'bg-red-100 text-red-700' },
  use: { icon: '→', colorClass: 'bg-blue-100 text-blue-600' },
  update: { icon: '✏', colorClass: 'bg-orange-100 text-orange-600' },
}

function ActionRow({ action }: { action: PantryProposalAction }) {
  const { icon, colorClass } = ACTION_ICONS[action.action_type]
  const qtyStr = [action.item.quantity, action.item.unit].filter(Boolean).join(' ')

  return (
    <div className="flex items-center gap-2 py-1.5">
      <span className={`shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${colorClass}`}>
        {icon}
      </span>
      <div className="flex-1 min-w-0">
        <span className="font-semibold text-sm text-[var(--color-text)]">{titleCase(action.item.name)}</span>
        {qtyStr && (
          <span className="text-sm text-[var(--color-muted)] ml-1.5">{qtyStr}</span>
        )}
      </div>
      {action.confidence < 0.9 && (
        <span className="text-xs text-[var(--color-muted)] shrink-0">
          {Math.round(action.confidence * 100)}%
        </span>
      )}
    </div>
  )
}

export default function PantryProposalCard({
  proposal,
  onApprove,
  onReject,
  state,
  clarificationTerms = [],
  onStagePick,
}: PantryProposalCardProps) {
  const isPending = state === 'pending'
  const isApproved = state === 'approved'

  // Multi-select: track which items the user has tapped per vague term.
  // Tapping toggles the item; the updated selection map is forwarded to the
  // parent so it can stage the natural-language text in the input field.
  const [selections, setSelections] = useState<Record<string, string[]>>({})

  const togglePill = (term: string, item: string) => {
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
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
        <span className="text-lg" role="img" aria-label="basket">🧺</span>
        <span className="font-bold text-sm text-[var(--color-text)]">Pantry Update</span>
        <span className="ml-auto text-xs text-[var(--color-muted)]">
          {proposal.actions.length} item{proposal.actions.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Actions list */}
      <div className="px-4 py-2 flex flex-col divide-y divide-[var(--color-border)]">
        {proposal.actions.map((action, i) => (
          <ActionRow key={i} action={action} />
        ))}
      </div>

      {/* Still-vague terms from this turn or a later one. Tapping a pill toggles
          selection; the parent stages the accumulated natural-language text in
          the input field so the user can review/edit before sending. */}
      {isPending && clarificationTerms.length > 0 && (
        <div className="px-4 py-3 border-t border-[var(--color-border)] flex flex-col gap-3">
          <span className="text-xs text-[var(--color-muted)]">
            🤔 Still not sure what you meant by:
          </span>
          {clarificationTerms.map(({ term, suggestions }) => (
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
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--color-border)]">
        {isPending ? (
          <div className="flex gap-2">
            <SpringButton
              onClick={onApprove}
              className="flex-1 py-2 px-3 rounded-full text-sm font-semibold bg-green-100 text-green-700 hover:bg-green-200"
            >
              Add to Pantry
            </SpringButton>
            <SpringButton
              onClick={onReject}
              className="flex-1 py-2 px-3 rounded-full text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-muted)]"
            >
              Dismiss
            </SpringButton>
          </div>
        ) : isApproved ? (
          <div className="flex items-center gap-2 text-green-600 text-sm font-semibold">
            <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-xs">✓</span>
            Added to pantry!
          </div>
        ) : (
          <p className="text-sm text-[var(--color-muted)]">Skipped</p>
        )}
      </div>
    </motion.div>
  )
}
