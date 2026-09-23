import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import { validateClientDate } from '@/lib/date'
import { enrichPantryItem, daysUntilExpiry, daysUntilExpiryOn, isExpired } from '@/lib/pantry-helpers'
import type { PantryItemRow } from '@/lib/pantry-helpers'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const { data, error } = await supabase
    .from('pantry_items')
    .select('*')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  if (error || !data) return notFound('Pantry item')

  return NextResponse.json(enrichPantryItem(data as PantryItemRow))
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const body = await request.json()

  // Map storage_location → location for DB column name
  const updates: Record<string, unknown> = {}
  if (body.name !== undefined) {
    updates.name = body.name
    updates.name_normalized = (body.name as string).toLowerCase().trim()
  }
  if (body.category !== undefined) updates.category = body.category
  if (body.storage_location !== undefined) updates.location = body.storage_location
  if (body.location !== undefined) updates.location = body.location
  if (body.quantity !== undefined) updates.quantity = body.quantity
  if (body.unit !== undefined) updates.unit = body.unit
  if (body.expiry_date !== undefined) updates.expiry_date = body.expiry_date
  if (body.slot_index !== undefined) updates.slot_index = body.slot_index
  // A caller-supplied expiry_date is a real date, not a heuristic guess —
  // clear the estimated_expiry flag, regardless of what the row had before.
  // (#380). No client-settable override: nothing in this app's UI ever
  // needs to claim a date is "estimated" through this route, and adding
  // that surface would let a stray request quietly re-trigger the exact
  // bug this fix exists to close.
  if (body.expiry_date !== undefined) {
    updates.estimated_expiry = false
  }

  const { data, error } = await supabase
    .from('pantry_items')
    .update(updates)
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return errorResponse(error.message)
  if (!data) return notFound('Pantry item')

  return NextResponse.json(enrichPantryItem(data as PantryItemRow))
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  // Client's local date (#524 review), same optional/never-block convention
  // as `resolve/route.ts` and `GET /api/bubbles` — a missing or out-of-range
  // `date` query param just means the waste classification below falls back
  // to the server's UTC clock, never that the delete itself is blocked.
  const { searchParams } = new URL(request.url)
  const date = searchParams.get('date')
  const validDate = validateClientDate(date, 'date') ? null : date

  // Read the item first, purely to detect waste (#524 finding): deleting an
  // already-expired item straight from the pantry (still reachable from
  // `AddItemModal`) is one of the two ways a spoiled item could vanish
  // without ever recording waste — resolving it as `used` is the other, and
  // that one's handled in `resolve/route.ts`. A read failure here is not
  // fatal to the delete itself; it just means this particular deletion won't
  // be recorded as waste.
  const { data: item } = await supabase
    .from('pantry_items')
    .select('name, quantity, unit, expiry_date')
    .eq('id', id)
    .eq('user_id', user.id)
    .single()

  const { error } = await supabase
    .from('pantry_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return errorResponse(error.message)

  // Waste event is written AFTER the delete succeeds, and only then (#524
  // review): writing it first meant a failed delete still left a "tossed"
  // event behind for an item that's still sitting in the pantry. A failure
  // writing the event itself doesn't fail the response — the delete already
  // succeeded, and losing this one waste-streak data point is a much smaller
  // problem than telling the user their delete failed when it didn't.
  const itemDaysUntilExpiry = item
    ? validDate
      ? daysUntilExpiryOn(item.expiry_date, validDate)
      : daysUntilExpiry(item.expiry_date)
    : null

  if (item && isExpired(itemDaysUntilExpiry)) {
    const { error: eventError } = await supabase.from('pantry_events').insert({
      user_id: user.id,
      pantry_item_id: id,
      item_name: item.name,
      outcome: 'tossed',
      quantity: item.quantity,
      unit: item.unit,
      days_until_expiry: itemDaysUntilExpiry,
    })
    if (eventError) {
      console.error('Failed to record waste pantry_event after delete', eventError)
    }
  }

  return NextResponse.json({ deleted: true })
}
