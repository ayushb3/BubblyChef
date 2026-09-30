import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { awardBubbles } from '@/lib/bubbles'
import { resolveLedgerDate } from '@/lib/ledger-date'
import { settleWeeklyStreak } from '@/lib/streak-settlement'

export async function GET(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { searchParams } = new URL(request.url)

  // The ONE accepted local date (#550): the server's clock in the account's
  // stored time zone. `tz` (if sent) can only propose a zone the first time
  // or move it after the cooldown; no per-request `date` or UTC offset from
  // the client is ever used as a key, so tomorrow can't be claimed today and
  // a spoofed offset can't shift anything. `null` (no zone known yet, e.g. a
  // stale tab that sends no `tz`) just means no date-keyed award this call.
  const ledger = await resolveLedgerDate(user, searchParams.get('tz'))

  // `date` is optional and only ever CHECKED, never used: a caller that does
  // send one must have sent the account's local date — tomorrow's and
  // yesterday's are refused, there is no ±1 window.
  const date = searchParams.get('date')
  if (ledger && date !== null && date !== ledger.date) {
    return errorResponse('date must be the account\'s current local date (YYYY-MM-DD)', 400)
  }

  let streakWeeks = 0
  let wastedThisWeek = false

  if (ledger) {
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
    //
    // Both the reference date and the offset come from the stored zone (#550),
    // so a client can't pass a future `date` to bank a week that hasn't ended.
    const settled = await settleWeeklyStreak(supabase, user.id, ledger.date, ledger.offsetMinutes)
    streakWeeks = settled.streakWeeks
    wastedThisWeek = settled.wastedThisWeek

    // Award (or no-op if already awarded today) only once settlement has
    // actually run — see above.
    if (settled.ok) {
      await awardBubbles(user.id, 'daily_visit', ledger.date)
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
