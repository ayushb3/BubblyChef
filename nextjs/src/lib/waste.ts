/**
 * "Wasted" pantry items — issue #524 (weekly streak) and #525 (reused here,
 * per that issue's own spec).
 *
 * Two sources count as waste:
 *  - a `pantry_events` row with `outcome = 'tossed'` (the user explicitly
 *    said they threw it out), dated by `created_at`.
 *  - a `pantry_items` row still sitting in the pantry whose `expiry_date`
 *    has passed while `quantity` is still > 0 — nobody ever resolved it,
 *    dated by `expiry_date`.
 *
 * `used`/`cooked` resolves are never waste, no matter how close to expiry.
 */

import type { SupabaseClient } from '@supabase/supabase-js'

export interface WastedItem {
  reason: 'tossed' | 'expired'
  /** YYYY-MM-DD — when the waste happened (tossed: resolve date; expired: the item's expiry date). */
  date: string
  itemName: string
}

/**
 * Items wasted on or after `sinceDate` (a YYYY-MM-DD local date), for the
 * given user. Uses the caller's own (RLS-scoped) Supabase client — this is a
 * read, not an award, so it doesn't need the service-role client.
 */
export async function wastedItemsSince(
  supabase: SupabaseClient,
  userId: string,
  sinceDate: string,
): Promise<WastedItem[]> {
  const today = new Date().toISOString().slice(0, 10)

  const [{ data: tossedEvents }, { data: expiredItems }] = await Promise.all([
    supabase
      .from('pantry_events')
      .select('item_name, created_at')
      .eq('user_id', userId)
      .eq('outcome', 'tossed')
      .gte('created_at', sinceDate),
    supabase
      .from('pantry_items')
      .select('name, expiry_date, quantity')
      .eq('user_id', userId)
      .gt('quantity', 0)
      .gte('expiry_date', sinceDate)
      .lt('expiry_date', today),
  ])

  const wasted: WastedItem[] = []
  for (const row of (tossedEvents ?? []) as Array<{ item_name: string; created_at: string }>) {
    wasted.push({ reason: 'tossed', date: String(row.created_at).slice(0, 10), itemName: row.item_name })
  }
  for (const row of (expiredItems ?? []) as Array<{ name: string; expiry_date: string }>) {
    wasted.push({ reason: 'expired', date: row.expiry_date, itemName: row.name })
  }
  return wasted
}
