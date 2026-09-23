/**
 * "Wasted" pantry items — issue #524 (weekly streak) and #525 (reused here,
 * per that issue's own spec).
 *
 * Waste is: an item whose expiry passed while quantity > 0. Two sources
 * surface that:
 *  - a `pantry_events` row where either `outcome = 'tossed'` (the user
 *    explicitly said they threw it out) OR the snapshotted
 *    `days_until_expiry` was already negative at resolve time — resolving an
 *    already-expired item as `used`/`cooked` doesn't launder it, dated by
 *    `created_at`.
 *  - a `pantry_items` row still sitting in the pantry whose `expiry_date`
 *    has passed while `quantity` is still > 0 — nobody ever resolved it,
 *    dated by `expiry_date`.
 *
 * `DELETE /api/pantry/[id]` writes its own `pantry_events` row (outcome
 * `tossed`) when the item being deleted was already expired, specifically so
 * deleting a spoiled item can't quietly clear waste the same way resolving
 * it can't — see that route.
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
      .select('item_name, created_at, outcome, days_until_expiry')
      .eq('user_id', userId)
      .gte('created_at', sinceDate)
      // Either the user said "tossed" outright, or the item was already
      // expired (negative days_until_expiry) whatever outcome it was
      // resolved with — an already-spoiled item resolved as "used" is still
      // waste, it just wasn't labelled that way by the user (see module doc).
      .or('outcome.eq.tossed,days_until_expiry.lt.0'),
    supabase
      .from('pantry_items')
      .select('name, expiry_date, quantity')
      .eq('user_id', userId)
      .gt('quantity', 0)
      .gte('expiry_date', sinceDate)
      .lt('expiry_date', today),
  ])

  const wasted: WastedItem[] = []
  for (const row of (wasteEvents ?? []) as Array<{
    item_name: string
    created_at: string
    outcome?: string
    days_until_expiry?: number | null
  }>) {
    wasted.push({
      reason: row.outcome === 'tossed' ? 'tossed' : 'expired',
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
