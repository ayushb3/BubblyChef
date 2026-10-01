/**
 * Which dish needs which missing food (issue #744). The AI service works out a
 * meal's to-buy list once, for the whole meal (`fetchMealToBuy`, the cook
 * matcher, deterministic), listing a food shared by two dishes once. A dish
 * card's "N to buy" line needs it per dish, so this attributes each name to the
 * first dish (in the order given) whose ingredients include it. Matching uses
 * the grocery list's own food key (case, spacing and a trailing plural folded),
 * so "Lemons" and "lemon" are one food. A name no dish lists is dropped.
 */

import { groceryFoodKey } from '@/lib/grocery'

export interface DishIngredientNames {
  position: number
  /** Bare ingredient names of the dish's recipe. */
  names: string[]
}

/** position -> the to-buy names that dish owns. Every dish gets an entry (possibly empty). */
export function attributeToBuy(toBuy: string[], dishes: DishIngredientNames[]): Map<number, string[]> {
  const result = new Map<number, string[]>(dishes.map((d) => [d.position, []]))
  const keysByDish = dishes.map((d) => ({
    position: d.position,
    keys: new Set(d.names.map((n) => groceryFoodKey(n)).filter(Boolean)),
  }))
  for (const name of toBuy) {
    const key = groceryFoodKey(name)
    if (!key) continue
    const owner = keysByDish.find((d) => d.keys.has(key))
    if (owner) result.get(owner.position)!.push(name)
  }
  return result
}
