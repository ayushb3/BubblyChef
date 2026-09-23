/**
 * Lazy weekly rescue-streak settlement — issue #524.
 *
 * Called from `GET /api/bubbles` on every visit. Reads the last ~12 weeks of
 * this user's `bubble_events` (to know which weeks already had activity)
 * plus their waste for the same window, plus the user's FULL (unbounded)
 * history of already-settled `weekly_streak` weeks (so a streak longer than
 * the catch-up window still counts correctly — issue #524 review), runs it
 * through the pure `computeStreak`, and awards any newly-clean completed
 * weeks via `awardBubbles`. Never throws — a failed settlement must not
 * block the balance the rest of the route returns.
 *
 * `offsetMinutes` is the client's UTC offset (see
 * `utcTimestampToLocalDate` in `lib/date.ts`) — every `created_at` timestamp
 * read here is bucketed into the client's local calendar day, not the raw
 * UTC day, so a Sunday-evening-local event for a client west of UTC doesn't
 * silently land in Monday's week (issue #524 review).
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { awardBubbles } from '@/lib/bubbles'
import { isoWeekKey, computeStreak } from '@/lib/streak'
import { wastedItemsSince } from '@/lib/waste'
import { addDaysToDateString, utcTimestampToLocalDate } from '@/lib/date'

const MAX_WEEKS = 12

export interface StreakSettlementResult {
  streakWeeks: number
  wastedThisWeek: boolean
}

export async function settleWeeklyStreak(
  supabase: SupabaseClient,
  userId: string,
  today: string,
  offsetMinutes = 0,
): Promise<StreakSettlementResult> {
  try {
    // + 1 week of slack so the current (in-progress) week's own events/waste
    // are visible too, for the `wastedThisWeek` flag below.
    const sinceDate = addDaysToDateString(today, -(MAX_WEEKS + 1) * 7)

    const [{ data: events }, { data: settledEvents }, wasted] = await Promise.all([
      supabase
        .from('bubble_events')
        .select('event_type, created_at')
        .eq('user_id', userId)
        .gte('created_at', sinceDate),
      // Unbounded on purpose — see module doc. One row per settled week per
      // user, so this stays cheap indefinitely.
      supabase
        .from('bubble_events')
        .select('event_type, ref_key')
        .eq('user_id', userId)
        .eq('event_type', 'weekly_streak'),
      wastedItemsSince(supabase, userId, sinceDate, offsetMinutes),
    ])

    const activeWeekKeys = new Set<string>()
    for (const row of (events ?? []) as Array<{ event_type: string; created_at: string }>) {
      activeWeekKeys.add(isoWeekKey(utcTimestampToLocalDate(row.created_at, offsetMinutes)))
    }

    const settledWeekKeys = new Set<string>()
    for (const row of (settledEvents ?? []) as Array<{ event_type: string; ref_key: string }>) {
      if (row.event_type === 'weekly_streak') settledWeekKeys.add(row.ref_key)
    }

    const wastedWeekKeys = new Set(wasted.map((w) => isoWeekKey(w.date)))

    const { weeksToAward, currentStreak } = computeStreak({
      referenceDate: today,
      settledWeekKeys: Array.from(settledWeekKeys),
      activeWeekKeys: Array.from(activeWeekKeys),
      wastedWeekKeys: Array.from(wastedWeekKeys),
      maxWeeksToCheck: MAX_WEEKS,
    })

    for (const weekKey of weeksToAward) {
      await awardBubbles(userId, 'weekly_streak', weekKey)
    }

    const currentWeekKey = isoWeekKey(today)
    const wastedThisWeek = wastedWeekKeys.has(currentWeekKey)

    return { streakWeeks: currentStreak, wastedThisWeek }
  } catch (err) {
    console.error('[streak] settlement failed: %s', err)
    return { streakWeeks: 0, wastedThisWeek: false }
  }
}
