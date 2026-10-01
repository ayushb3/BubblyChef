'use client'

/**
 * Issue #654 — the cook-along's finished screen: what to do with a finished
 * meal cook.
 *
 * Superseded from issue #653's single "Back to meal" action: with a
 * deduction to offer (`canDeduct`), the primary action is "Mark meal as
 * cooked" and the secondary is "Skip pantry update" — see contract §5.
 *
 * Issue #812: drawn in the cook flow's own pixel language — a `PixelPanel`
 * (the same frame as the Now card) holding a celebrating Bubbles, with both
 * actions as `SpringButton` keycaps (primary + secondary), not a flat pill and
 * an underlined link. Behaviour is unchanged. Bubbles' celebrate bounce and
 * sparkles already stand down under reduced motion (`BubblesMascot`), and the
 * panel's entrance becomes a plain fade.
 */

import BubblesMascot from '@/components/ui/BubblesMascot'
import PixelPanel from '@/components/ui/PixelPanel'
import SpringButton from '@/components/ui/SpringButton'

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
    <PixelPanel
      as="section"
      entrance
      contentClassName="px-6 py-8 text-center"
      className="font-sans"
      data-testid="meal-cook-finished"
    >
      <div className="mb-3 flex justify-center">
        <BubblesMascot state="celebrate" size={96} />
      </div>
      <h2 className="mb-1 text-xl font-extrabold text-[color:var(--color-text)]">
        Dinner&apos;s ready! 🎉
      </h2>
      <p className="mb-2 text-sm text-[color:var(--color-muted)]">{mealTitle} is all done.</p>

      {canDeduct ? (
        <>
          {skippedDishTitles.length > 0 && (
            <p
              className="mb-4 text-xs text-[color:var(--color-muted)]"
              data-testid="meal-cook-finished-skipped-note"
            >
              {skippedDishTitles.map((t) => `‹${t}›`).join(', ')} was skipped, so it won&apos;t be taken from
              your pantry.
            </p>
          )}
          <div className="mt-5 flex flex-col gap-3">
            <SpringButton variant="primary" fullWidth onClick={onMarkCooked} aria-label="Mark meal as cooked">
              Mark meal as cooked
            </SpringButton>
            <SpringButton
              variant="secondary"
              fullWidth
              onClick={onFinishWithoutPantry}
              aria-label="Skip pantry update"
            >
              Skip pantry update
            </SpringButton>
          </div>
        </>
      ) : (
        <>
          <p className="mb-5 text-sm text-[color:var(--color-muted)]">
            Nothing was cooked, so there&apos;s nothing to take from your pantry.
          </p>
          <SpringButton variant="primary" fullWidth onClick={onFinishWithoutPantry} aria-label="Back to meal">
            Back to meal
          </SpringButton>
        </>
      )}
    </PixelPanel>
  )
}
