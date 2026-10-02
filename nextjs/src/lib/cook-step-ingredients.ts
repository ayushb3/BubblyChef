/**
 * Issue #849 — which of a dish's ingredients a cook step uses, and at what
 * (scaled) amount, for the chips on the cook-along's step card and the
 * Ingredients sheet. Pure, deterministic, no AI: a step's text is matched
 * against the dish's ingredient NAMES, and a step that matches nothing gets no
 * chips. It never guesses (an ambiguous name such as "oil" when the dish has
 * both olive and sesame oil matches neither).
 *
 * The amounts come from the same meal-scale list the pantry deduction uses
 * (`cookedIngredientsForDish`): an object ingredient is already scaled; a
 * plain-string ingredient ("2 tbsp butter", what `RecipeEditModal` saves) is
 * scaled here, on its leading number only, for display. A string with no
 * leading number ("salt to taste") shows as written.
 */

import {
  TO_TASTE,
  cleanIngredientAmount,
  cleanIngredientString,
  formatIngredientAmount,
  formatIngredientText,
  formatQuantity,
} from '@/lib/ingredient-amount'
import type { MealCookIngredient } from '@/types/meals'

export interface CookIngredient {
  /** Stable within one dish's list: its position. */
  key: string
  /** What the matcher reads: the ingredient's name, without any amount. */
  name: string
  /** What is shown: the scaled amount and the name ("4 tbsp butter"). */
  label: string
}

// ---------------------------------------------------------------------------
// Scaling a plain-string ingredient's leading number
// ---------------------------------------------------------------------------

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
}

// "1 1/2", "1/2", "1½", "½", "2.5", "3". Anchored to the start of the string.
const LEADING_NUMBER = /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+\s*[¼½¾⅓⅔]|[¼½¾⅓⅔]|\d*\.\d+|\d+)/

function parseLeadingNumber(raw: string): number | null {
  const s = raw.trim()
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s)
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const frac = /^(\d+)\/(\d+)$/.exec(s)
  if (frac) return Number(frac[1]) / Number(frac[2])
  const uni = /^(\d*)\s*([¼½¾⅓⅔])$/.exec(s)
  if (uni) return (uni[1] ? Number(uni[1]) : 0) + UNICODE_FRACTIONS[uni[2]]
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

/**
 * Scales the leading number of a plain-string ingredient by `factor`. A string
 * that doesn't start with a number, a `factor` of 1, or a non-positive /
 * non-finite factor, comes back unchanged.
 */
export function scaleIngredientString(text: string, factor: number): string {
  if (!Number.isFinite(factor) || factor <= 0 || factor === 1) return text
  const m = LEADING_NUMBER.exec(text)
  if (!m) return text
  const value = parseLeadingNumber(m[1])
  if (value === null) return text
  const scaled = Number((value * factor).toFixed(2))
  return `${scaled}${text.slice(m[0].length)}`
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const UNITS = new Set([
  'cup', 'cups', 'tbsp', 'tsp', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons',
  'g', 'gram', 'grams', 'kg', 'oz', 'ounce', 'ounces', 'lb', 'lbs', 'pound', 'pounds',
  'ml', 'l', 'litre', 'litres', 'liter', 'liters', 'clove', 'cloves', 'pinch', 'dash',
  'can', 'cans', 'slice', 'slices', 'bunch', 'sprig', 'sprigs', 'stalk', 'stalks',
  'head', 'heads', 'handful', 'piece', 'pieces', 'stick', 'sticks',
])

/** Words that describe an ingredient without being what it is. */
const DESCRIPTORS = new Set([
  'fresh', 'large', 'small', 'medium', 'chopped', 'minced', 'diced', 'sliced', 'grated',
  'ground', 'whole', 'optional', 'of', 'a', 'an', 'the', 'and', 'or', 'to', 'taste',
  'finely', 'roughly', 'freshly', 'extra', 'good', 'quality', 'ripe', 'cold', 'warm', 'hot',
])

/** Plural to singular, the same way on both sides of a comparison. */
function singular(word: string): string {
  if (word.length > 4 && word.endsWith('ies')) return `${word.slice(0, -3)}y`
  if (word.length > 4 && /(oes|ches|shes|sses|xes)$/.test(word)) return word.slice(0, -2)
  if (word.length > 3 && word.endsWith('s') && !word.endsWith('ss')) return word.slice(0, -1)
  return word
}

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1)
    .map(singular)
}

/** The matcher's tokens for an ingredient name: descriptors and amounts dropped. */
function nameTokens(name: string): string[] {
  // "garlic, minced": what follows a comma is preparation.
  const head = name.split(',')[0]
  const words = head
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^a-z]+/)
    .filter((w) => w.length > 1)
    .filter((w) => !UNITS.has(w) && !DESCRIPTORS.has(w))
    .map(singular)
  return words
}

/** A plain string's name with its leading amount removed ("2 cloves garlic" -> "garlic"). */
function stripLeadingAmount(text: string): string {
  const m = LEADING_NUMBER.exec(text)
  const rest = (m ? text.slice(m[0].length) : text).trim()
  return rest
}

// ---------------------------------------------------------------------------
// A dish's list, ready for display and matching
// ---------------------------------------------------------------------------

/**
 * The dish's meal-scale ingredient list as chips/rows. `stringScale` is
 * `cookedIngredientsForDish`'s `string_scale`, applied to plain strings only
 * (objects arrive already scaled). A blank entry is dropped.
 */
export function cookIngredientsFor(
  ingredients: (string | MealCookIngredient)[],
  stringScale: number,
): CookIngredient[] {
  const out: CookIngredient[] = []
  ingredients.forEach((ing, i) => {
    if (typeof ing === 'string') {
      // "0.25 count Cinnamon" (a flattened recipe line) reads as "Cinnamon, to taste" (#892).
      const text = cleanIngredientString(ing.trim())
      if (!text) return
      out.push({
        key: String(i),
        name: stripLeadingAmount(text) || text,
        // "1 count eggs" reads as "1 egg", "3 tablespoon sugar" as "3 tbsp sugar" (#901).
        label: formatIngredientText(scaleIngredientString(text, stringScale)),
      })
      return
    }
    const name = (ing.name ?? '').trim()
    if (!name) return
    // A count of a spice, powder or liquid is "to taste", never "0.25 count" (#892).
    if (cleanIngredientAmount(name, ing.quantity, ing.unit).toTaste) {
      out.push({ key: String(i), name, label: `${name}, ${TO_TASTE}` })
      return
    }
    if (typeof ing.quantity !== 'number' || !Number.isFinite(ing.quantity)) {
      out.push({ key: String(i), name, label: name })
      return
    }
    // Every other amount reads like a recipe: no "count", plural units, fractions (#901). "item"
    // is the pantry's filler package unit, so it is not read out ("2 milk", not "2 items milk").
    const filler = /^items?$/i.test((ing.unit ?? '').trim())
    const amount = filler
      ? { quantityText: formatQuantity(ing.quantity), name }
      : formatIngredientAmount(name, ing.quantity, ing.unit)
    out.push({ key: String(i), name, label: `${amount.quantityText} ${amount.name}`.trim() })
  })
  return out
}

// ---------------------------------------------------------------------------
// Matching a step to the ingredients it uses
// ---------------------------------------------------------------------------

/**
 * The ingredients (in the dish's own order) the step names, matched by
 * ingredient name against the step's label and text:
 *  1. every word of the ingredient's name is in the step ("olive oil" in
 *     "Heat the olive oil"), or
 *  2. its last word is in the step AND no other ingredient of the dish ends in
 *     the same word ("butter" in "Melt the butter" for "unsalted butter";
 *     "oil" with both olive and sesame oil on the list matches neither).
 * Plurals match singulars. Nothing else counts, and no match is `[]`.
 */
export function ingredientsForStep(
  stepLabel: string,
  stepText: string,
  ingredients: CookIngredient[],
): CookIngredient[] {
  const stepTokens = new Set(tokens(`${stepLabel} ${stepText}`))
  if (stepTokens.size === 0) return []

  const named = ingredients.map((ing) => ({ ing, words: nameTokens(ing.name) }))
  const headCount = new Map<string, number>()
  for (const { words } of named) {
    const head = words[words.length - 1]
    if (head) headCount.set(head, (headCount.get(head) ?? 0) + 1)
  }

  return named
    .filter(({ words }) => {
      if (words.length === 0) return false
      if (words.every((w) => stepTokens.has(w))) return true
      const head = words[words.length - 1]
      return stepTokens.has(head) && headCount.get(head) === 1
    })
    .map(({ ing }) => ing)
}
