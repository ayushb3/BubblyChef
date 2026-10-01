/**
 * Which dish needs which missing food (issues #744, #805). The AI service works
 * out a meal's to-buy list once, for the whole meal (`fetchMealToBuy`, the cook
 * matcher, deterministic), listing a food shared by two dishes once. A dish
 * card's "N to buy" line needs it per dish, so this gives each name to EVERY dish
 * whose ingredients include it: a food missing in two dishes reads "To buy" on a
 * row in each, so each card's line must count it (a card never wears a To buy row
 * its own line leaves out). The meal-level list and the grocery hand-off stay
 * deduped; only this per-card view repeats a shared food. Matching uses the
 * grocery list's own food key (case, spacing and a trailing plural folded), so
 * "Lemons" and "lemon" are one food, and a dish that names a food twice lists it
 * once. A name no dish lists is dropped.
 */

import { groceryFoodKey } from '@/lib/grocery'
import type { MealToBuyDetail } from '@/lib/api/grocery'

export interface DishIngredientNames {
  position: number
  /** Bare ingredient names of the dish's recipe. */
  names: string[]
}

/** position -> the to-buy names that dish lists. Every dish gets an entry (possibly empty). */
export function attributeToBuy(toBuy: string[], dishes: DishIngredientNames[]): Map<number, string[]> {
  const result = new Map<number, string[]>(dishes.map((d) => [d.position, []]))
  const keysByDish = dishes.map((d) => ({
    position: d.position,
    keys: new Set(d.names.map((n) => groceryFoodKey(n)).filter(Boolean)),
  }))
  for (const name of toBuy) {
    const key = groceryFoodKey(name)
    if (!key) continue
    for (const d of keysByDish) {
      if (d.keys.has(key)) result.get(d.position)!.push(name)
    }
  }
  return result
}

/**
 * position -> the names a dish card's "N to buy" line shows (issue #805).
 *
 * The service says which dishes need each food (`items[].dishPositions`), keyed by
 * its own "same food" rule, so "fresh basil" in one dish and "basil" in another are
 * one entry on both cards; each card shows the name as that dish wrote it. This does
 * no name matching of its own. Only when the service sent no `items` (an older
 * service during a deploy) does it fall back to `attributeToBuy`'s name matching.
 * Every dish gets an entry (possibly empty); a position no dish has is dropped.
 */
export function toBuyByDish(detail: MealToBuyDetail, dishes: DishIngredientNames[]): Map<number, string[]> {
  if (!detail.items) return attributeToBuy(detail.names, dishes)
  const result = new Map<number, string[]>(dishes.map((d) => [d.position, []]))
  for (const item of detail.items) {
    item.dishPositions.forEach((position, i) => {
      result.get(position)?.push(item.dishNames[i] || item.name)
    })
  }
  return result
}
