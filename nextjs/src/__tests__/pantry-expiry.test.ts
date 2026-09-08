import {
  daysUntilExpiry,
  enrichPantryItem,
  estimatedExpirySuffix,
  parseLocalDate,
} from '@/lib/pantry-helpers'
import type { PantryItemRow } from '@/lib/pantry-helpers'

/**
 * Regression tests for the expiry-date maths (#244).
 *
 * The original bug: `new Date("2026-08-25")` parses as UTC midnight while the
 * "today" it was compared against was local midnight, and one copy of the
 * calculation subtracted `Date.now()` rather than local midnight. West of UTC,
 * late in the day, a badge could read "Today" for an item the API reported as
 * one day out. These tests pin the local-midnight semantics at a time-of-day
 * (23:00) that would have exposed the old drift.
 */
describe('daysUntilExpiry', () => {
  afterEach(() => {
    jest.useRealTimers()
  })

  it('returns null for a missing date', () => {
    expect(daysUntilExpiry(null)).toBeNull()
  })

  it('reports 0 for an item expiring today, even late in the local day', () => {
    // 2026-08-25 23:00 local. Subtracting Date.now() (the old code) would give
    // a fractional day that rounds to 0 here but drifts negative for tomorrow.
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 25, 23, 0, 0))
    expect(daysUntilExpiry('2026-08-25')).toBe(0)
  })

  it('reports 1 for tomorrow at 23:00 local (no early-expiry drift)', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 25, 23, 0, 0))
    // The pre-fix bug rounded this to 0 ("Today") after ~18:00 local.
    expect(daysUntilExpiry('2026-08-26')).toBe(1)
  })

  it('reports negative for an item that already expired', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 25, 23, 0, 0))
    expect(daysUntilExpiry('2026-08-24')).toBe(-1)
  })
})

describe('parseLocalDate', () => {
  it('parses a date-only string at local midnight, not UTC midnight', () => {
    const d = parseLocalDate('2026-08-25')
    expect(d.getFullYear()).toBe(2026)
    expect(d.getMonth()).toBe(7) // August
    expect(d.getDate()).toBe(25)
    expect(d.getHours()).toBe(0)
  })

  it('leaves strings carrying a time component to the normal parser', () => {
    const d = parseLocalDate('2026-08-25T12:30:00Z')
    expect(Number.isNaN(d.getTime())).toBe(false)
  })
})

describe('enrichPantryItem expiry flags', () => {
  const baseRow: PantryItemRow = {
    id: '1',
    user_id: 'u',
    name: 'Milk',
    name_normalized: 'milk',
    category: 'dairy',
    location: 'fridge',
    quantity: 1,
    unit: 'carton',
    expiry_date: null,
    slot_index: null,
    added_at: '2026-08-01',
    updated_at: '2026-08-01',
  }

  afterEach(() => {
    jest.useRealTimers()
  })

  it('flags an already-expired item as expired, not expiring_soon', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 25, 23, 0, 0))
    const item = enrichPantryItem({ ...baseRow, expiry_date: '2026-08-20' })
    expect(item.is_expired).toBe(true)
    expect(item.is_expiring_soon).toBe(false)
  })

  it('flags an item within 3 days as expiring_soon, not expired', () => {
    jest.useFakeTimers().setSystemTime(new Date(2026, 7, 25, 23, 0, 0))
    const item = enrichPantryItem({ ...baseRow, expiry_date: '2026-08-27' })
    expect(item.is_expired).toBe(false)
    expect(item.is_expiring_soon).toBe(true)
  })

  it('carries estimated_expiry through untouched when present', () => {
    const item = enrichPantryItem({ ...baseRow, expiry_date: '2026-08-27', estimated_expiry: true })
    expect(item.estimated_expiry).toBe(true)
  })

  it('does not invent estimated_expiry when the row omits it (#182)', () => {
    // Rows fetched before the backing column existed — must not crash and
    // must not be treated as truthy.
    const item = enrichPantryItem({ ...baseRow, expiry_date: '2026-08-27' })
    expect(item.estimated_expiry).toBeUndefined()
  })
})

/**
 * #182: a subtle "(est.)" marker on the expiry label when the date is a
 * heuristic guess, so users can tell a guess from a fact. Purely a display
 * suffix — must never change days-until-expiry, is_expired, or sort order.
 */
describe('estimatedExpirySuffix', () => {
  it('renders nothing when the date is not estimated', () => {
    expect(estimatedExpirySuffix(false)).toBe('')
  })

  it('renders nothing when estimated_expiry is missing (pre-migration data)', () => {
    expect(estimatedExpirySuffix(undefined)).toBe('')
    expect(estimatedExpirySuffix(null)).toBe('')
  })

  it('renders a subtle marker when the date is estimated', () => {
    expect(estimatedExpirySuffix(true)).toBe(' (est.)')
  })
})
