'use client'

import { motion } from 'framer-motion'
import { titleCase } from '@/lib/format'
import SpringButton from '@/components/ui/SpringButton'
import type { AmendmentCardState, RecipeAmendmentProposal } from '@/types/chat'

interface CookingAmendmentCardProps {
  proposal: RecipeAmendmentProposal
  state: AmendmentCardState
  /**
   * False for a card that can no longer be acted on: an older amendment, one for
   * a recipe that is not the one being cooked, or one restored from history with
   * no turn to confirm against. A pending card that is not actionable shows no
   * buttons (#490: never a live button that cannot work).
   */
  actionable: boolean
  errorMessage?: string
  onApply: () => void
  onDismiss: () => void
}

function quantityText(quantity: number, unit: string): string {
  const q = Number.isInteger(quantity) ? String(quantity) : String(Math.round(quantity * 100) / 100)
  return [q, unit].filter(Boolean).join(' ')
}

/**
 * The in-thread "Update what I'm cooking" card (#489, folding in #303): the full
 * amended ingredient list the model proposed, with one confirm and one decline.
 * Confirming changes what this cook deducts from the pantry; it never edits the
 * saved library recipe.
 */
export default function CookingAmendmentCard({
  proposal,
  state,
  actionable,
  errorMessage,
  onApply,
  onDismiss,
}: CookingAmendmentCardProps) {
  const applying = state === 'applying'
  const showButtons = actionable && (state === 'pending' || applying || state === 'failed')

  return (
    <motion.div
      data-testid="cooking-amendment-card"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="rounded-2xl bg-white border border-[var(--color-border)] shadow-sm overflow-hidden max-w-[85%]"
    >
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-center gap-2">
        <span className="text-lg" role="img" aria-label="pot">🍲</span>
        <span className="font-bold text-sm text-[var(--color-text)]">
          {proposal.recipe_title ? `${proposal.recipe_title}, your way` : 'Your changes'}
        </span>
      </div>

      <div className="px-4 py-3 flex flex-col gap-2">
        {proposal.change_summary && (
          <p className="text-sm text-[var(--color-text)]">{proposal.change_summary}</p>
        )}
        <ul className="flex flex-col gap-1">
          {proposal.amended_ingredients.map((ing, i) => (
            <li key={`${ing.name}-${i}`} className="flex items-baseline justify-between gap-3 text-sm">
              <span className="text-[var(--color-text)]">
                <span>{titleCase(ing.name)}</span>
                {ing.optional && <span className="text-[var(--color-muted)]"> (optional)</span>}
              </span>
              <span className="text-[var(--color-muted)] shrink-0">
                {quantityText(ing.quantity, ing.unit)}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="px-4 py-3 border-t border-[var(--color-border)]">
        {state === 'failed' && actionable && (
          <p role="alert" className="text-xs text-red-600 mb-2">
            {errorMessage ?? "Couldn't update what you're cooking. Please try again."}
          </p>
        )}
        {showButtons ? (
          <div className="flex gap-2">
            <SpringButton
              onClick={onApply}
              disabled={applying}
              className="flex-1 py-2 px-3 rounded-full text-sm font-semibold bg-green-100 text-green-700 hover:bg-green-200 disabled:opacity-60"
            >
              {applying ? 'Updating…' : state === 'failed' ? 'Try again' : "Update what I'm cooking"}
            </SpringButton>
            <SpringButton
              onClick={onDismiss}
              disabled={applying}
              className="flex-1 py-2 px-3 rounded-full text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-muted)] disabled:opacity-60"
            >
              Keep original
            </SpringButton>
          </div>
        ) : state === 'applied' ? (
          <p role="status" className="text-sm font-semibold text-green-600">
            ✓ Updated. When you finish, your pantry update will use this list.
          </p>
        ) : state === 'dismissed' ? (
          <p role="status" className="text-sm text-[var(--color-muted)]">
            Kept the original recipe.
          </p>
        ) : (
          <p role="status" className="text-sm text-[var(--color-muted)]">
            Not applied.
          </p>
        )}
      </div>
    </motion.div>
  )
}
