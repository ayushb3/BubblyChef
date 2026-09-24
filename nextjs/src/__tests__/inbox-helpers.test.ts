/**
 * Unit tests for the notification-center derivation (#496, Spec B.4).
 * Covers the acceptance criteria directly: tiering, ordering, the cap, and
 * the empty case.
 */
import { deriveInboxEntries, INBOX_CAP, EXPIRY_WINDOW_DAYS } from '@/lib/inbox-helpers'
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

  it('dedupes a row that is both expired and out of stock, keeping the more urgent tier', () => {
    // Ordinary end state once the cook flow deducts the last of something
    // that was already expired: the row qualifies for both `expired:` and
    // `low_stock:`. It must collapse to a single entry — the more urgent
    // one (`expired`, tier 'urgent' beats low-stock's 'warning') — not
    // double-count in the badge or take two of the ten capped slots.
    const expiredAndEmpty = pantryItem({
      id: 'both-1',
      name: 'Old Yogurt',
      quantity: 0,
      expiry_date: '2026-09-20',
      days_until_expiry: -3,
      is_expired: true,
    })
    const result = deriveInboxEntries(
      { pantryItems: [expiredAndEmpty], recipes: [{ last_cooked_at: NOW.toISOString() }] },
      NOW,
    )
    expect(result.entries).toHaveLength(1)
    expect(result.entries[0].kind).toBe('expired')
    expect(result.entries[0].id).toBe('expired:both-1')
    expect(result.totalCount).toBe(1)
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

  it('orders a completed timer first, ahead of expired/low-stock/cook-nudge', () => {
    // Real end-to-end coverage of this now lives in `notification-bell.test.tsx`
    // (#619: `useInboxEntries` reads the real `useCookingTimers` store).
    // This pins the pure-derivation ordering: a completed timer is
    // time-critical (food is on the heat) and ranks ahead of everything
    // else, including an already-expired pantry row (#496 review — see
    // `SORT_BUCKET` in `inbox-helpers.ts`).
    const result = deriveInboxEntries(
      {
        pantryItems: [
          pantryItem({ id: 'out', name: 'Eggs', quantity: 0 }),
          pantryItem({
            id: 'expired-1',
            name: 'Old Milk',
            expiry_date: '2026-09-20',
            days_until_expiry: -3,
            is_expired: true,
          }),
        ],
        recipes: [{ last_cooked_at: '2026-09-01T00:00:00Z' }],
        timers: [{ id: 't1', label: 'Pasta' }],
      },
      NOW,
    )

    expect(result.entries.map((e) => e.kind)).toEqual([
      'timer',
      'expired',
      'low_stock',
      'cook_nudge',
    ])
    expect(result.entries[0].href).toBeNull()
    expect(result.entries[0].copy).toBe('Pasta timer finished')
  })

  it('never lets a completed timer be starved past the cap by expiring rows', () => {
    // #496 review: the sort was global-by-sortKey-then-cap, so any account
    // with >= INBOX_CAP rows in the expiry window pushed a completed timer
    // (and the cook nudge, and the grocery pointer) entirely past the cap —
    // a timer could complete, the badge could tick up, and the dropdown
    // would never actually show it. Timers rank first (see `SORT_BUCKET`),
    // so this must hold regardless of how many expiring rows exist.
    const expiringRows = Array.from({ length: 12 }, (_, i) =>
      pantryItem({
        id: `expiring-${i}`,
        name: `Item ${i}`,
        expiry_date: '2026-09-25',
        days_until_expiry: i % (EXPIRY_WINDOW_DAYS + 1), // 0..3, all within the window
      }),
    )

    const result = deriveInboxEntries(
      {
        pantryItems: expiringRows,
        recipes: [{ last_cooked_at: NOW.toISOString() }],
        timers: [{ id: 't1', label: 'Soup' }],
      },
      NOW,
    )

    expect(result.totalCount).toBe(13)
    expect(result.entries).toHaveLength(INBOX_CAP)
    expect(result.entries.map((e) => e.kind)).toContain('timer')
    expect(result.entries[0].kind).toBe('timer')
    expect(result.overflowCount).toBe(3)
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
