'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import Chip from '@/components/ui/Chip'
import { titleCase } from '@/lib/format'
import type { PantryProposalData, PantryProposalAction, TermSuggestion } from '@/types/chat'

interface PantryProposalCardProps {
  proposal: PantryProposalData
  onApprove: () => void
  onReject: () => void
  state: 'pending' | 'approving' | 'approved' | 'rejected' | 'failed'
  /** Error message to show when `state` is 'failed'. */
  error?: string
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
  /**
   * Called whenever the user edits a quantity or unit inline. Receives the
   * full updated action list so the parent (useChat) can patch its pending
   * proposal before the user approves.
   */
  onActionsChange?: (actions: PantryProposalAction[]) => void
}

const ACTION_ICONS: Record<PantryProposalAction['action_type'], { icon: string; colorClass: string }> = {
  add: { icon: '+', colorClass: 'bg-green-100 text-green-700' },
  remove: { icon: '−', colorClass: 'bg-red-100 text-red-700' },
  use: { icon: '→', colorClass: 'bg-blue-100 text-blue-600' },
  update: { icon: '✏', colorClass: 'bg-orange-100 text-orange-600' },
}

/**
 * Returns true when the action's quantity/unit are genuinely unknown and the
 * user should be offered an inline editor to clarify before approving.
 *
 * Triggers when:
 *  - `unit` is "item" (the backend's meaningless default when it couldn't parse)
 *  - `quantity` is null or undefined (backend returned nothing meaningful)
 */
function needsQtyEdit(action: PantryProposalAction): boolean {
  const qty = action.item.quantity
  const unit = action.item.unit
  return qty == null || unit === 'item'
}

interface ActionRowProps {
  action: PantryProposalAction
  disabled: boolean
  onQtyChange: (quantity: number | undefined, unit: string | undefined) => void
}

function ActionRow({ action, disabled, onQtyChange }: ActionRowProps) {
  const { icon, colorClass } = ACTION_ICONS[action.action_type]
  const showEditor = needsQtyEdit(action)

  // Local controlled state for the inline editor fields — only rendered when
  // showEditor is true. Initialised from whatever the backend gave us (or
  // sensible defaults) so the fields aren't blank when they first appear.
  const [editQty, setEditQty] = useState<string>(
    action.item.quantity != null ? String(action.item.quantity) : '1',
  )
  const [editUnit, setEditUnit] = useState<string>(
    action.item.unit && action.item.unit !== 'item' ? action.item.unit : '',
  )

  const qtyStr = !showEditor
    ? [action.item.quantity, action.item.unit].filter(Boolean).join(' ')
    : null

  const handleQtyBlur = () => {
    const parsed = parseFloat(editQty)
    onQtyChange(isNaN(parsed) ? undefined : parsed, editUnit.trim() || undefined)
  }

  const handleUnitBlur = () => {
    const parsed = parseFloat(editQty)
    onQtyChange(isNaN(parsed) ? undefined : parsed, editUnit.trim() || undefined)
  }

  return (
    <div className="flex flex-col gap-1 py-1.5">
      <div className="flex items-center gap-2">
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

      <AnimatePresence>
        {showEditor && (
          <motion.div
            key="qty-editor"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            className="overflow-hidden"
          >
            <div className="flex items-center gap-1.5 pl-8" aria-label={`Edit quantity for ${action.item.name}`}>
              <span className="text-xs text-[var(--color-muted)] shrink-0">how much?</span>
              <input
                type="number"
                min="0"
                step="any"
                value={editQty}
                onChange={(e) => setEditQty(e.target.value)}
                onBlur={handleQtyBlur}
                disabled={disabled}
                aria-label={`Quantity for ${action.item.name}`}
                className="w-16 text-xs px-2 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-accent)] disabled:opacity-50"
              />
              <input
                type="text"
                placeholder="unit"
                value={editUnit}
                onChange={(e) => setEditUnit(e.target.value)}
                onBlur={handleUnitBlur}
                disabled={disabled}
                aria-label={`Unit for ${action.item.name}`}
                className="w-20 text-xs px-2 py-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:border-[var(--color-accent)] placeholder:text-[var(--color-muted)] disabled:opacity-50"
              />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default function PantryProposalCard({
  proposal,
  onApprove,
  onReject,
  state,
  error,
  clarificationTerms = [],
  onStagePick,
  onActionsChange,
}: PantryProposalCardProps) {
  const isPending = state === 'pending'
  const isApproving = state === 'approving'
  const isApproved = state === 'approved'
  const isFailed = state === 'failed'
  const isEditable = isPending || isFailed

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

  // Local edits — mirrors proposal.actions but with any qty/unit changes the
  // user has made inline. Initialised from the incoming proposal actions.
  const [localActions, setLocalActions] = useState<PantryProposalAction[]>(
    () => proposal.actions,
  )

  // Track which item names the user has already edited so reconciliation can
  // preserve in-flight edits when the proposal prop changes (e.g. a later turn
  // merges a new item into the same still-mounted card).
  const editedNamesRef = useRef<Set<string>>(new Set())

  // Reconcile localActions when proposal.actions changes on the same mounted
  // instance (e.g. partial-failure retry trims actions, or a future same-id
  // merge). Rules:
  //  - New items in proposal → add with backend defaults (no local edit yet).
  //  - Items the user has already edited → keep the edited version.
  //  - Items removed from proposal → drop.
  // This keeps display rows always in sync with the authoritative proposal list
  // while never clobbering an in-flight user edit.
  useEffect(() => {
    setLocalActions((prev) => {
      return proposal.actions.map((incoming) => {
        const key = incoming.item.name.toLowerCase()
        const existing = prev.find((a) => a.item.name.toLowerCase() === key)
        // If the user has edited this item's qty/unit, keep their version.
        if (existing && editedNamesRef.current.has(key)) return existing
        // Otherwise take the fresh backend action (handles new items and resets
        // items whose edits haven't been made yet).
        return incoming
      })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proposal.actions])

  const handleQtyChange = (index: number, quantity: number | undefined, unit: string | undefined) => {
    // Capture the computed next state synchronously from the functional updater
    // so we can call onActionsChange with it — no ref needed.
    let next: PantryProposalAction[] = []
    setLocalActions((prev) => {
      next = prev.map((action, i) => {
        if (i !== index) return action
        return { ...action, item: { ...action.item, quantity, unit } }
      })
      // Mark this item name as user-edited so the reconcile effect preserves it.
      editedNamesRef.current.add(prev[index]?.item.name.toLowerCase() ?? '')
      return next
    })
    onActionsChange?.(next)
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
        {localActions.map((action, i) => (
          <ActionRow
            key={i}
            action={action}
            disabled={!isEditable}
            onQtyChange={(qty, unit) => handleQtyChange(i, qty, unit)}
          />
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
        {isFailed && (
          <p className="text-xs text-red-600 mb-2">
            {error ?? 'Could not add items. Please try again.'}
          </p>
        )}
        {isPending || isApproving || isFailed ? (
          <div className="flex gap-2">
            <SpringButton
              onClick={onApprove}
              disabled={isApproving}
              className="flex-1 py-2 px-3 rounded-full text-sm font-semibold bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-60"
            >
              {isApproving ? 'Adding…' : isFailed ? 'Try again' : 'Add to Pantry'}
            </SpringButton>
            <SpringButton
              onClick={onReject}
              disabled={isApproving}
              className="flex-1 py-2 px-3 rounded-full text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-muted)] disabled:opacity-60"
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
