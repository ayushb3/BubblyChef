/**
 * Weekly rescue streak — pure helpers (issue #524).
 *
 * No I/O here on purpose: `lib/streak-settlement.ts` does the Supabase reads
 * and calls into this module with plain data, so the interesting logic (which
 * weeks are clean, which to award, what the current streak is) is unit
 * testable without mocking a database.
 *
 * Weeks are ISO 8601 weeks (Monday-Sunday, week 1 contains the year's first
 * Thursday), keyed as `YYYY-Www` (e.g. `2026-W39`) — that's also the
 * `ref_key` convention for the `weekly_streak` bubble_events row (see
 * `supabase/migrations/00011_gamification_bubbles_ledger.sql`).
 */

import { addDaysToDateString } from '@/lib/date'

function parseDateParts(dateStr: string): { y: number; m: number; d: number } {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr)
  if (!match) throw new Error(`isoWeekKey: invalid date "${dateStr}"`)
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) }
}

/** The ISO 8601 week key (`YYYY-Www`) containing `dateStr` (YYYY-MM-DD). */
export function isoWeekKey(dateStr: string): string {
  const { y, m, d } = parseDateParts(dateStr)
  // Shift to the Thursday of this date's week (ISO weeks are identified by
  // the year their Thursday falls in), operating in UTC so this can't drift
  // with the host's timezone.
  const date = new Date(Date.UTC(y, m - 1, d))
  const isoDayOfWeek = date.getUTCDay() || 7 // Mon=1 .. Sun=7
  date.setUTCDate(date.getUTCDate() + 4 - isoDayOfWeek)

  const isoYear = date.getUTCFullYear()
  const yearStart = new Date(Date.UTC(isoYear, 0, 1))
  const weekNo = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7)

  return `${isoYear}-W${String(weekNo).padStart(2, '0')}`
}

/** The Monday..Sunday local date range (inclusive) for an ISO week key like `2026-W39`. */
export function weekRange(weekKey: string): { start: string; end: string } {
  const match = /^(\d{4})-W(\d{2})$/.exec(weekKey)
  if (!match) throw new Error(`weekRange: invalid week key "${weekKey}"`)
  const isoYear = Number(match[1])
  const week = Number(match[2])

  // Monday of ISO week 1 is Jan 4 minus (Jan 4's ISO weekday - 1) days.
  const jan4 = new Date(Date.UTC(isoYear, 0, 4))
  const jan4IsoDay = jan4.getUTCDay() || 7
  const week1Monday = new Date(jan4)
  week1Monday.setUTCDate(jan4.getUTCDate() - (jan4IsoDay - 1))

  const monday = new Date(week1Monday)
  monday.setUTCDate(week1Monday.getUTCDate() + (week - 1) * 7)
  const sunday = new Date(monday)
  sunday.setUTCDate(monday.getUTCDate() + 6)

  return { start: monday.toISOString().slice(0, 10), end: sunday.toISOString().slice(0, 10) }
}

export interface ComputeStreakInput {
  /** Today, as the client's local YYYY-MM-DD. Only completed weeks (before this week) are ever judged or awarded. */
  referenceDate: string
  /**
   * Week keys that already have a `weekly_streak` bubble_events row — never
   * re-awarded (idempotent). Should be the caller's FULL history of settled
   * weeks, not windowed to `maxWeeksToCheck`: `currentStreak` below walks
   * back past that window, so a windowed set would falsely cap the
   * reported streak at `maxWeeksToCheck` (issue #524 review).
   */
  settledWeekKeys: string[]
  /** Week keys with at least one bubble_event of any type — an idle week can never be clean. Only needs to cover the catch-up window (`maxWeeksToCheck` + 1). */
  activeWeekKeys: string[]
  /** Week keys with any waste (a tossed resolve, or an item that expired with quantity still > 0). Only needs to cover the catch-up window. */
  wastedWeekKeys: string[]
  /** How many completed weeks back to catch up on new awards. Default 12 — far enough to catch a returning user, bounded so one call can't walk forever. Does NOT bound `currentStreak`. */
  maxWeeksToCheck?: number
  /**
   * The local date (YYYY-MM-DD) of the caller's own previous visit — i.e.
   * the last time settlement ran for this user — or `null`/`undefined` on a
   * user's first-ever visit. A completed week is judged EXACTLY ONCE, at the
   * first settlement that runs after it completes (issue #524/#570): any
   * week that had already ended by this date was necessarily inside that
   * prior settlement's own catch-up window (same `maxWeeksToCheck`, an
   * earlier `referenceDate`), so it was judged then — whether that judgment
   * landed in `settledWeekKeys` (clean, awarded) or not (wasted, or idle).
   * Only weeks that ended AFTER this date are eligible to be judged now.
   * `null`/`undefined` (no previous visit) imposes no filter — every
   * completed week in the catch-up window is a first judgment.
   */
  previousVisitDate?: string | null
}

export interface ComputeStreakResult {
  /** Newly-clean, not-yet-settled completed weeks to award, oldest first. */
  weeksToAward: string[]
  /** Consecutive clean+awarded weeks walking back from the most recent completed week; breaks at the first idle, wasted, or missing week. */
  currentStreak: number
}

/**
 * Decide which completed weeks earn a `weekly_streak` award and what the
 * resulting streak length is.
 *
 * A week is "clean" only when it had at least one bubble_event (so an idle
 * account can't farm the streak by doing nothing) AND no waste. Only
 * completed weeks are considered — the current, still-in-progress week is
 * never judged or awarded. Catch-up: every completed week since the last
 * settled one is judged independently (bounded by `maxWeeksToCheck`), so a
 * user who was clean in week N and then idle for a few weeks still gets
 * credit for week N when they come back.
 */
export function computeStreak(input: ComputeStreakInput): ComputeStreakResult {
  const maxWeeks = input.maxWeeksToCheck ?? 12
  const settled = new Set(input.settledWeekKeys)
  const active = new Set(input.activeWeekKeys)
  const wasted = new Set(input.wastedWeekKeys)

  // Walk backward from the most recent COMPLETED week (the week before the
  // one containing referenceDate) to maxWeeks weeks before that.
  const completedWeeks: string[] = []
  const seen = new Set<string>()
  let cursor = input.referenceDate
  while (completedWeeks.length < maxWeeks) {
    cursor = addDaysToDateString(cursor, -7)
    const wk = isoWeekKey(cursor)
    if (!seen.has(wk)) {
      seen.add(wk)
      completedWeeks.push(wk)
    }
  }
  // completedWeeks is now ordered most-recent-completed -> oldest.

  const weeksToAward: string[] = []
  for (const wk of completedWeeks) {
    if (settled.has(wk)) continue
    // Already judged at a prior settlement — even if that judgment was
    // "wasted" (never landed in `settled`). Re-checking live state (e.g.
    // an expired item since deleted from the pantry) would flip an already
    // -judged wasted week to clean and pay it retroactively (issue
    // #524/#570). A week is judged exactly once, at the first settlement
    // after it completes. Strictly `<`, not `<=`: a visit ON a week's
    // Sunday happens while that week is still in progress (it doesn't end
    // until midnight), so that visit never judged it — `<=` here locked
    // every week out the moment its own last day's visit landed (re-review
    // #4 on issue #524/#570).
    if (input.previousVisitDate != null && weekRange(wk).end < input.previousVisitDate) continue
    if (active.has(wk) && !wasted.has(wk)) {
      weeksToAward.push(wk)
    }
  }

  const awardedOrSettled = new Set([...settled, ...weeksToAward])

  // Count the current streak by walking back from the most recent completed
  // week, with no cap other than a large safety bound (not `maxWeeksToCheck`
  // — that only bounds catch-up awarding). Membership in `awardedOrSettled`
  // alone is sufficient: a week only ever lands in `settled` or
  // `weeksToAward` after already being verified clean (active + not
  // wasted), so weeks outside the `active`/`wasted` windows (i.e. older than
  // `maxWeeksToCheck`) can still correctly continue the streak as long as
  // they were previously settled (issue #524 review: this used to also
  // require `active.has(wk) && !wasted.has(wk)`, which silently broke the
  // streak at the edge of the windowed data even for already-settled weeks).
  const STREAK_COUNT_SAFETY_BOUND = 1560 // ~30 years of weeks
  let currentStreak = 0
  let cursorForCount = input.referenceDate
  for (let i = 0; i < STREAK_COUNT_SAFETY_BOUND; i++) {
    cursorForCount = addDaysToDateString(cursorForCount, -7)
    const wk = isoWeekKey(cursorForCount)
    if (awardedOrSettled.has(wk)) {
      currentStreak++
    } else {
      break
    }
  }

  return { weeksToAward: weeksToAward.reverse(), currentStreak }
}
