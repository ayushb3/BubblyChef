/**
 * @jest-environment node
 *
 * The deterministic expiry fallback used when the AI service can't be reached
 * (#705). It must agree with the Python `ExpiryHeuristics` the live path uses,
 * so the fixture exported from that table (ai-service/tests/fixtures/
 * expiry_heuristics.json, kept fresh by a pytest drift guard) is the contract.
 */
import fs from 'fs'
import path from 'path'
import {
  estimateExpiryFallback,
  EXPIRY_FALLBACK_TABLE,
} from '@/lib/expiry-fallback'

interface Fixture {
  shelf_life_days: Record<string, Record<string, number>>
  specific_items: Record<string, number>
  default_storage: Record<string, string>
  fallback_days: number
}

const fixture: Fixture = JSON.parse(
  fs.readFileSync(
    path.resolve(__dirname, '../../../ai-service/tests/fixtures/expiry_heuristics.json'),
    'utf-8',
  ),
)

const TODAY = '2026-10-01'

describe('expiry fallback table mirrors the Python heuristics (#705)', () => {
  it('carries the same shelf-life table', () => {
    expect(EXPIRY_FALLBACK_TABLE.shelfLifeDays).toEqual(fixture.shelf_life_days)
  })

  it('carries the same specific-item overrides, in the same order', () => {
    expect(Object.entries(EXPIRY_FALLBACK_TABLE.specificItems)).toEqual(
      Object.entries(fixture.specific_items),
    )
  })

  it('carries the same fallback days', () => {
    expect(EXPIRY_FALLBACK_TABLE.fallbackDays).toBe(fixture.fallback_days)
  })

  it('returns exactly today + table days for every category/location pair', () => {
    for (const [category, byLocation] of Object.entries(fixture.shelf_life_days)) {
      for (const [location, days] of Object.entries(byLocation)) {
        // A name that hits no specific-item override, so the table decides.
        const got = estimateExpiryFallback({ name: 'zzz', category, location, today: TODAY })
        const expected = new Date(Date.UTC(2026, 9, 1 + days)).toISOString().slice(0, 10)
        expect({ category, location, got }).toEqual({ category, location, got: expected })
      }
    }
  })
})

describe('estimateExpiryFallback behaviour', () => {
  it('honours a specific-item override by name (Python parity: substring, first match wins)', () => {
    // milk -> 10 days, regardless of the category table's 14 for dairy/fridge
    expect(
      estimateExpiryFallback({ name: 'Whole Milk', category: 'dairy', location: 'fridge', today: TODAY }),
    ).toBe('2026-10-11')
  })

  it('an unknown category is treated as "other", like the live endpoint', () => {
    // other/pantry = 30 days
    expect(
      estimateExpiryFallback({ name: 'zzz', category: 'not-a-category', location: 'pantry', today: TODAY }),
    ).toBe('2026-10-31')
  })

  it('an unknown or missing location is treated as "pantry", like the live endpoint', () => {
    // produce/pantry = 5 days
    expect(
      estimateExpiryFallback({ name: 'zzz', category: 'produce', location: 'cellar', today: TODAY }),
    ).toBe('2026-10-06')
    expect(
      estimateExpiryFallback({ name: 'zzz', category: 'produce', location: null, today: TODAY }),
    ).toBe('2026-10-06')
  })

  it('inherited property names are not categories or locations', () => {
    expect(
      estimateExpiryFallback({ name: 'zzz', category: 'constructor', location: 'toString', today: TODAY }),
    ).toBe('2026-10-31') // other/pantry
  })

  it('never returns null: no category and no location still yields a date', () => {
    const got = estimateExpiryFallback({ name: 'zzz', today: TODAY })
    expect(got).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(got).toBe('2026-10-31') // other/pantry
  })

  it('defaults "today" to the current date', () => {
    const got = estimateExpiryFallback({ name: 'zzz', category: 'canned', location: 'pantry' })
    const expected = new Date(Date.now() + 730 * 86_400_000).toISOString().slice(0, 10)
    expect(got).toBe(expected)
  })
})
