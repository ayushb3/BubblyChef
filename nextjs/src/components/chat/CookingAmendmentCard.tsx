'use client'

import { motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import { titleCase } from '@/lib/format'
import type { RecipeAmendmentProposal, RecipeIngredientAmendment } from '@/types/chat'

export interface CookingAmendmentCardProps {
  proposal: RecipeAmendmentProposal
  onApply: () => void
  onDismiss: () => void
  state: 'pending' | 'applying' | 'applied' | 'dismissed'
}

function IngredientRow({ ingredient }: { ingredient: RecipeIngredientAmendment }) {
  const qtyStr = [ingredient.quantity, ingredient.unit].filter(Boolean).join(' ')
  return (
    <div className="flex items-baseline gap-2 py-1.5">
      <span className="font-semibold text-sm text-[var(--color-text)] min-w-0 flex-1">
        {titleCase(ingredient.name)}
        {ingredient.optional && (
          <span className="ml-1 text-xs text-[var(--color-muted)] font-normal">(optional)</span>
        )}
      </span>
      {qtyStr && (
        <span className="text-sm text-[var(--color-muted)] shrink-0">{qtyStr}</span>
      )}
    </div>
  )
}

export default function CookingAmendmentCard({
  proposal,
  onApply,
  onDismiss,
  state,
}: CookingAmendmentCardProps) {
  const isPending = state === 'pending'
  const isApplying = state === 'applying'
  const isApplied = state === 'applied'
  const isDismissed = state === 'dismissed'

  const ingredients = proposal.amended_ingredients ?? []
  const summary = proposal.change_summary ?? 'Recipe updated'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: 'easeOut' }}
      className="rounded-2xl bg-white border border-[var(--color-border)] shadow-sm overflow-hidden max-w-[85%]"
    >
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] flex items-start gap-2">
        <span className="text-lg leading-none mt-0.5" role="img" aria-label="cooking">
          🍳
        </span>
        <div className="flex-1 min-w-0">
          <span className="font-bold text-sm text-[var(--color-text)]">
            Updated for what you have
          </span>
          <p className="text-xs text-[var(--color-muted)] mt-0.5 leading-snug">{summary}</p>
        </div>
        <span className="ml-auto text-xs text-[var(--color-muted)] shrink-0 mt-0.5">
          {ingredients.length} ingredient{ingredients.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Ingredient list */}
      {ingredients.length > 0 && (
        <div className="px-4 py-2 flex flex-col divide-y divide-[var(--color-border)]">
          {ingredients.map((ing, i) => (
            <IngredientRow key={i} ingredient={ing} />
          ))}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-3 border-t border-[var(--color-border)]">
        {isPending || isApplying ? (
          <div className="flex gap-2">
            <SpringButton
              onClick={onApply}
              disabled={isApplying}
              className="flex-1 py-2 px-3 rounded-full text-sm font-semibold bg-[var(--color-primary)] text-white hover:opacity-90 disabled:opacity-60"
            >
              {isApplying ? 'Updating…' : 'Update what I\'m cooking'}
            </SpringButton>
            <SpringButton
              onClick={onDismiss}
              disabled={isApplying}
              className="flex-1 py-2 px-3 rounded-full text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-muted)] disabled:opacity-60"
            >
              Keep original
            </SpringButton>
          </div>
        ) : isApplied ? (
          <div className="flex items-center gap-2 text-green-600 text-sm font-semibold">
            <span className="w-5 h-5 rounded-full bg-green-100 flex items-center justify-center text-xs">
              ✓
            </span>
            Recipe updated!
          </div>
        ) : isDismissed ? (
          <p className="text-sm text-[var(--color-muted)]">Kept original</p>
        ) : null}
      </div>
    </motion.div>
  )
}
