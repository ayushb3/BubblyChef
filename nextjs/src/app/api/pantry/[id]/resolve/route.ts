import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import { daysUntilExpiry } from '@/lib/pantry-helpers'

const VALID_OUTCOMES = ['used', 'tossed'] as const
type ResolveOutcome = (typeof VALID_OUTCOMES)[number]

function isValidOutcome(value: unknown): value is ResolveOutcome {
  return typeof value === 'string' && (VALID_OUTCOMES as readonly string[]).includes(value)
}

/**
 * Resolve an expiring pantry item: record what happened to it (used it up /
 * tossed it) and remove it from the pantry. Issue #140.
 *
 * `pantry_events` is append-only (INSERT/SELECT only, no UPDATE/DELETE — see
 * migration 00007), so the event is written first and the item is deleted
 * second. If the delete fails after the event is recorded, we do not retry
 * or roll back the event (the table has no delete policy to undo it with) —
 * we surface a 500 so the caller knows the item is still in the pantry
 * despite the event existing, rather than reporting success for a resolve
 * that didn't actually clear the item.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const body = await request.json().catch(() => null)
  const outcome = (body as { outcome?: unknown } | null)?.outcome

  if (!isValidOutcome(outcome)) {
    return errorResponse('outcome must be "used" or "tossed"', 400)
  }

  const { data: item, error: fetchError } = await supabase
    .from('pantry_items')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (fetchError || !item) return notFound('Pantry item')

  const { data: event, error: insertError } = await supabase
    .from('pantry_events')
    .insert({
      user_id: user.id,
      pantry_item_id: item.id,
      item_name: item.name,
      outcome,
      quantity: item.quantity,
      unit: item.unit,
      days_until_expiry: daysUntilExpiry(item.expiry_date),
    })
    .select()
    .single()

  if (insertError || !event) {
    return errorResponse('Failed to record the resolve event', 500)
  }

  const { error: deleteError } = await supabase
    .from('pantry_items')
    .delete()
    .eq('id', item.id)
    .eq('user_id', user.id)

  if (deleteError) {
    // The event is already written; the item is still in the pantry. Don't
    // report success — that would leave a resolved event for an item a user
    // can still see sitting there.
    return errorResponse('Recorded the event but failed to remove the item from the pantry', 500)
  }

  return NextResponse.json({
    resolved: true,
    id: item.id,
    outcome,
    event_id: event.id,
  })
}
