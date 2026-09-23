import { NextResponse } from 'next/server'
import { createClient as createServiceClient } from '@supabase/supabase-js'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { DECORATION_MILESTONES, reachedMilestones } from '@/lib/kitchen/milestones'
import { offerFor } from '@/lib/kitchen/offer'
import { CATALOG } from '@/lib/kitchen/catalog'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

const MILESTONE_KEYS = new Set(DECORATION_MILESTONES.map((m) => m.key))

/**
 * POST /api/kitchen/unlock (issue #522)
 *
 * Body: `{ milestone_key: string, decoration_id: string }`.
 *
 * Writes with the service-role client, matching `lib/bubbles.ts` and
 * `app/api/recipes/route.ts` — migration 00011 revoked client INSERT on
 * `decorations`, so `supabase` (the session client from `requireAuth`) can
 * only read it.
 *
 * Checks, in order:
 *   1. `milestone_key` is one of `DECORATION_MILESTONES` (400 otherwise)
 *   2. the user's balance has actually reached that milestone (400 otherwise)
 *   3. the milestone hasn't already been claimed (409 — a row with that
 *      `milestone` already exists for this user)
 *   4. `decoration_id` is one of the three the milestone would currently
 *      offer, recomputed here rather than trusted from the client (400 if
 *      not — covers a stale or tampered offer)
 *
 * A `23505` unique-violation on the insert (the two-tap/two-device race the
 * partial unique index on `(user_id, milestone)` guards against) is also
 * mapped to 409.
 *
 * `unlocked_at` is stamped with the claim time on insert — the column has
 * no DB default, so leaving it unset would make the timestamp unrecoverable
 * after the fact even though nothing reads it today.
 */
export async function POST(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  let body: { milestone_key?: unknown; decoration_id?: unknown }
  try {
    body = await request.json()
  } catch {
    return errorResponse('Request body must be JSON', 400)
  }

  const { milestone_key: milestoneKey, decoration_id: decorationId } = body
  if (typeof milestoneKey !== 'string' || typeof decorationId !== 'string') {
    return errorResponse('milestone_key and decoration_id are required strings', 400)
  }

  if (!MILESTONE_KEYS.has(milestoneKey)) {
    return errorResponse(`Unknown milestone_key: ${milestoneKey}`, 400)
  }

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

  const reached = reachedMilestones(balance).some((m) => m.key === milestoneKey)
  if (!reached) {
    return errorResponse(`Balance ${balance} has not reached milestone ${milestoneKey}`, 400)
  }

  const alreadyClaimed = rows.some((row) => row.milestone === milestoneKey)
  if (alreadyClaimed) {
    return errorResponse(`Milestone ${milestoneKey} has already been claimed`, 409)
  }

  const unlockedIds = rows.map((row) => row.name)
  const offered = offerFor(user.id, milestoneKey, CATALOG, unlockedIds)
  const chosen = offered.find((entry) => entry.id === decorationId)
  if (!chosen) {
    return errorResponse(`${decorationId} was not offered for milestone ${milestoneKey}`, 400)
  }

  const sb = createServiceClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data, error } = await sb
    .from('decorations')
    .insert({
      user_id: user.id,
      name: chosen.id,
      decoration_type: chosen.slot,
      milestone: milestoneKey,
      unlocked_at: new Date().toISOString(),
    })
    .select()
    .single()

  if (error) {
    if (error.code === '23505') {
      return errorResponse(`Milestone ${milestoneKey} has already been claimed`, 409)
    }
    return errorResponse(error.message)
  }

  return NextResponse.json(data, { status: 201 })
}
