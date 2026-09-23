import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { awardBubbles, mostRecentEventCreatedAt, isRateLimited } from '@/lib/bubbles'
import { parseTzOffsetMinutes } from '@/lib/date'
import { settleWeeklyStreak } from '@/lib/streak-settlement'

export async function GET(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  // `date` only needs to be WELL-FORMED here, not "correct" — it becomes the
  // `daily_visit` ref_key (which the weekly streak lock reads back as this
  // user's own visit history) and buckets waste/activity into calendar
  // weeks, but it is NOT a security boundary. Issue #550/#595 review: an
  // earlier version of this fix required `date` to exactly match
  // `tz_offset_minutes`-shifted server time and 400'd otherwise — but
  // `tz_offset_minutes` is client-supplied, so that "exact match" was exact
  // only relative to a number the caller chose; a fabricated offset makes
  // any date "the" accepted one. This is also a READ endpoint (the award is
  // a side effect of fetching the balance), so it must degrade rather than
  // 400 when the client's clock is off. The actual anti-abuse boundary is
  // the 20h cooldown below, measured by the server's own `created_at` —
  // that holds regardless of what date/offset the client sends.
  if (!date || typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse('date query param is required (YYYY-MM-DD)', 400)
  }
  // Client's UTC offset in minutes (issue #524 review) — used only to bucket
  // `created_at` timestamps into the client's local calendar day rather than
  // the server's UTC day for the weekly streak's waste/activity windows.
  // Missing/unparseable falls back to UTC. Not a security boundary either —
  // see above.
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
    date,
    offsetMinutes,
  )

  // Award (or skip) only once settlement has actually run — see above. The
  // 20h cooldown (#550/#595 review) is what actually stops a `daily_visit`
  // being claimed more than once in a stretch of real time no matter what
  // date/offset a client sends: at most one award per ~20h, full stop.
  if (ok) {
    const lastVisitCreatedAt = await mostRecentEventCreatedAt(supabase, user.id, 'daily_visit')
    if (!isRateLimited(lastVisitCreatedAt)) {
      await awardBubbles(user.id, 'daily_visit', date)
    }
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
