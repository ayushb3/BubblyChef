import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { awardBubbles } from '@/lib/bubbles'

export async function GET(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  if (!date) return errorResponse('date query param is required (YYYY-MM-DD, client local date)', 400)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return errorResponse('date query param must be YYYY-MM-DD', 400)
  }

  // The client sends its own local date, which can be up to a day off from
  // the server's UTC date depending on timezone (UTC-14..UTC+14 spans a full
  // calendar day either side). Anything further off than that is not a real
  // client clock skew case — reject it so a signed-in user can't loop
  // ?date=1, ?date=2, ... and mint unlimited daily_visit awards.
  const parsedDate = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(parsedDate.getTime())) {
    return errorResponse('date query param must be a valid date', 400)
  }
  const msPerDay = 24 * 60 * 60 * 1000
  const serverToday = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  const dayDiff = Math.abs(parsedDate.getTime() - serverToday.getTime()) / msPerDay
  if (dayDiff > 1) {
    return errorResponse('date query param is too far from the server date', 400)
  }

  // Award (or no-op if already awarded today) before reading the balance so
  // the response reflects today's visit.
  await awardBubbles(user.id, 'daily_visit', date)

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
  })
}
