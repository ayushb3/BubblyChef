import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { pendingMilestones } from '@/lib/kitchen/milestones'
import { offerFor } from '@/lib/kitchen/offer'
import { CATALOG } from '@/lib/kitchen/catalog'

/**
 * GET /api/kitchen/offer (issue #522)
 *
 * Returns the "pick 1 of 3" offer for the oldest pending milestone that
 * still has at least one eligible decoration, walking pending milestones
 * oldest-first and falling through past any milestone whose offer is empty
 * (every catalog entry for it already unlocked or slot-occupied) — see the
 * decision recorded in the issue: fall through rather than sticking, since
 * a milestone whose offer is empty never frees up on its own. Returns
 * `null` when no pending milestone has anything to offer.
 */
export async function GET() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const [
    { data: balanceRow, error: balanceError },
    { data: decorations, error: decorationsError },
  ] = await Promise.all([
    supabase.from('bubble_balances').select('balance').eq('user_id', user.id).maybeSingle(),
    supabase.from('decorations').select('name, decoration_type, milestone').eq('user_id', user.id),
  ])

  if (balanceError) return errorResponse(balanceError.message)
  if (decorationsError) return errorResponse(decorationsError.message)

  const balance = balanceRow?.balance ?? 0
  const rows = decorations ?? []
  const claimedKeys = rows.map((row) => row.milestone).filter((m): m is string => Boolean(m))
  const unlockedIds = rows.map((row) => row.name)

  const pending = pendingMilestones(balance, claimedKeys)

  for (const milestone of pending) {
    const options = offerFor(user.id, milestone.key, CATALOG, unlockedIds)
    if (options.length > 0) {
      return NextResponse.json({
        milestone_key: milestone.key,
        threshold: milestone.threshold,
        options,
      })
    }
  }

  return NextResponse.json(null)
}
