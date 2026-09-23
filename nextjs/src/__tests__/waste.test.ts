/**
 * `wastedItemsSince` (issue #524/#525) — @ayushb3's call on the review:
 * waste is only ever an explicit `tossed` resolve or an item left sitting
 * in the pantry past its expiry with quantity > 0. Neither deleting an item
 * nor resolving an already-expired item as `used`/`cooked` counts, even
 * though the earlier PR round had both count.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { wastedItemsSince } from '@/lib/waste'

function makeSupabase(
  wasteEvents: Array<Record<string, unknown>>,
  expiredItems: Array<Record<string, unknown>>,
) {
  return {
    from: (table: string) => {
      if (table === 'pantry_events') {
        return {
          select: () => ({
            eq: () => ({
              gte: () => ({
                // Mimics the real query's `.eq('outcome', 'tossed')` filter
                // — a mock that ignored this and returned every row
                // regardless of outcome would pass even if the production
                // query stopped filtering.
                eq: async (_column: string, value: string) => ({
                  data: wasteEvents.filter((row) => row.outcome === value),
                  error: null,
                }),
              }),
            }),
          }),
        }
      }
      if (table === 'pantry_items') {
        return {
          select: () => ({
            eq: () => ({
              gt: () => ({
                gte: () => ({
                  lt: async () => ({ data: expiredItems, error: null }),
                }),
              }),
            }),
          }),
        }
      }
      throw new Error(`unexpected table ${table}`)
    },
  } as unknown as SupabaseClient
}

describe('wastedItemsSince', () => {
  it('counts an explicit tossed resolve as waste', async () => {
    const supabase = makeSupabase(
      [{ item_name: 'Spinach', created_at: '2026-09-20T12:00:00Z', outcome: 'tossed' }],
      [],
    )

    const wasted = await wastedItemsSince(supabase, 'user-1', '2026-09-14')

    expect(wasted).toEqual([{ reason: 'tossed', date: '2026-09-20', itemName: 'Spinach' }])
  })

  it('does not count resolving an already-expired item as used — the outcome the user chose decides waste, not the snapshot', async () => {
    // Same shape as a real "used" resolve on an expired item: the row's
    // days_until_expiry snapshot would be negative, but that column is no
    // longer even selected — the query itself only ever asks for
    // outcome = 'tossed'.
    const supabase = makeSupabase(
      [{ item_name: 'Spinach', created_at: '2026-09-20T12:00:00Z', outcome: 'used' }],
      [],
    )

    const wasted = await wastedItemsSince(supabase, 'user-1', '2026-09-14')

    expect(wasted).toEqual([])
  })

  it('does not count resolving an already-expired item as cooked', async () => {
    const supabase = makeSupabase(
      [{ item_name: 'Spinach', created_at: '2026-09-20T12:00:00Z', outcome: 'cooked' }],
      [],
    )

    const wasted = await wastedItemsSince(supabase, 'user-1', '2026-09-14')

    expect(wasted).toEqual([])
  })

  it('counts an item still sitting in the pantry past its expiry with quantity > 0', async () => {
    const supabase = makeSupabase([], [{ name: 'Yogurt', expiry_date: '2026-09-18', quantity: 1 }])

    const wasted = await wastedItemsSince(supabase, 'user-1', '2026-09-14')

    expect(wasted).toEqual([{ reason: 'expired', date: '2026-09-18', itemName: 'Yogurt' }])
  })

  it('combines both sources', async () => {
    const supabase = makeSupabase(
      [{ item_name: 'Spinach', created_at: '2026-09-20T12:00:00Z', outcome: 'tossed' }],
      [{ name: 'Yogurt', expiry_date: '2026-09-18', quantity: 1 }],
    )

    const wasted = await wastedItemsSince(supabase, 'user-1', '2026-09-14')

    expect(wasted).toHaveLength(2)
    expect(wasted).toContainEqual({ reason: 'tossed', date: '2026-09-20', itemName: 'Spinach' })
    expect(wasted).toContainEqual({ reason: 'expired', date: '2026-09-18', itemName: 'Yogurt' })
  })

  it('reports no waste when nothing was tossed and nothing is sitting expired', async () => {
    const supabase = makeSupabase([], [])

    const wasted = await wastedItemsSince(supabase, 'user-1', '2026-09-14')

    expect(wasted).toEqual([])
  })
})
