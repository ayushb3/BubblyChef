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

// ---------------------------------------------------------------------------
// Issue #901 -- an amount reads like a recipe, not a database row: no "count",
// the unit set by the amount, fraction glyphs. Pure, no I/O. Recipe lines only:
// grocery and pantry quantities keep their own wording ("Milk (2 items)").
// ---------------------------------------------------------------------------

const FRACTION_GLYPHS: Array<[number, string]> = [
  [0.25, '¼'],
  [1 / 3, '⅓'],
  [0.5, '½'],
  [2 / 3, '⅔'],
  [0.75, '¾'],
]
const GLYPH_VALUES: Record<string, number> = {
  '¼': 0.25,
  '⅓': 1 / 3,
  '½': 0.5,
  '⅔': 2 / 3,
  '¾': 0.75,
}
// How close to a common fraction an amount must be to be written as its glyph.
const FRACTION_EPSILON = 0.01

/** 1.5 -> "1½", 0.25 -> "¼", 3 -> "3". Any other amount is a decimal, trimmed to 2 places. */
export function formatQuantity(n: number): string {
  if (!Number.isFinite(n)) return String(n)
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  const whole = Math.floor(abs)
  const frac = abs - whole
  if (1 - frac < FRACTION_EPSILON) return `${sign}${whole + 1}`
  for (const [value, glyph] of FRACTION_GLYPHS) {
    if (Math.abs(frac - value) < FRACTION_EPSILON) return `${sign}${whole > 0 ? whole : ''}${glyph}`
  }
  return `${sign}${Number(abs.toFixed(2))}`
}

/** A quantity as a number: a number, "1/2", "1 1/2", "1½", "½" or "2.5". Anything else is null. */
export function parseQuantity(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw !== 'string') return null
  const s = raw.trim()
  if (!s) return null
  const mixed = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s)
  if (mixed && Number(mixed[3]) !== 0) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3])
  const frac = /^(\d+)\/(\d+)$/.exec(s)
  if (frac && Number(frac[2]) !== 0) return Number(frac[1]) / Number(frac[2])
  const glyph = /^(\d*)\s*([¼⅓½⅔¾])$/.exec(s)
  if (glyph) return (glyph[1] ? Number(glyph[1]) : 0) + GLYPH_VALUES[glyph[2]]
  return /^\d*\.?\d+$/.test(s) ? Number(s) : null
}

// The house abbreviations: the pantry's own unit vocabulary (`pantry-quick-add`). Never pluralised.
const UNIT_ABBREVIATIONS = new Map<string, string>([
  ['tbsp', 'tbsp'], ['tbs', 'tbsp'], ['tablespoon', 'tbsp'], ['tablespoons', 'tbsp'],
  ['tsp', 'tsp'], ['teaspoon', 'tsp'], ['teaspoons', 'tsp'],
  ['oz', 'oz'], ['ounce', 'oz'], ['ounces', 'oz'],
  ['lb', 'lb'], ['lbs', 'lb'], ['pound', 'lb'], ['pounds', 'lb'],
  ['g', 'g'], ['gram', 'g'], ['grams', 'g'],
  ['kg', 'kg'], ['kgs', 'kg'], ['kilogram', 'kg'], ['kilograms', 'kg'],
  ['ml', 'ml'], ['milliliter', 'ml'], ['milliliters', 'ml'], ['millilitre', 'ml'], ['millilitres', 'ml'],
  ['l', 'L'], ['liter', 'L'], ['liters', 'L'], ['litre', 'L'], ['litres', 'L'],
])

// Units that take an "s" when there is more than one: singular -> plural.
const COUNTABLE_UNITS = new Map<string, string>([
  ['cup', 'cups'], ['clove', 'cloves'], ['can', 'cans'], ['slice', 'slices'], ['sprig', 'sprigs'],
  ['stick', 'sticks'], ['head', 'heads'], ['bunch', 'bunches'], ['handful', 'handfuls'],
  ['pinch', 'pinches'], ['dash', 'dashes'], ['package', 'packages'], ['bag', 'bags'],
  ['bottle', 'bottles'], ['jar', 'jars'], ['box', 'boxes'], ['container', 'containers'],
  ['loaf', 'loaves'], ['leaf', 'leaves'], ['piece', 'pieces'], ['stalk', 'stalks'],
  ['gallon', 'gallons'], ['quart', 'quarts'], ['pint', 'pints'], ['fillet', 'fillets'],
  ['strip', 'strips'], ['wedge', 'wedges'], ['scoop', 'scoops'], ['drop', 'drops'],
])
const UNIT_SINGULAR_BY_SPELLING = new Map<string, string>([['pkg', 'package'], ['pkgs', 'package']])
for (const [one, many] of COUNTABLE_UNITS) {
  UNIT_SINGULAR_BY_SPELLING.set(one, one)
  UNIT_SINGULAR_BY_SPELLING.set(many, one)
}

function isCountLikeUnit(unit: unknown): boolean {
  return typeof unit === 'string' && COUNT_LIKE_UNITS.has(unit.trim().toLowerCase())
}

/**
 * A unit as a recipe line shows it. `count` is never shown (it comes back "": the
 * number counts the food itself). Weight, volume and spoon units use the house
 * abbreviation ("tbsp", "tsp", "oz", "g"); a countable unit is plural above 1
 * ("1 cup", "½ cup", "1½ cups", "3 cloves"); a unit not known here comes back as
 * written.
 */
export function formatUnit(unit: string, quantity: number | null): string {
  const raw = unit.trim()
  const key = raw.toLowerCase().replace(/\.$/, '')
  if (COUNT_LIKE_UNITS.has(key)) return ''
  const abbreviation = UNIT_ABBREVIATIONS.get(key)
  if (abbreviation) return abbreviation
  const singular = UNIT_SINGULAR_BY_SPELLING.get(key)
  if (!singular) return raw
  if (quantity === null) return singular
  return quantity > 1 ? (COUNTABLE_UNITS.get(singular) ?? singular) : singular
}

// "asparagus", "hummus", "swiss" end in s without being plurals.
function endsLikeBaseForm(lower: string): boolean {
  return BASE_FORM_S_WORDS.has(lower) || /(ss|us|is)$/.test(lower)
}

// "cookies" -> "cookie", not "cooky".
const IE_WORDS = new Set(['cookie', 'brownie', 'pie', 'smoothie', 'veggie', 'calzone'])
const SINGULAR_OF_IRREGULAR_PLURAL = new Map<string, string>([
  ['leaves', 'leaf'], ['loaves', 'loaf'], ['halves', 'half'],
])
// Foods a count never makes plural ("1 count rice").
const NO_PLURAL = new Set([
  'rice', 'pasta', 'bread', 'cheese', 'butter', 'garlic', 'ginger', 'chicken', 'beef', 'pork', 'fish',
  'tofu', 'salmon', 'shrimp', 'lettuce', 'spinach', 'kale', 'celery', 'corn', 'broccoli', 'cauliflower',
  'yogurt', 'cabbage', 'parsley', 'cilantro', 'basil', 'mint', 'dill', 'thyme',
])

function singularWord(word: string): string {
  const lower = word.toLowerCase()
  if (!lower.endsWith('s') || endsLikeBaseForm(lower)) return word
  const irregular = SINGULAR_OF_IRREGULAR_PLURAL.get(lower)
  if (irregular) return word.slice(0, word.length - lower.length) + irregular
  if (lower.length > 4 && lower.endsWith('ies')) {
    return IE_WORDS.has(lower.slice(0, -1)) ? word.slice(0, -1) : `${word.slice(0, -3)}y`
  }
  if (lower.length > 4 && /(oes|ches|shes|xes|zes)$/.test(lower)) return word.slice(0, -2)
  return lower.length > 3 ? word.slice(0, -1) : word
}

function pluralWord(word: string): string {
  const lower = word.toLowerCase()
  if (endsLikeBaseForm(lower) || NO_PLURAL.has(lower)) return word
  if (lower.endsWith('s')) return word // already plural
  if (word === word.toUpperCase() && /[A-Z]{2}/.test(word)) return word
  if (/(leaf|loaf)$/.test(lower)) return `${word.slice(0, -1)}ves`
  if (/[^aeiou]y$/.test(lower)) return `${word.slice(0, -1)}ies`
  if (/(s|x|z|ch|sh)$/.test(lower) || /(tomato|potato)$/.test(lower)) return `${word}es`
  return `${word}s`
}

/**
 * The food of a counted line set by its amount: "1 egg", "2 eggs", "½ onion", "1½ onions".
 * Only the food's own noun (the last word before a comma or bracket) changes, and a
 * food that is not countable is left as written.
 */
function foodForCount(name: string, quantity: number): string {
  const cut = name.search(/[,(]/)
  const head = cut === -1 ? name : name.slice(0, cut)
  const tail = cut === -1 ? '' : name.slice(cut)
  const trimmed = head.trimEnd()
  const gap = head.slice(trimmed.length)
  if (!trimmed || isUncountableFood(trimmed)) return name
  const space = trimmed.lastIndexOf(' ')
  const lead = trimmed.slice(0, space + 1)
  const word = trimmed.slice(space + 1)
  if (!/^[A-Za-z]+$/.test(word)) return name
  const next = quantity > 1 ? pluralWord(word) : singularWord(word)
  return `${lead}${next}${gap}${tail}`
}

export interface IngredientAmountText {
  /** "1½ cups", "3 tbsp", "2", or "" when the line has no amount. "to taste" when `toTaste`. */
  quantityText: string
  /** The food as displayed: set singular or plural for a count ("egg", "eggs"). */
  name: string
  toTaste: boolean
}

function isPresent(value: unknown): value is string | number {
  return value !== null && value !== undefined && value !== ''
}

/**
 * The amount and food of one recipe line, for display. Every ingredient display
 * reads a line through here: never "count", a unit set by its amount, a food set
 * by a count, fraction glyphs, and a count of a spice shown as "to taste" (#892).
 */
export function formatIngredientAmount(
  name: string,
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
): IngredientAmountText {
  const q = parseQuantity(quantity)
  if (cleanIngredientAmount(name, q, unit).toTaste) return { quantityText: TO_TASTE, name, toTaste: true }

  const qText = q !== null ? formatQuantity(q) : isPresent(quantity) ? String(quantity) : ''
  if (isCountLikeUnit(unit)) {
    return { quantityText: qText, name: q !== null ? foodForCount(name, q) : name, toTaste: false }
  }
  const uText = isPresent(unit) ? formatUnit(String(unit), q) : ''
  return { quantityText: [qText, uText].filter(Boolean).join(' '), name, toTaste: false }
}

/** Just the amount ("1½ cups", "2"), for a line whose food is shown elsewhere. */
export function formatAmountText(
  quantity: number | string | null | undefined,
  unit: string | null | undefined,
): string {
  const q = parseQuantity(quantity)
  const qText = q !== null ? formatQuantity(q) : isPresent(quantity) ? String(quantity) : ''
  const uText = isCountLikeUnit(unit) ? '' : isPresent(unit) ? formatUnit(String(unit), q) : ''
  return [qText, uText].filter(Boolean).join(' ')
}

// The leading amount of a flattened line: "1 1/2", "1/2", "1½", "½", "2.5", "3".
const LEADING_AMOUNT = /^\s*(\d+\s+\d+\/\d+|\d+\/\d+|\d+\s*[¼⅓½⅔¾]|[¼⅓½⅔¾]|\d*\.\d+|\d+)/

/**
 * A recipe line kept as text ("1 count eggs", "3 tablespoon sugar") read the same
 * way as an object line. A line whose amount is not followed by a unit this module
 * knows ("2 large eggs", "2-3 cloves", "a pinch of salt") comes back untouched.
 */
export function formatIngredientText(text: string): string {
  const cleaned = cleanIngredientString(text)
  if (cleaned !== text) return cleaned
  const m = LEADING_AMOUNT.exec(text)
  if (!m) return text
  const q = parseQuantity(m[1])
  if (q === null) return text
  const rest = /^\s+([A-Za-z]+)\.?(?:\s+([\s\S]*))?$/.exec(text.slice(m[0].length))
  if (!rest) return text
  const unitWord = rest[1]
  const food = (rest[2] ?? '').trim()
  const key = unitWord.toLowerCase()
  if (COUNT_LIKE_UNITS.has(key)) {
    return food ? `${formatQuantity(q)} ${foodForCount(food, q)}` : text
  }
  if (!UNIT_ABBREVIATIONS.has(key) && !UNIT_SINGULAR_BY_SPELLING.has(key)) return text
  return [formatQuantity(q), formatUnit(unitWord, q), food].filter(Boolean).join(' ')
}
