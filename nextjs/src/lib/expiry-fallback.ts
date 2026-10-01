/**
 * Deterministic expiry estimate for when the AI service can't be reached (#705).
 *
 * The live estimate comes from `POST /v1/pantry/estimate-expiry`, which runs the
 * Python `ExpiryHeuristics` (ai-service/bubbly_chef/tools/expiry.py) — no model
 * call. When that request fails or times out, `estimateExpiry()` in
 * `lib/api/ai-proxy.ts` uses this module instead, so a pantry add never lands
 * with a null expiry just because the service was cold or down.
 *
 * This is a MIRROR of the Python table, not a second source of truth. Drift is
 * caught by a pytest (ai-service/tests/test_expiry_fallback_fixture.py) that pins
 * the Python table to tests/fixtures/expiry_heuristics.json, and a Jest test
 * (__tests__/expiry-fallback.test.ts) that pins this table to the same file.
 * Change a number in one place and both fail until the other follows.
 *
 * Unknown inputs behave like the live endpoint: an unrecognised category is
 * 'other', an unrecognised or missing location is 'pantry' — so this never
 * returns null.
 */
import { addDaysToDateString } from '@/lib/date'

type DaysByLocation = Record<string, number>

export const EXPIRY_FALLBACK_TABLE: {
  shelfLifeDays: Record<string, DaysByLocation>
  /** Substring match against the lowercased name; the first entry that hits wins. */
  specificItems: Record<string, number>
  /** Used when a (category, location) pair isn't in the table. */
  fallbackDays: number
} = {
  shelfLifeDays: {
    produce: { fridge: 7, counter: 5, freezer: 180, pantry: 5 },
    dairy: { fridge: 14, freezer: 90, counter: 1, pantry: 1 },
    meat: { fridge: 3, freezer: 120, counter: 0, pantry: 0 },
    seafood: { fridge: 2, freezer: 90, counter: 0, pantry: 0 },
    frozen: { freezer: 180, fridge: 3, counter: 0, pantry: 0 },
    canned: { pantry: 730, fridge: 730, freezer: 730, counter: 730 },
    dry_goods: { pantry: 365, fridge: 365, freezer: 365, counter: 365 },
    condiments: { fridge: 180, pantry: 90, freezer: 365, counter: 30 },
    beverages: { fridge: 14, pantry: 180, freezer: 365, counter: 7 },
    snacks: { pantry: 90, fridge: 90, freezer: 180, counter: 30 },
    bakery: { counter: 5, pantry: 7, fridge: 10, freezer: 90 },
    other: { fridge: 7, pantry: 30, freezer: 90, counter: 7 },
  },
  specificItems: {
    milk: 10,
    eggs: 21,
    bread: 7,
    bananas: 5,
    avocado: 4,
    lettuce: 5,
    spinach: 5,
    'ground beef': 2,
    'chicken breast': 2,
    yogurt: 14,
    butter: 30,
    cheese: 21,
  },
  fallbackDays: 30,
}

// Own-key check, so inputs like "constructor" can't match an inherited property.
const has = (obj: object, key: string): boolean => Object.prototype.hasOwnProperty.call(obj, key)

/**
 * Estimate an ISO expiry date (YYYY-MM-DD) from name, category and location.
 * `today` is injectable for tests; it defaults to the server's UTC date (the
 * Python heuristic likewise uses the server's date).
 */
export function estimateExpiryFallback(item: {
  name: string
  category?: string | null
  location?: string | null
  today?: string
}): string {
  const today = item.today ?? new Date().toISOString().slice(0, 10)
  const { shelfLifeDays, specificItems, fallbackDays } = EXPIRY_FALLBACK_TABLE

  const nameLower = (item.name ?? '').toLowerCase()
  if (nameLower) {
    for (const [needle, days] of Object.entries(specificItems)) {
      if (nameLower.includes(needle)) return addDaysToDateString(today, days)
    }
  }

  const category = item.category && has(shelfLifeDays, item.category) ? item.category : 'other'
  const location = item.location && has(shelfLifeDays.other, item.location) ? item.location : 'pantry'
  const days = shelfLifeDays[category][location] ?? fallbackDays
  return addDaysToDateString(today, days)
}
