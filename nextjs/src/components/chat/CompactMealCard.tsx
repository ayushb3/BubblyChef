'use client'

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import SpringButton from '@/components/ui/SpringButton'
import { useMotionConfig } from '@/lib/motion'
import type { MealProposal } from '@/types/chat'

export interface CompactMealCardProps {
  proposal: MealProposal
  onOpenMeal: () => void
  onSaveMeal: () => void
  /**
   * 'pending' while the draft POST is in flight; 'opened' once the meal
   * exists (draft or saved) and `/meals/[id]` has been navigated to.
   */
  openState?: 'idle' | 'pending' | 'opened'
  saveState?: 'idle' | 'saving' | 'saved' | 'error'
  /** Bumped by the page when the "Save this meal" pill is tapped. On each change
   *  to a non-zero value: scroll the Save meal button into view, focus it, and
   *  highlight it (a ring) for ~2 s. A no-op while that button is disabled. */
  focusSaveToken?: number
}

/**
 * The compact meal card in chat (issue #650 / spec #647 "Chat and meal UI"),
 * built on the same `rounded-2xl` shell as `ChatRecipeCard` — a title strip,
 * the dishes with their roles, and two actions:
 *
 * - **Open meal** — `POST`s with `is_draft: true` and routes to
 *   `/meals/[id]`, following the existing chat-recipe draft pattern.
 * - **Save meal** — `POST`s with `is_draft: false`, or `PUT { promote: true }`
 *   if the meal was already opened in this card (the caller in
 *   `app/chat/page.tsx` decides which, from whether a meal id already
 *   exists for this message). Both buttons disable once acted on, so a
 *   second tap can never create a second meal.
 */
export default function CompactMealCard({
  proposal,
  onOpenMeal,
  onSaveMeal,
  openState = 'idle',
  saveState = 'idle',
  focusSaveToken = 0,
}: CompactMealCardProps) {
  const { reduced } = useMotionConfig()
  const saveButtonRef = useRef<HTMLButtonElement>(null)
  const [saveHighlighted, setSaveHighlighted] = useState(false)
  const saveDisabled = saveState === 'saving' || saveState === 'saved'

  // The "Save this meal" pill (§1b) bumps this token rather than writing
  // anything itself — the card's own Save meal button stays the one confirm.
  // A no-op while that button is disabled, so a stale pill tap after the
  // meal's already saved can't yank focus onto a dead control.
  useEffect(() => {
    if (focusSaveToken === 0 || saveDisabled) return
    const button = saveButtonRef.current
    if (!button) return
    button.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'center' })
    button.focus()
    setSaveHighlighted(true)
    const timer = setTimeout(() => setSaveHighlighted(false), 2000)
    return () => clearTimeout(timer)
    // Reacts only to the token changing — `reduced`/`saveDisabled` are read
    // at fire time, not tracked as retrigger conditions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusSaveToken])

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: 'easeOut' }}
      className="rounded-2xl bg-white border border-[var(--color-border)] shadow-sm overflow-hidden max-w-[85%]"
    >
      <div className="bg-[var(--color-primary)] px-4 py-2">
        <h3 className="text-white font-bold text-base leading-snug">{proposal.title}</h3>
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        <ul className="flex flex-col gap-1.5">
          {proposal.dishes.map((dish) => (
            <li
              key={`${dish.role}-${dish.position}`}
              className="flex items-baseline gap-2 text-sm text-[var(--color-text)]"
            >
              <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--color-muted)] w-9 flex-shrink-0">
                {dish.role}
              </span>
              <span>{dish.recipe.title ?? 'Untitled dish'}</span>
            </li>
          ))}
        </ul>

        {proposal.missing_ingredients.length > 0 && (
          <p className="text-xs text-[var(--color-muted)]">
            To buy: {proposal.missing_ingredients.join(', ')}
          </p>
        )}

        <div className="flex gap-2 pt-1 mx-0.5">
          <SpringButton
            onClick={onOpenMeal}
            disabled={openState !== 'idle'}
            className="flex-1 py-2.5 px-3 rounded-full text-sm font-semibold bg-[var(--color-primary)] text-white disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {openState === 'pending' ? 'Opening…' : openState === 'opened' ? '✓ Opened' : 'Open meal'}
          </SpringButton>
          <SpringButton
            ref={saveButtonRef}
            onClick={onSaveMeal}
            disabled={saveDisabled}
            className={`flex-1 py-2.5 px-3 rounded-full text-sm font-semibold border border-[var(--color-border)] bg-white text-[var(--color-muted)] hover:bg-[var(--color-bg)] disabled:opacity-60 disabled:cursor-not-allowed transition-shadow motion-reduce:transition-none${
              saveHighlighted ? ' ring-2 ring-[var(--color-primary)] ring-offset-2' : ''
            }`}
          >
            {saveState === 'saving' ? 'Saving…' : saveState === 'saved' ? '✓ Saved!' : 'Save meal'}
          </SpringButton>
        </div>
      </div>
    </motion.div>
  )
}
