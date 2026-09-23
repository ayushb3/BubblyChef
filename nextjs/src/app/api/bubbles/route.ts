import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { awardBubbles } from '@/lib/bubbles'
import { validateClientDate, parseTzOffsetMinutes } from '@/lib/date'
import { settleWeeklyStreak } from '@/lib/streak-settlement'

export async function GET(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const dateError = validateClientDate(date, 'date query param')
  if (dateError) return errorResponse(dateError, 400)
  // Narrowed by validateClientDate above.
  const validDate = date as string
  // Client's UTC offset in minutes (issue #524 review) — used to bucket
  // `created_at` timestamps into the client's local calendar day rather
  // than the server's UTC day. Missing/unparseable falls back to UTC.
  const offsetMinutes = parseTzOffsetMinutes(searchParams.get('tz_offset_minutes'))

  // Weekly rescue streak (#524): lazily settle any completed week since the
  // last one that was awarded, bounded to ~12 weeks of catch-up, and report
  // the resulting streak length + whether the current (in-progress) week has
  // already seen waste. Settle BEFORE awarding today's `daily_visit`
  // (re-review #4 on issue #524/#570) — that award is what marks "today's
  // visit happened" for the NEXT call's `previousVisitDate` lookup, so if
  // settlement fails, the visit must not be recorded either: doing so would
  // permanently lock out every week that failed settlement would have
  // judged. On failure this route falls through with no visit award; since
  // `GET /api/bubbles` runs on nearly every page, the next request the same
  // day simply retries both.
  const { streakWeeks, wastedThisWeek, ok } = await settleWeeklyStreak(
    supabase,
    user.id,
    validDate,
    offsetMinutes,
  )

  // Award (or no-op if already awarded today) only once settlement has
  // actually run — see above.
  if (ok) {
    await awardBubbles(user.id, 'daily_visit', validDate)
  }

  const [{ data: balanceRow }, { data: recent }] = await Promise.all([
    supabase.from('bubble_balances').select('balance').eq('user_id', user.id).maybeSingle(),
    supabase
      .from('bubble_events')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10),
  ])

  return NextResponse.json({
    balance: balanceRow?.balance ?? 0,
    recent: recent ?? [],
    streak_weeks: streakWeeks,
    wasted_this_week: wastedThisWeek,
  })
}
