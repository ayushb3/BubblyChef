/**
 * Lazy weekly rescue-streak settlement — issue #524.
 *
 * Called from `GET /api/bubbles` on every visit. Reads the last ~12 weeks of
 * this user's `bubble_events` (both to know which weeks already had
 * activity and which weeks were already settled) plus their waste for the
 * same window, runs it through the pure `computeStreak`, and awards any
 * newly-clean completed weeks via `awardBubbles`. Never throws — a failed
 * settlement must not block the balance the rest of the route returns.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { awardBubbles } from '@/lib/bubbles'
import { isoWeekKey, computeStreak } from '@/lib/streak'
import { wastedItemsSince } from '@/lib/waste'
import { addDaysToDateString } from '@/lib/date'

const MAX_WEEKS = 12

export interface StreakSettlementResult {
  streakWeeks: number
  wastedThisWeek: boolean
}

export async function settleWeeklyStreak(
  supabase: SupabaseClient,
  userId: string,
  today: string,
): Promise<StreakSettlementResult> {
  try {
    // + 1 week of slack so the current (in-progress) week's own events/waste
    // are visible too, for the `wastedThisWeek` flag below.
    const sinceDate = addDaysToDateString(today, -(MAX_WEEKS + 1) * 7)

    const [{ data: events }, wasted] = await Promise.all([
      supabase
        .from('bubble_events')
        .select('event_type, ref_key, created_at')
        .eq('user_id', userId)
        .gte('created_at', sinceDate),
      wastedItemsSince(supabase, userId, sinceDate),
    ])

    const activeWeekKeys = new Set<string>()
    const settledWeekKeys = new Set<string>()
    for (const row of (events ?? []) as Array<{
      event_type: string
      ref_key: string
      created_at: string
    }>) {
      activeWeekKeys.add(isoWeekKey(String(row.created_at).slice(0, 10)))
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
