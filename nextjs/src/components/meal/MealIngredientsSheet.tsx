'use client'

/**
 * Issue #849 — the cook-along's Ingredients sheet: every dish's scaled
 * ingredients in one place, each one checkable ("got it out"). Presentational:
 * the page owns what is checked, so it survives closing and reopening the
 * sheet. A `PixelSheet` on the cook layer (it opens over the full-screen cook
 * surface), the same as the timeline sheet.
 */

import PixelSheet from '@/components/ui/PixelSheet'
import { DISH_BG, SOLID_EDGE } from './dish-style'
import type { CookIngredient } from '@/lib/cook-step-ingredients'
import type { Column } from '@/lib/meal-scheduler'

export interface IngredientsSheetDish {
  dish_id: string
  column: Column
  title: string
  items: CookIngredient[]
}

export interface MealIngredientsSheetProps {
  open: boolean
  onClose: () => void
  dishes: IngredientsSheetDish[]
  /** Checked rows, keyed `${dish_id}:${item.key}`. */
  checked: ReadonlySet<string>
  onToggle: (rowKey: string) => void
}

export default function MealIngredientsSheet({ open, onClose, dishes, checked, onToggle }: MealIngredientsSheetProps) {
  const withItems = dishes.filter((d) => d.items.length > 0)
  return (
    <PixelSheet
      open={open}
      onClose={onClose}
      layer="cook"
      title="Ingredients"
      titleId="meal-ingredients-sheet-title"
      closeLabel="Close ingredients"
      testId="meal-ingredients-sheet"
      backdropTestId="meal-ingredients-sheet-backdrop"
    >
      {withItems.length === 0 ? (
        <p className="text-base font-semibold text-[color:var(--color-text)]">No ingredients listed for this meal.</p>
      ) : (
        <div className="flex flex-col gap-5">
          {withItems.map((dish) => (
            <section key={dish.dish_id} aria-label={dish.title} data-testid="meal-ingredients-dish">
              <h3
                className={`mb-2 inline-flex max-w-full items-center rounded-full px-3 py-0.5 text-sm font-extrabold text-[color:var(--color-text)] ${SOLID_EDGE} ${DISH_BG[dish.column]}`}
              >
                <span className="truncate">{dish.title}</span>
              </h3>
              <ul className="flex flex-col">
                {dish.items.map((item) => {
                  const rowKey = `${dish.dish_id}:${item.key}`
                  const isChecked = checked.has(rowKey)
                  return (
                    <li key={rowKey}>
                      <label className="flex min-h-[48px] cursor-pointer items-center gap-3 py-1.5 text-lg leading-snug text-[color:var(--color-text)]">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => onToggle(rowKey)}
                          className="h-6 w-6 flex-shrink-0 accent-[color:var(--color-primary)]"
                        />
                        <span className={isChecked ? 'text-[color:var(--color-muted)] line-through' : 'font-semibold'}>
                          {item.label}
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
    </PixelSheet>
  )
}
