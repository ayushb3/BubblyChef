import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { enrichPantryItem, buildPantryListResponse } from '@/lib/pantry-helpers'
import { estimateExpiry, estimateCategory, normalizeBaseUnit } from '@/lib/api/ai-proxy'
import { awardBubbles } from '@/lib/bubbles'
import type { PantryItemRow } from '@/lib/pantry-helpers'

export async function GET(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { searchParams } = new URL(request.url)
  const category = searchParams.get('category')
  const storage = searchParams.get('storage')
  const search = searchParams.get('search')

  let query = supabase
    .from('pantry_items')
    .select('*')
    .eq('user_id', user.id)

  if (category) query = query.eq('category', category)
  if (storage) query = query.eq('location', storage)
  if (search) query = query.or(`name.ilike.%${search}%,name_normalized.ilike.%${search}%`)

  query = query.order('name')

  const { data, error } = await query

  if (error) return errorResponse(error.message)

  const items = (data as PantryItemRow[]).map(enrichPantryItem)
  return NextResponse.json(buildPantryListResponse(items))
}

export async function POST(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const body = await request.json()

  // Resolve category: use the supplied value, else ask the catalog, else 'other'
  // (#159 — same Python catalog as the AI ingest paths; best-effort, never blocks).
  const category =
    body.category || (await estimateCategory(body.name as string)) || 'other'

  // Estimate an expiry when the user didn't supply one (#158) — same Python
  // heuristic as the AI paths, via the AI service. Falls back to null on error.
  const expiry =
    body.expiry_date ||
    (await estimateExpiry({
      name: body.name,
      category,
      location: body.storage_location || body.location,
    }))

  // Derive base unit at write time so cook-flow deduction works immediately
  // on new rows (#224). Best-effort: leaves columns NULL when conversion is
  // not possible (e.g. "1 bag baby spinach") rather than blocking the add.
  const qty = body.quantity ?? 1.0
  const unit = body.unit || 'item'
  const { quantity_base, unit_base } = await normalizeBaseUnit({
    name: body.name,
    quantity: qty,
    unit,
    category,
  })

  const { data, error } = await supabase
    .from('pantry_items')
    .insert({
      user_id: user.id,
      name: body.name,
      name_normalized: (body.name as string).toLowerCase().trim(),
      category,
      location: body.storage_location || body.location || 'pantry',
      quantity: qty,
      unit,
      expiry_date: expiry || null,
      // #363/#398/#439: when the client didn't supply a date, this route
      // guessed one itself, so the flag is always true regardless of what
      // the client sent (a blank-date row defaults its flag to `false`,
      // which must not override a real guess). The client's flag is only
      // honoured when the client actually supplied a date: true means
      // catalog auto-fill (#398), false means the user typed it themselves.
      estimated_expiry: body.expiry_date ? Boolean(body.estimated_expiry) : Boolean(expiry),
      slot_index: body.slot_index ?? null,
      quantity_base: quantity_base ?? null,
      unit_base: unit_base ?? null,
    })
    .select()
    .single()

  if (error) return errorResponse(error.message)

  await awardBubbles(user.id, 'pantry_add', data.id)

  return NextResponse.json(enrichPantryItem(data as PantryItemRow), { status: 201 })
}
