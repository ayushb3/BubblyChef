/**
 * Unit tests for the notification-center derivation (#496, Spec B.4).
 * Covers the acceptance criteria directly: tiering, ordering, the cap, and
 * the empty case.
 */
import { deriveInboxEntries, INBOX_CAP } from '@/lib/inbox-helpers'
import type { EnrichedPantryItem } from '@/lib/pantry-helpers'

const NOW = new Date('2026-09-23T12:00:00')

function pantryItem(overrides: Partial<EnrichedPantryItem> = {}): EnrichedPantryItem {
  return {
    id: overrides.id ?? 'item-1',
    user_id: 'user-1',
    name: overrides.name ?? 'Milk',
    name_normalized: (overrides.name ?? 'milk').toLowerCase(),
    category: 'dairy',
    location: 'fridge',
    quantity: overrides.quantity ?? 1,
    unit: 'item',
    expiry_date: overrides.expiry_date ?? null,
    slot_index: null,
    added_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    storage_location: 'fridge',
    days_until_expiry: overrides.days_until_expiry ?? null,
    is_expired: overrides.is_expired ?? false,
    is_expiring_soon: overrides.is_expiring_soon ?? false,
    ...overrides,
  }
}

describe('deriveInboxEntries', () => {
  it('returns an empty derivation for an empty pantry with a recent cook (AC: empty pantry, no timers)', () => {
    // Cooked yesterday -> the "haven't cooked in a while" nudge stays quiet
    // too, so an empty pantry with no timers derives to genuinely zero
    // entries — matching the "never an empty box, but no badge either"
    // acceptance criterion.
    const result = deriveInboxEntries(
      { pantryItems: [], recipes: [{ last_cooked_at: '2026-09-22T00:00:00Z' }] },
      NOW,
    )
    expect(result.entries).toEqual([])
    expect(result.totalCount).toBe(0)
    expect(result.overflowCount).toBe(0)
  })

  it('tiers an expired item ahead of one expiring tomorrow, expired first', () => {
    const expired = pantryItem({
      id: 'expired-1',
      name: 'Old Yogurt',
      expiry_date: '2026-09-20',
      days_until_expiry: -3,
      is_expired: true,
    })
    const expiringTomorrow = pantryItem({
      id: 'expiring-1',
      name: 'Fresh Bread',
      expiry_date: '2026-09-24',
      days_until_expiry: 1,
      is_expiring_soon: true,
    })

    const result = deriveInboxEntries(
      { pantryItems: [expiringTomorrow, expired], recipes: [{ last_cooked_at: NOW.toISOString() }] },
      NOW,
    )

    expect(result.entries).toHaveLength(2)
    expect(result.entries[0].kind).toBe('expired')
    expect(result.entries[0].id).toBe('expired:expired-1')
    expect(result.entries[1].kind).toBe('expiring')
    expect(result.entries[1].id).toBe('expiring:expiring-1')
  })

  it('never fires the cook nudge for an account with zero saved recipes (AC: empty pantry -> no badge)', () => {
    // "No cooks" (the issue's own phrasing) means no *saved* recipe has ever
    // been cooked — not "this account owns zero recipes". A brand-new
    // account with nothing saved yet has nothing to suggest cooking from,
    // so the nudge must stay silent here, or the "empty pantry, no timers
    // -> bell shows no badge" acceptance criterion would never actually
    // hold for a fresh account.
    const result = deriveInboxEntries({ pantryItems: [], recipes: [] }, NOW)
    expect(result.entries).toEqual([])
    expect(result.totalCount).toBe(0)
  })

  it('orders expiring entries by days remaining, soonest first', () => {
    const in3days = pantryItem({ id: 'a', expiry_date: '2026-09-26', days_until_expiry: 3 })
    const today = pantryItem({ id: 'b', expiry_date: '2026-09-23', days_until_expiry: 0 })
    const in1day = pantryItem({ id: 'c', expiry_date: '2026-09-24', days_until_expiry: 1 })

    const result = deriveInboxEntries(
      { pantryItems: [in3days, today, in1day], recipes: [{ last_cooked_at: NOW.toISOString() }] },
      NOW,
    )

    expect(result.entries.map((e) => e.id)).toEqual([
      'expiring:b',
      'expiring:c',
      'expiring:a',
    ])
  })

  it('excludes items expiring outside the 3-day window', () => {
    const farOut = pantryItem({ id: 'far', expiry_date: '2026-10-01', days_until_expiry: 8 })
    const result = deriveInboxEntries(
      { pantryItems: [farOut], recipes: [{ last_cooked_at: NOW.toISOString() }] },
      NOW,
    )
    expect(result.entries).toEqual([])
  })

  it('adds a low-stock entry for a zero-quantity row', () => {
    const outOfStock = pantryItem({ id: 'out', name: 'Eggs', quantity: 0 })
    const result = deriveInboxEntries(
      { pantryItems: [outOfStock], recipes: [{ last_cooked_at: NOW.toISOString() }] },
      NOW,
    )
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].kind).toBe('low_stock')
    expect(result.entries[0].copy).toContain('Eggs')
  })

  it('does not add a low-stock entry for a positive quantity', () => {
    const inStock = pantryItem({ id: 'ok', quantity: 2 })
    const result = deriveInboxEntries(
      { pantryItems: [inStock], recipes: [{ last_cooked_at: NOW.toISOString() }] },
      NOW,
    )
    expect(result.entries).toEqual([])
  })

  it('adds the cook nudge when the most recent cook was more than 7 days ago', () => {
    const result = deriveInboxEntries(
      { pantryItems: [], recipes: [{ last_cooked_at: '2026-09-01T00:00:00Z' }] },
      NOW,
    )
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].kind).toBe('cook_nudge')
  })

  it('adds the cook nudge when no recipe has ever been cooked', () => {
    const result = deriveInboxEntries(
      { pantryItems: [], recipes: [{ last_cooked_at: null }, { last_cooked_at: null }] },
      NOW,
    )
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].kind).toBe('cook_nudge')
  })

  it('omits the cook nudge when a recipe was cooked within the last 7 days', () => {
    const result = deriveInboxEntries(
      { pantryItems: [], recipes: [{ last_cooked_at: '2026-09-20T00:00:00Z' }] },
      NOW,
    )
    expect(result.entries).toEqual([])
  })

  it('ignores timers and the grocery pointer when the feature is absent', () => {
    const result = deriveInboxEntries(
      { pantryItems: [], recipes: [{ last_cooked_at: NOW.toISOString() }] },
      NOW,
    )
    expect(result.entries).toEqual([])
  })

  it('includes timer entries when the B.3 feed is present', () => {
    const result = deriveInboxEntries(
      {
        pantryItems: [],
        recipes: [{ last_cooked_at: NOW.toISOString() }],
        timers: [{ id: 't1', label: 'Pasta' }],
      },
      NOW,
    )
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].kind).toBe('timer')
    expect(result.entries[0].href).toBeNull()
  })

  // #496's acceptance criteria ask, verbatim: "With Spec B.3 merged, a
  // completed timer appears as an entry until dismissed. (If B.3 is not
  // merged yet, the hook's timer source is a no-op and the test for it is
  // skipped with a reason.)" B.3 hasn't merged — there is no real timer
  // store to drive `useInboxEntries`' `timers` input end to end, only the
  // synthetic feed the test above exercises against the pure derivation.
  // Skipped per that explicit instruction, not left out.
  it.skip('shows a completed timer surfaced by the real Spec B.3 store (skipped: Spec B.3 is not merged — no timer store exists yet to drive this end to end)', () => {
    // Intentionally empty — see skip reason above.
  })

  it('includes a grocery pointer when the B.5 count is present and positive', () => {
    const result = deriveInboxEntries(
      {
        pantryItems: [],
        recipes: [{ last_cooked_at: NOW.toISOString() }],
        groceryCount: 5,
      },
      NOW,
    )
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].kind).toBe('grocery')
    expect(result.entries[0].copy).toContain('5')
    expect(result.entries[0].href).toBe('/grocery')
  })

  it('caps entries at INBOX_CAP and reports the overflow count', () => {
    const items = Array.from({ length: 15 }, (_, i) =>
      pantryItem({
        id: `item-${i}`,
        name: `Item ${i}`,
        expiry_date: '2026-09-20',
        days_until_expiry: -(i + 1),
        is_expired: true,
      }),
    )

    const result = deriveInboxEntries(
      { pantryItems: items, recipes: [{ last_cooked_at: NOW.toISOString() }] },
      NOW,
    )

    expect(result.entries).toHaveLength(INBOX_CAP)
    expect(result.totalCount).toBe(15)
    expect(result.overflowCount).toBe(5)
    // Most overdue (largest negative days_until_expiry) leads.
    expect(result.entries[0].id).toBe('expired:item-14')
  })
})
