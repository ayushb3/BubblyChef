/**
 * Typed pantry add, as a list (issue #851).
 *
 * "eggs, milk, 2 lb chicken" used to become one item with that whole name. It is
 * now three: the text is split on commas, semicolons and newlines, and each piece
 * is read for a leading (or trailing) quantity and unit. Deterministic and
 * client-side: no model is called. Categories are not guessed here; a row left on
 * "Other" gets its category from the bulk write's existing estimate-category path.
 *
 * The unit vocabulary mirrors the ai-service normaliser's `_UNIT_ALIASES`
 * (`ai-service/bubbly_chef/domain/normalizer.py`): the same spellings, collapsed
 * to the form the Add form's unit select uses ("lbs" -> "lb", "liters" -> "L").
 * A size word ("large", "medium") is not a unit, same as there: "3 large eggs" is
 * 3 of "large eggs".
 */

export interface ParsedPantryEntry {
  name: string
  quantity: number
  /** A unit from the vocabulary below, or `item` when none was given. */
  unit: string
}

const DEFAULT_UNIT = 'item'

// Singular canonical -> every spelling that means it. Keys are what the form shows.
const UNIT_SPELLINGS: Record<string, string[]> = {
  lb: ['lb', 'lbs', 'pound', 'pounds'],
  oz: ['oz', 'ounce', 'ounces'],
  kg: ['kg', 'kgs', 'kilogram', 'kilograms'],
  g: ['g', 'gram', 'grams'],
  L: ['l', 'liter', 'liters', 'litre', 'litres'],
  ml: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'],
  item: ['item', 'items', 'piece', 'pieces', 'each'],
  count: ['count', 'ct'],
  dozen: ['dozen'],
  stick: ['stick', 'sticks'],
  cup: ['cup', 'cups'],
  tbsp: ['tbsp', 'tablespoon', 'tablespoons'],
  tsp: ['tsp', 'teaspoon', 'teaspoons'],
  'fl oz': ['fl oz', 'fluid ounce', 'fluid ounces'],
  gallon: ['gallon', 'gallons', 'gal'],
  quart: ['quart', 'quarts', 'qt'],
  pint: ['pint', 'pints', 'pt'],
  slice: ['slice', 'slices'],
  leaf: ['leaf', 'leaves'],
  clove: ['clove', 'cloves'],
  sprig: ['sprig', 'sprigs'],
  head: ['head', 'heads'],
  bunch: ['bunch', 'bunches'],
  handful: ['handful', 'handfuls'],
  pinch: ['pinch', 'pinches'],
  dash: ['dash', 'dashes'],
  can: ['can', 'cans'],
  package: ['package', 'packages', 'pkg', 'pkgs'],
  bag: ['bag', 'bags'],
  bottle: ['bottle', 'bottles'],
  jar: ['jar', 'jars'],
  box: ['box', 'boxes'],
  container: ['container', 'containers'],
  loaf: ['loaf', 'loaves'],
}

const UNIT_BY_SPELLING = new Map<string, string>(
  Object.entries(UNIT_SPELLINGS).flatMap(([unit, spellings]) =>
    spellings.map((s): [string, string] => [s, unit]),
  ),
)

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  eleven: 11,
  twelve: 12,
  half: 0.5,
}

const UNICODE_FRACTIONS: Record<string, number> = {
  '¼': 0.25,
  '½': 0.5,
  '¾': 0.75,
  '⅓': 1 / 3,
  '⅔': 2 / 3,
  '⅛': 0.125,
  '⅜': 0.375,
  '⅝': 0.625,
  '⅞': 0.875,
}

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= '0' && ch <= '9'
}

/**
 * Split typed text into one string per item: on commas, semicolons and newlines.
 * A comma between two digits is part of a number ("1,000 g", "2,5 kg"), not a
 * separator. Blank pieces are dropped.
 */
export function splitPantryList(text: string): string[] {
  const pieces: string[] = []
  let current = ''
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    const isSeparator =
      ch === ';' || ch === '\n' || ch === '\r' || (ch === ',' && !(isDigit(text[i - 1]) && isDigit(text[i + 1])))
    if (isSeparator) {
      pieces.push(current)
      current = ''
    } else {
      current += ch
    }
  }
  pieces.push(current)
  return pieces.map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => p.length > 0)
}

/** "1,000" is a thousand; "2,5" is two and a half; "2.5" is two and a half. */
function parseDecimal(token: string): number | null {
  let normalized = token
  if (token.includes(',')) {
    normalized = /^\d{1,3}(,\d{3})+$/.test(token) ? token.replace(/,/g, '') : token.replace(',', '.')
  }
  if (!/^(\d+(\.\d+)?|\.\d+)$/.test(normalized)) return null
  const n = Number(normalized)
  return Number.isFinite(n) ? n : null
}

/** A bare quantity token: 2, 2.5, 1/2, ½, 1½, or a number word (a, one, half). */
function parseQuantityToken(token: string): number | null {
  const lower = token.toLowerCase()
  if (lower in WORD_NUMBERS) return WORD_NUMBERS[lower]

  const slash = /^(\d+)\/(\d+)$/.exec(token)
  if (slash) {
    const den = Number(slash[2])
    return den > 0 ? Number(slash[1]) / den : null
  }

  const last = token.slice(-1)
  if (last in UNICODE_FRACTIONS) {
    const whole = token.slice(0, -1)
    if (whole === '') return UNICODE_FRACTIONS[last]
    const w = parseDecimal(whole)
    return w === null ? null : w + UNICODE_FRACTIONS[last]
  }

  return parseDecimal(token)
}

function isFractionToken(token: string): boolean {
  const q = /^(\d+)\/(\d+)$/.test(token) || (token.slice(-1) in UNICODE_FRACTIONS && token.length === 1)
  return q
}

/** "500g", "2L", "3x": a number with a unit (or a multiplier x) stuck to it. */
function parseAttached(token: string): { quantity: number; unit: string | null } | null {
  const m = /^(.*?[\d½¼¾⅓⅔⅛⅜⅝⅞])([a-zA-Z×]+)$/.exec(token)
  if (!m) return null
  const quantity = parseQuantityToken(m[1])
  if (quantity === null || quantity <= 0) return null
  const suffix = m[2].toLowerCase()
  if (suffix === 'x' || suffix === '×') return { quantity, unit: null }
  const unit = UNIT_BY_SPELLING.get(suffix)
  return unit ? { quantity, unit } : null
}

function isMultiplier(token: string | undefined): boolean {
  return token === 'x' || token === 'X' || token === '×'
}

/** The unit at tokens[i], and how many tokens it takes ("fl oz" takes two). */
function unitAt(tokens: string[], i: number): { unit: string; length: number } | null {
  if (i >= tokens.length) return null
  if (i + 1 < tokens.length) {
    const two = UNIT_BY_SPELLING.get(`${tokens[i]} ${tokens[i + 1]}`.toLowerCase())
    if (two) return { unit: two, length: 2 }
  }
  const one = UNIT_BY_SPELLING.get(tokens[i].toLowerCase())
  return one ? { unit: one, length: 1 } : null
}

function fallback(text: string): ParsedPantryEntry {
  return { name: text, quantity: 1, unit: DEFAULT_UNIT }
}

function parseLeading(tokens: string[]): ParsedPantryEntry | null {
  let i = 0
  let quantity: number | null = null
  let unit: string | null = null

  const first = tokens[0].toLowerCase()
  if (first === 'dozen') {
    // "dozen eggs": one dozen.
    quantity = 1
    unit = 'dozen'
    i = 1
  } else {
    const attached = parseAttached(tokens[0])
    if (attached) {
      quantity = attached.quantity
      unit = attached.unit
      i = 1
    } else {
      const q = parseQuantityToken(tokens[0])
      if (q === null || q <= 0 || tokens.length < 2) return null
      // "half and half" is the cream, not 0.5 of "and half".
      if (first === 'half' && tokens[1].toLowerCase() === 'and') return null
      quantity = q
      i = 1
      // "half a dozen"
      if (first === 'half' && ['a', 'an'].includes(tokens[i]?.toLowerCase())) i++
      // "1 1/2 cups": a whole number followed by a fraction.
      else if (/^\d+$/.test(tokens[0]) && tokens[i] !== undefined && isFractionToken(tokens[i])) {
        quantity += parseQuantityToken(tokens[i]) ?? 0
        i++
      }
    }
  }

  if (isMultiplier(tokens[i])) i++

  if (unit === null) {
    const found = unitAt(tokens, i)
    if (found) {
      unit = found.unit
      i += found.length
    }
  }

  if (tokens[i]?.toLowerCase() === 'of' && i + 1 < tokens.length) i++

  const name = tokens.slice(i).join(' ')
  if (!name) return null
  return { name, quantity, unit: unit ?? DEFAULT_UNIT }
}

function parseTrailing(tokens: string[]): ParsedPantryEntry | null {
  const n = tokens.length
  if (n < 2) return null
  const last = tokens[n - 1]

  // "eggs x12"
  const xAttached = /^[xX×](.+)$/.exec(last)
  if (xAttached) {
    const q = parseQuantityToken(xAttached[1])
    if (q !== null && q > 0 && /\d/.test(xAttached[1])) {
      return { name: tokens.slice(0, n - 1).join(' '), quantity: q, unit: DEFAULT_UNIT }
    }
  }

  // "milk 2L", "rice 500g"
  const attached = parseAttached(last)
  if (attached) {
    return {
      name: tokens.slice(0, n - 1).join(' '),
      quantity: attached.quantity,
      unit: attached.unit ?? DEFAULT_UNIT,
    }
  }

  // "chicken 2 lb"
  if (n >= 3) {
    for (const length of [2, 1]) {
      if (n - length - 1 < 1) continue
      const u = unitAt(tokens.slice(n - length), 0)
      if (!u || u.length !== length) continue
      const q = parseQuantityToken(tokens[n - length - 1])
      if (q !== null && q > 0 && /[\d½¼¾⅓⅔⅛⅜⅝⅞]/.test(tokens[n - length - 1])) {
        return { name: tokens.slice(0, n - length - 1).join(' '), quantity: q, unit: u.unit }
      }
    }
  }

  // "tomatoes x 3", "eggs 12"
  const q = parseQuantityToken(last)
  if (q !== null && q > 0 && /\d/.test(last)) {
    const before = tokens.slice(0, n - 1)
    if (isMultiplier(before[before.length - 1])) before.pop()
    if (before.length > 0) return { name: before.join(' '), quantity: q, unit: DEFAULT_UNIT }
  }

  return null
}

/**
 * Read one piece ("2 lb chicken", "a dozen eggs", "3 x tomatoes", "milk 2L") into
 * a name, quantity and unit. With no quantity it is one `item`. Never throws and
 * never returns an empty name for a non-empty piece.
 */
export function parsePantryEntry(raw: string): ParsedPantryEntry {
  const text = raw.replace(/\s+/g, ' ').trim()
  if (!text) return { name: '', quantity: 1, unit: DEFAULT_UNIT }
  const tokens = text.split(' ')
  return parseLeading(tokens) ?? parseTrailing(tokens) ?? fallback(text)
}

/** Split typed text and read each piece. */
export function parsePantryList(text: string): ParsedPantryEntry[] {
  return splitPantryList(text).map(parsePantryEntry)
}

/** True when typed text holds more than one entry (a separator splits it). */
export function looksLikeList(text: string): boolean {
  return splitPantryList(text).length > 1
}
