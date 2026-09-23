import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import { enrichPantryItem } from '@/lib/pantry-helpers'
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
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  // Deliberately does not record a `tossed` pantry_event (#524/#570 review,
  // decided by @ayushb3): deleting an item straight from the pantry is an
  // interaction, not an outcome — the user isn't telling the app "I wasted
  // this", they're just removing a row. Waste, for the weekly streak, is
  // only ever a resolve with outcome `tossed` (resolve/route.ts) or an item
  // still sitting in the pantry with quantity > 0 past its expiry_date at
  // settlement time (lib/waste.ts) — never a delete.
  const { error } = await supabase
    .from('pantry_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)

  if (error) return errorResponse(error.message)

  return NextResponse.json({ deleted: true })
}
