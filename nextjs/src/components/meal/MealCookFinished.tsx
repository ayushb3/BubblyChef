'use client'

/**
 * Issue #653 — the cook-along's finished screen: "Dinner's ready" and a
 * single "Back to meal" action. The combined pantry deduction arrives in
 * issue #654; this screen doesn't offer it. Same rounded-card / pill-button
 * shell as `GuidedCookFlow`'s `DoneState` — no new visual language.
 */

export interface MealCookFinishedProps {
  mealTitle: string
  onBackToMeal: () => void
}

export default function MealCookFinished({ mealTitle, onBackToMeal }: MealCookFinishedProps) {
  return (
    <section
      className="rounded-3xl text-center py-8 px-6"
      style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-border)', fontFamily: 'Nunito, sans-serif' }}
      data-testid="meal-cook-finished"
    >
      <h2 className="text-xl font-extrabold mb-1" style={{ color: 'var(--color-text)' }}>
        Dinner&apos;s ready! 🎉
      </h2>
      <p className="text-sm mb-5" style={{ color: 'var(--color-muted)' }}>
        {mealTitle} is all done.
      </p>
      <button
        type="button"
        onClick={onBackToMeal}
        className="min-h-[44px] rounded-full px-6 font-bold text-sm active:scale-95 transition-transform"
        style={{ background: 'var(--color-primary)', color: 'var(--color-text)' }}
        aria-label="Back to meal"
      >
        Back to meal
      </button>
    </section>
  )
}
