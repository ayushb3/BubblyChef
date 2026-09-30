'use client'

/**
 * Issue #654 — the cook-along's finished screen: what to do with a finished
 * meal cook. Same rounded-card / pill-button shell as `GuidedCookFlow`'s
 * `DoneState` — no new visual language.
 *
 * Superseded from issue #653's single "Back to meal" action: with a
 * deduction to offer (`canDeduct`), the primary action is "Mark meal as
 * cooked" and the secondary is "Skip pantry update" — see contract §5.
 */

export interface MealCookFinishedProps {
  mealTitle: string
  /** Titles of dishes whose every step was skipped — named so it's clear why they won't be deducted. */
  skippedDishTitles?: string[]
  /** False when every dish was skipped — there's nothing to take from the pantry. */
  canDeduct?: boolean
  /** Opens the combined deduction sheet. Ignored (button not rendered) when `!canDeduct`. */
  onMarkCooked?: () => void
  /** Ends the session with no write — no deduction, and nothing marked cooked. */
  onFinishWithoutPantry?: () => void
}

export default function MealCookFinished({
  mealTitle,
  skippedDishTitles = [],
  canDeduct = false,
  onMarkCooked,
  onFinishWithoutPantry,
}: MealCookFinishedProps) {
  return (
    <section
      className="rounded-3xl text-center py-8 px-6"
      style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', fontFamily: 'Nunito, sans-serif' }}
      data-testid="meal-cook-finished"
    >
      <h2 className="text-xl font-extrabold mb-1" style={{ color: 'var(--color-text)' }}>
        Dinner&apos;s ready! 🎉
      </h2>
      <p className="text-sm mb-2" style={{ color: 'var(--color-muted)' }}>
        {mealTitle} is all done.
      </p>

      {canDeduct ? (
        <>
          {skippedDishTitles.length > 0 && (
            <p className="text-xs mb-4" style={{ color: 'var(--color-muted)' }} data-testid="meal-cook-finished-skipped-note">
              {skippedDishTitles.map((t) => `‹${t}›`).join(', ')} was skipped, so it won&apos;t be taken from
              your pantry.
            </p>
          )}
          <div className="flex flex-col gap-2 items-center">
            <button
              type="button"
              onClick={onMarkCooked}
              className="min-h-[44px] rounded-full px-6 font-bold text-sm active:scale-95 transition-transform"
              style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
              aria-label="Mark meal as cooked"
            >
              Mark meal as cooked
            </button>
            <button
              type="button"
              onClick={onFinishWithoutPantry}
              className="min-h-[44px] px-4 font-semibold text-sm underline active:scale-95 transition-transform"
              style={{ color: 'var(--color-muted)' }}
              aria-label="Skip pantry update"
            >
              Skip pantry update
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
            Nothing was cooked, so there&apos;s nothing to take from your pantry.
          </p>
          <button
            type="button"
            onClick={onFinishWithoutPantry}
            className="min-h-[44px] rounded-full px-6 font-bold text-sm active:scale-95 transition-transform"
            style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
            aria-label="Back to meal"
          >
            Back to meal
          </button>
        </>
      )}
    </section>
  )
}
