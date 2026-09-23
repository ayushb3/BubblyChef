/**
 * "Wasted" pantry items — issue #524 (weekly streak) and #525 (reused here,
 * per that issue's own spec).
 *
 * Waste is exactly two things (@ayushb3's call on the #524/#570 review —
 * an *interaction* with an item, like deleting it or resolving it as used,
 * never counts against the streak on its own):
 *  - a `pantry_events` row with `outcome = 'tossed'` — the user explicitly
 *    said they threw it out via the resolve flow, dated by `created_at`.
 *  - a `pantry_items` row still sitting in the pantry whose `expiry_date`
 *    has passed while `quantity` is still > 0 — nobody ever resolved it,
 *    dated by `expiry_date`.
 *
 * Notably NOT waste: deleting an item (`DELETE /api/pantry/[id]` — an
 * interaction, records nothing), or resolving an already-expired item as
 * `used`/`cooked` (`days_until_expiry` on that event can be negative; the
 * outcome the user chose, not the snapshot, decides waste).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { utcTimestampToLocalDate } from '@/lib/date'

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
  /**
   * The client's UTC offset in minutes (see `utcTimestampToLocalDate`).
   * Defaults to 0 (UTC) so any caller that hasn't been updated to pass it
   * keeps the old UTC-bucketing behavior instead of breaking.
   */
  offsetMinutes = 0,
): Promise<WastedItem[]> {
  // The client's local "today", not the server's UTC date — otherwise an
  // item that's expired-but-not-yet-crossed-midnight-UTC for a client west
  // of UTC is silently excluded from "wasted" a day later than it should be
  // (issue #524 review).
  const today = utcTimestampToLocalDate(new Date().toISOString(), offsetMinutes)

  const [{ data: wasteEvents }, { data: expiredItems }] = await Promise.all([
    supabase
      .from('pantry_events')
      .select('item_name, created_at, outcome')
      .eq('user_id', userId)
      .gte('created_at', sinceDate)
      .eq('outcome', 'tossed'),
    supabase
      .from('pantry_items')
      .select('name, expiry_date, quantity')
      .eq('user_id', userId)
      .gt('quantity', 0)
      .gte('expiry_date', sinceDate)
      .lt('expiry_date', today),
  ])

  const wasted: WastedItem[] = []
  // Every row here is already outcome = 'tossed' (filtered in the query
  // above), so reason is always 'tossed' — not derived per-row.
  for (const row of (wasteEvents ?? []) as Array<{ item_name: string; created_at: string }>) {
    wasted.push({
      reason: 'tossed',
      // Client-local date of the resolve action, not the raw UTC timestamp
      // date (issue #524 review) — matches the bucketing used for
      // bubble_events in `lib/streak-settlement.ts`.
      date: utcTimestampToLocalDate(row.created_at, offsetMinutes),
      itemName: row.item_name,
    })
  }
  for (const row of (expiredItems ?? []) as Array<{ name: string; expiry_date: string }>) {
    wasted.push({ reason: 'expired', date: row.expiry_date, itemName: row.name })
  }
  return wasted
}
