import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import { daysUntilExpiry } from '@/lib/pantry-helpers'
import type { PantryItemRow } from '@/lib/pantry-helpers'

/** Outcomes the client may record. Must match the CHECK constraint on pantry_events. */
const OUTCOMES = ['used', 'tossed', 'cooked'] as const
type Outcome = (typeof OUTCOMES)[number]

function isOutcome(value: unknown): value is Outcome {
  return typeof value === 'string' && (OUTCOMES as readonly string[]).includes(value)
}

/**
 * POST /api/pantry/[id]/resolve — record what happened to an item and clear it.
 *
 * Body: `{ outcome: 'used' | 'tossed' | 'cooked' }`
 *
 * The event is written BEFORE the item is deleted, and a failed write aborts the
 * whole thing. There is no transaction across these two statements from here, so
 * the order is the safety property: writing the event second would mean a
 * mid-request failure silently deletes stock and records nothing, which is the
 * one outcome that makes the future "you saved N items" screen lie. Losing the
 * delete instead leaves the item visible and the user simply resolves it again.
 *
 * The event captures item_name, quantity, unit and days_until_expiry at the
 * moment of resolution, because the pantry_items row is about to disappear and
 * the event has to stay meaningful without it (#140).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Request body must be JSON', 400)
  }

  const outcome = (body as { outcome?: unknown } | null)?.outcome
  if (!isOutcome(outcome)) {
    return errorResponse(
      `outcome must be one of: ${OUTCOMES.join(', ')}`,
      400
    )
  }

  // Read the item first — both to confirm ownership and to snapshot the fields
  // the event needs before the row goes away.
  const { data: item, error: fetchError } = await supabase
    .from('pantry_items')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !item) return notFound('Pantry item')

  const row = item as PantryItemRow

  const { error: eventError } = await supabase.from('pantry_events').insert({
    user_id: user.id,
    pantry_item_id: row.id,
    item_name: row.name,
    outcome,
    quantity: row.quantity,
    unit: row.unit,
    days_until_expiry: daysUntilExpiry(row.expiry_date),
  })

  // Abort rather than delete: an unrecorded deletion is worse than no-op.
  if (eventError) return errorResponse(eventError.message)

  const { error: deleteError } = await supabase
    .from('pantry_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (deleteError) return errorResponse(deleteError.message)

  return NextResponse.json({
    id: row.id,
    name: row.name,
    outcome,
    resolved: true,
  })
}
