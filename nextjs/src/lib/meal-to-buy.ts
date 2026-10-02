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
import type { ManualLineInput } from '@/lib/grocery'
import type { MealToBuyDetail, MealToBuyItem } from '@/lib/api/grocery'
import type { ChatRecipeData } from '@/types/chat'

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

/**
 * What goes on the grocery list for a meal's to-buy (issue #850): each item with
 * the amount the meal lacks, its unit and its category, so a line reads "Feta
 * (200 g)" in the dairy group instead of a bare name under "other". An older
 * service sent no `items`: fall back to the bare names.
 */
export function groceryEntriesFromDetail(detail: MealToBuyDetail): Array<string | ManualLineInput> {
  if (!detail.items) return detail.names
  return detail.items.map(entryFromItem)
}

function entryFromItem(i: MealToBuyItem): ManualLineInput {
  return { name: i.name, quantity: i.quantity, unit: i.unit, category: i.category ?? undefined }
}

/**
 * position -> what a dish card's "Add to grocery list" key puts on the list
 * (issue #868): the same entries the meal page's line adds (the service's name,
 * amount, unit and category), in the same order as `toBuyByDish`'s names so the
 * key adds exactly the foods the line lists. The amount is the meal's (the
 * service sums a food shared by two dishes), not the dish's own share; the list
 * keeps the first amount a line gets, so adding both dishes' cards never
 * double-counts it. An older service sent no `items`: bare names, as
 * `toBuyByDish` falls back to.
 */
export function toBuyEntriesByDish(
  detail: MealToBuyDetail,
  dishes: DishIngredientNames[],
): Map<number, Array<string | ManualLineInput>> {
  if (!detail.items) return attributeToBuy(detail.names, dishes)
  const result = new Map<number, Array<string | ManualLineInput>>(dishes.map((d) => [d.position, []]))
  for (const item of detail.items) {
    for (const position of item.dishPositions) result.get(position)?.push(entryFromItem(item))
  }
  return result
}

/**
 * A chat recipe card's missing foods as list entries (issue #868). The card is
 * not a saved meal, so the meal-to-buy endpoint (which takes a meal id) can't be
 * asked; the pantry grading already says which foods are missing
 * (`ingredient_availability`), and the card's own ingredients say how much each
 * needs. A missing food is one with nothing usable on hand, so the recipe amount
 * is the amount to buy. No category: nothing on the card knows it, so the list
 * files it under "other". Undefined while the recipe is ungraded.
 */
export function toBuyEntriesFromRecipe(recipe: ChatRecipeData): Array<string | ManualLineInput> | undefined {
  if (!recipe.ingredient_availability) return undefined
  const byName = new Map((recipe.ingredients ?? []).map((ing) => [ing.name.trim().toLowerCase(), ing]))
  return recipe.ingredient_availability
    .filter((a) => a.status === 'missing')
    .map((a) => {
      const ing = byName.get(a.name.trim().toLowerCase())
      if (!ing) return a.name
      const quantity = typeof ing.quantity === 'number' && Number.isFinite(ing.quantity) ? ing.quantity : null
      return { name: ing.name, quantity, unit: quantity !== null ? (ing.unit ?? null) : null }
    })
}
