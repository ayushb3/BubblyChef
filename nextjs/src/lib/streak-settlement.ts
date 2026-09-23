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
 *
 * Judge-once (issue #524/#570): waste is partly LIVE state (an expired item
 * still sitting in the pantry, see `lib/waste.ts`), so re-evaluating an
 * already-judged week on a later visit can flip it from wasted to clean once
 * the user deletes the offending item — paying out a week that was
 * correctly denied at the time. `computeStreak` is given `previousVisitDate`
 * (the local date of this user's own previous visit) and refuses to judge
 * any completed week that had already ended by then, regardless of whether
 * `settledWeekKeys` shows it as awarded — that prior settlement call
 * necessarily already considered it (same `MAX_WEEKS` catch-up window, an
 * earlier reference date). `previousVisitDate` is derived from the `events`
 * window already read below (no extra query): the latest `daily_visit`
 * local date strictly before today. `route.ts` calls this function BEFORE
 * awarding today's own `daily_visit` (re-review #4 on issue #524/#570) —
 * settling first and gating the visit award on `ok` means a transient
 * settlement failure never permanently locks out the weeks it would have
 * judged (a failed visit award just gets retried on the next request, since
 * this route runs on nearly every page). Because today's own visit hasn't
 * been written yet when this runs, the `< today` filter below is naturally
 * safe under either ordering.
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
  /**
   * `false` when settlement itself failed (a Supabase error, thrown or
   * returned) — the catch below already logs and returns a safe zeroed
   * result so the balance response is never blocked, but the caller
   * (`route.ts`) needs to know settlement did NOT actually run this visit,
   * so it must not award today's `daily_visit` (issue #524/#570 re-review
   * #4): that award is what marks "settlement ran today" for the NEXT
   * visit's `previousVisitDate` lookup, and a transient failure must not
   * permanently lock out every completed week it would have judged.
   */
  ok: boolean
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
    // The local date of this user's own previous visit (the last time this
    // function ran for them) — the latest `daily_visit` local date strictly
    // before today. `null` means no prior visit is visible in this window
    // (either a brand new user, or one who's been idle longer than the
    // window — either way every completed week in the catch-up window below
    // is a first judgment, so no filtering is needed; see `computeStreak`).
    let previousVisitDate: string | null = null
    for (const row of (events ?? []) as Array<{ event_type: string; created_at: string }>) {
      const localDate = utcTimestampToLocalDate(row.created_at, offsetMinutes)
      activeWeekKeys.add(isoWeekKey(localDate))
      if (
        row.event_type === 'daily_visit' &&
        localDate < today &&
        (previousVisitDate === null || localDate > previousVisitDate)
      ) {
        previousVisitDate = localDate
      }
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
      previousVisitDate,
    })

    for (const weekKey of weeksToAward) {
      await awardBubbles(userId, 'weekly_streak', weekKey)
    }

    const currentWeekKey = isoWeekKey(today)
    const wastedThisWeek = wastedWeekKeys.has(currentWeekKey)

    return { streakWeeks: currentStreak, wastedThisWeek, ok: true }
  } catch (err) {
    console.error('[streak] settlement failed: %s', err)
    return { streakWeeks: 0, wastedThisWeek: false, ok: false }
  }
}
