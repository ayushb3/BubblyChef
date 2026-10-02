/**
 * Issue #892 -- a spice is never shown as "0.25 count Cinnamon".
 *
 * A recipe line for cinnamon is "1/4 tsp", "a pinch" or "to taste", never a count
 * of it. The dish-expansion model sometimes wrote `unit: "count"` for exactly
 * these foods, and those recipes are already stored (and, once edited, flattened
 * to text), so every display of a recipe line reads it through here: the amount
 * of an uncountable food that rests on "count" is shown as "to taste".
 *
 * A recipe's own unit ("tsp", "pinch") and a real count ("6 carrots", half an
 * onion) are never touched. Pure, no I/O.
 *
 * Mirrors `ai-service/bubbly_chef/domain/uncountable.py`, which cleans the line at
 * the model boundary so new recipes never carry the bad amount; keep the two lists
 * in step.
 */

export const TO_TASTE = 'to taste'

// Words that make a food uncountable wherever they sit in its name.
const SPICE_WORDS = new Set([
  'salt', 'cinnamon', 'cumin', 'paprika', 'turmeric', 'cayenne', 'nutmeg', 'coriander',
  'cardamom', 'allspice', 'oregano', 'thyme', 'rosemary', 'saffron', 'sage',
])

// Words that make a food uncountable when they are its head (last) word.
const HEAD_WORDS = new Set([
  'powder', 'flake', 'seasoning', 'spice', 'extract', 'zest', 'oil', 'vinegar', 'juice',
  'sauce', 'broth', 'stock', 'wine', 'water', 'milk', 'cream', 'syrup', 'honey', 'molasses', 'hummus',
  'mustard', 'ketchup', 'mayonnaise', 'dressing', 'paste', 'marinade', 'flour', 'sugar',
  'starch', 'cornstarch',
])

// A head word that makes the food a countable piece again ("cinnamon stick").
const COUNTABLE_FORMS = new Set(['stick', 'sprig', 'leaf', 'leave', 'pod', 'clove', 'bulb', 'head', 'bunch'])

// "pepper" alone, or after one of these, is the seasoning; after anything else
// ("bell", "chili", "red", "jalapeno") it is a vegetable you count.
const PEPPER_SEASONING_PREFIXES = new Set(['black', 'white', 'ground', 'cracked', 'freshly', 'lemon', 'and'])

// The count units a model writes for a spice. "item"/"items" is deliberately not here: it is
// the pantry's default package unit, so "milk, 2 items" is a real amount (this module reads
// recipe lines only).
const COUNT_LIKE_UNITS = new Set(['count', 'counts', 'ct'])

// Words whose base form ends in "s": never singularised ("molasses" is not "molasse").
const BASE_FORM_S_WORDS = new Set([
  'molasses', 'hummus', 'couscous', 'asparagus', 'watercress', 'lemongrass', 'citrus',
  'swiss', 'brussels', 'harissa', 'hibiscus',
])

function words(name: string): string[] {
  const head = name.toLowerCase().replace(/\([^)]*\)/g, ' ').split(',')[0]
  return head
    .split(/[^a-z]+/)
    .filter(Boolean)
    .map((w) => {
      if (w === 'leaves') return 'leaf'
      if (BASE_FORM_S_WORDS.has(w)) return w
      return w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w
    })
}

/** True for a spice, powder, oil or other liquid: a food whose "count" is nonsense. */
export function isUncountableFood(name: string): boolean {
  const w = words(name ?? '')
  if (w.length === 0) return false
  const head = w[w.length - 1]
  if (COUNTABLE_FORMS.has(head)) return false
  if (w.some((x) => SPICE_WORDS.has(x))) return true
  if (head === 'pepper') return w.length === 1 || PEPPER_SEASONING_PREFIXES.has(w[w.length - 2])
  return HEAD_WORDS.has(head)
}

export interface CleanedAmount {
  quantity: number | null | undefined
  unit: string | null | undefined
  /** The amount counted an uncountable food, so there is no real amount to show. */
  toTaste: boolean
}

/**
 * An ingredient's amount, with a count of an uncountable food dropped to "to
 * taste". Every other line comes back exactly as it went in.
 */
export function cleanIngredientAmount(
  name: string,
  quantity: number | null | undefined,
  unit: string | null | undefined,
): CleanedAmount {
  const same: CleanedAmount = { quantity, unit, toTaste: false }
  if (!isUncountableFood(name)) return same
  const unitWord = (unit ?? '').trim().toLowerCase()
  const toTaste =
    COUNT_LIKE_UNITS.has(unitWord) ||
    (unitWord === '' && typeof quantity === 'number' && Number.isFinite(quantity) && !Number.isInteger(quantity))
  return toTaste ? { quantity: null, unit: null, toTaste: true } : same
}

// "0.25 count Cinnamon", "1/4 count ground cumin": a number, a count word, a food.
const COUNTED_TEXT = /^\s*(?:\d+\s+\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)\s+(?:count|counts|ct)\s+(.+)$/i

/** A recipe line kept as text ("0.25 count Cinnamon"), read the same way. */
export function cleanIngredientString(text: string): string {
  const m = COUNTED_TEXT.exec(text)
  if (!m) return text
  const food = m[1].trim()
  return isUncountableFood(food) ? `${food}, ${TO_TASTE}` : text
}
