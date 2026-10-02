'use client'

/**
 * Issue #654 PR A — the combined pantry-deduction sheet for a whole meal
 * cook. Same modal shell, review body and footer summary the single-recipe
 * `CookModal` uses (`components/recipes/CookReviewBody.tsx`) — no new visual
 * language, just a merged, multi-dish proposal (spec #647, "Chat and meal
 * UI"). Presentational: the page owns fetching the proposal, retrying
 * `confirm_in_progress`, and navigating away on success.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import BubblesMascot from '@/components/ui/BubblesMascot'
import PixelSheet from '@/components/ui/PixelSheet'
import {
  CookReviewBody,
  CookDeductionSummary,
  summariseDeductions,
} from '@/components/recipes/CookReviewBody'
import type { MealCookProposal, MealCookErrorKind, MealIngredientMatch } from '@/types/meals'
import type { DeductionItem, IngredientMatch } from '@/types/recipes'
import SkippedDeductionsNotice from '@/components/cook/SkippedDeductionsNotice'
import { skippedTotal } from '@/lib/cook-skipped'
import { cleanIngredientAmount } from '@/lib/ingredient-amount'

export type MealCookSheetState = 'loading' | 'review' | 'confirming' | 'success' | 'error'

export interface MealCookSheetProps {
  open: boolean
  mealTitle: string
  state: MealCookSheetState
  proposal: MealCookProposal | null
  /** The message to show in the error state. The page owns the copy for each `errorKind`. */
  errorMessage?: string
  /**
   * Set only for `dish_mismatch` / `confirm_incomplete` — the page never hands
   * this sheet `confirm_in_progress`; it waits and retries itself, then maps a
   * second one to `confirm_incomplete` (contract §5). With a kind set, the
   * sheet shows Back to meal instead of Retry — a fresh network hiccup can be
   * retried, but a changed meal or a half-finished confirm can't be fixed by
   * trying again.
   */
  errorKind?: MealCookErrorKind
  onConfirm: (deductions: DeductionItem[]) => void
  onRetry: () => void
  onBackToMeal: () => void
  onClose: () => void
  /**
   * Issue #621 — pantry items the server refused to deduct, already resolved
   * to names by the page (`lib/cook-skipped.ts`). When non-empty the success
   * state names them and waits for the cook to tap Back to meal instead of
   * the page auto-redirecting; ✕, the backdrop and Escape then leave the same
   * way (`onBackToMeal`), so the session still ends.
   */
  skipped?: { names: string[]; unnamed: number; total?: number }
}

/** Distinct `recipe_id`s a merged line's sources span — 1 means "only one dish uses this", 2+ means it's shared. */
function distinctSourceDishCount(m: IngredientMatch): number {
  const sources = (m as MealIngredientMatch).sources
  if (!sources || sources.length === 0) return 0
  return new Set(sources.map((s) => s.recipe_id)).size
}

/**
 * "From Pasta (2 cloves) + Salad (1 clove)" — only on a line whose sources
 * span 2+ dishes (contract §5). A source with no quantity contributes just
 * its dish name.
 */
function meaLineSourceNote(m: IngredientMatch): string | null {
  const sources = (m as MealIngredientMatch).sources
  if (!sources || distinctSourceDishCount(m) < 2) return null
  const parts = sources.map((s) =>
    s.ingredient_qty != null &&
    s.ingredient_unit &&
    !cleanIngredientAmount(s.ingredient_name, s.ingredient_qty, s.ingredient_unit).toTaste
      ? `${s.dish_title} (${s.ingredient_qty} ${s.ingredient_unit})`
      : s.dish_title,
  )
  return `From ${parts.join(' + ')}`
}

/**
 * "Needed for Pasta + Salad" — only when 2+ DISTINCT dishes lack this
 * ingredient. The backend already de-dupes `missing_sources`, but this
 * counts distinct `recipe_id`s (not raw list length) as a belt-and-braces
 * guard against a repeated id inflating the count or the note (code review,
 * round 1).
 */
function missingSourceNoteFor(
  name: string,
  missingSources: Record<string, string[]>,
  dishTitleByRecipeId: Map<string, string>,
): string | null {
  const distinctIds = Array.from(new Set(missingSources[name] ?? []))
  if (distinctIds.length < 2) return null
  const titles = distinctIds.map((id) => dishTitleByRecipeId.get(id) ?? id)
  return `Needed for ${titles.join(' + ')}`
}

export default function MealCookSheet({
  open,
  mealTitle,
  state,
  proposal,
  errorMessage,
  errorKind,
  onConfirm,
  onRetry,
  onBackToMeal,
  onClose,
  skipped,
}: MealCookSheetProps) {
  const [overrides, setOverrides] = useState<Record<string, string>>({})
  const [expiredDismissed, setExpiredDismissed] = useState(false)

  // Code review, round 1: while a confirm is in flight, ✕/backdrop/Escape
  // must not close the sheet — closing re-arms `open`, so a re-opened sheet
  // (or a fresh "Mark meal as cooked") could start a second request while the
  // first is still in flight and race it. Cancel is already disabled during
  // `confirming` (below); this guard is the one place `onClose` itself is
  // called, so every other dismiss path (✕, backdrop, Escape via
  // `useModalFocusTrap`) is covered by construction rather than needing its
  // own disabled check.
  const hasSkipped = skipped ? skippedTotal(skipped) > 0 : false
  const guardedClose = () => {
    if (state === 'confirming') return
    // Issue #621: with the notice showing there is no redirect, so every exit
    // from the success state is the same "leave" the Back to meal pill does.
    if (state === 'success' && hasSkipped) onBackToMeal()
    else onClose()
  }

  // With the notice showing there is no redirect, so Back to meal is the next
  // action: move focus to it as the success-with-notice state appears.
  const backToMealRef = useRef<HTMLButtonElement>(null)
  const showBackToMeal = open && state === 'success' && hasSkipped
  useEffect(() => {
    if (showBackToMeal) backToMealRef.current?.focus()
  }, [showBackToMeal])

  // A fresh proposal (a re-open, or a Retry after a plain error) starts from
  // a clean slate — stale unit_conflict/compound overrides from a previous
  // review shouldn't silently carry into a new one. Reset during render when
  // `open`/`proposal` change (React's "adjust state on prop change" pattern),
  // not in an effect, which the react-hooks lint rule rejects.
  const [resetFor, setResetFor] = useState({ open, proposal })
  if (resetFor.open !== open || resetFor.proposal !== proposal) {
    setResetFor({ open, proposal })
    if (open) {
      setOverrides({})
      setExpiredDismissed(false)
    }
  }

  const dishTitleByRecipeId = useMemo(() => {
    const map = new Map<string, string>()
    for (const dish of proposal?.dishes ?? []) map.set(dish.recipe_id, dish.title)
    return map
  }, [proposal])

  const missingSourceNote = useMemo(() => {
    if (!proposal) return undefined
    return (name: string) => missingSourceNoteFor(name, proposal.missing_sources, dishTitleByRecipeId)
  }, [proposal, dishTitleByRecipeId])

  const summary = proposal ? summariseDeductions(proposal, overrides) : null
  const hasUnresolved = summary?.skipped.some((s) => s.reason === 'needs_quantity') ?? false

  const handleConfirm = () => {
    if (!summary) return
    onConfirm(summary.deductions)
  }

  return (
    <PixelSheet
      open={open}
      onClose={guardedClose}
      closeDisabled={state === 'confirming'}
      title="Update pantry"
      titleId="meal-cook-sheet-title"
      subtitle={mealTitle}
      testId="meal-cook-sheet"
      footer={
        state === 'review' || state === 'confirming' ? (
          <div className="flex flex-col gap-2.5">
            {summary && <CookDeductionSummary summary={summary} mode="confirm" />}

            <div className="flex gap-2">
              <button
                onClick={guardedClose}
                disabled={state === 'confirming'}
                className="font-sans flex-1 min-h-[44px] py-2 rounded-full text-sm font-bold border border-[var(--color-border)] text-[var(--color-muted)] active:scale-95 transition-transform disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirm}
                disabled={state === 'confirming'}
                /* Demoted to a secondary treatment while rows are unresolved,
                   same pattern as CookModal's "Cook anyway" (#245). */
                className={[
                  'font-sans flex-1 min-h-[44px] py-2 rounded-full text-sm font-bold active:scale-95 transition-transform disabled:opacity-50',
                  hasUnresolved
                    ? 'border-2 border-[var(--color-primary-dark)] text-[var(--color-primary-dark)]'
                    : 'text-white',
                ].join(' ')}
                style={{
                  background: hasUnresolved ? 'transparent' : 'var(--color-primary-dark)',
                }}
              >
                {state === 'confirming' ? 'Saving...' : hasUnresolved ? 'Update anyway' : 'Update pantry'}
              </button>
          </div>
          </div>
        ) : state === 'error' ? (
          <div className="flex">
            {errorKind ? (
              <button
                onClick={onBackToMeal}
                className="font-sans flex-1 min-h-[44px] py-2 rounded-full text-sm font-bold text-white active:scale-95 transition-transform"
                style={{ background: 'var(--color-primary-dark)' }}
              >
                Back to meal
              </button>
            ) : (
              <button
                onClick={onRetry}
                className="font-sans flex-1 min-h-[44px] py-2 rounded-full text-sm font-bold text-white active:scale-95 transition-transform"
                style={{ background: 'var(--color-primary-dark)' }}
              >
                Retry
              </button>
            )}
          </div>
        ) : null
      }
    >
      {state === 'loading' && (
        <div role="status" aria-live="polite" className="flex flex-col items-center gap-3 py-8">
          <BubblesMascot state="thinking" size={64} />
          <div
            className="w-5 h-5 rounded-full border-2 border-t-transparent animate-spin motion-reduce:animate-none shrink-0"
            style={{ borderColor: 'var(--color-primary)', borderTopColor: 'transparent' }}
          />
          <p
            className="font-sans text-sm font-semibold text-[var(--color-text)]"
          >
            Checking your pantry against the whole meal…
          </p>
        </div>
      )}

      {state === 'error' && (
        <div className="py-8 text-center" role="alert">
          <p className="font-sans text-sm font-semibold text-red-500">
            {errorMessage || 'Something went wrong. Please try again.'}
          </p>
        </div>
      )}

      {state === 'success' && (
        <div className="py-8 text-center flex flex-col items-center gap-3">
          <BubblesMascot state="celebrate" size={80} />
          <p
            className="font-sans text-sm font-extrabold text-[var(--color-text)]"
          >
            Pantry updated!
          </p>
          {hasSkipped && skipped && (
            <>
              <SkippedDeductionsNotice names={skipped.names} unnamed={skipped.unnamed} total={skipped.total} />
              <button
                type="button"
                ref={backToMealRef}
                onClick={onBackToMeal}
                className="font-sans min-h-[44px] px-6 rounded-full text-sm font-bold text-white active:scale-95 transition-transform"
                style={{ background: 'var(--color-primary-dark)' }}
                data-testid="meal-cook-sheet-back-to-meal"
              >
                Back to meal
              </button>
            </>
          )}
        </div>
      )}

      {(state === 'review' || state === 'confirming') && proposal && (
        <CookReviewBody
          proposal={proposal}
          overrides={overrides}
          onOverrideChange={(key, value) =>
            setOverrides((prev: Record<string, string>) => ({ ...prev, [key]: value }))
          }
          expiredDismissed={expiredDismissed}
          onDismissExpired={() => setExpiredDismissed(true)}
          sourceNote={meaLineSourceNote}
          missingSourceNote={missingSourceNote}
          expiredHeading="Expired ingredients in this meal"
        />
      )}
    </PixelSheet>
  )
}
