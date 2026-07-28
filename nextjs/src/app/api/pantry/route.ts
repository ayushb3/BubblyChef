import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { enrichPantryItem, buildPantryListResponse } from '@/lib/pantry-helpers'
import { estimateExpiry, estimateCategory } from '@/lib/api/ai-proxy'
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

  const { data, error } = await supabase
    .from('pantry_items')
    .insert({
      user_id: user.id,
      name: body.name,
      name_normalized: (body.name as string).toLowerCase().trim(),
      category,
      location: body.storage_location || body.location || 'pantry',
      quantity: body.quantity || 1.0,
      unit: body.unit || 'item',
      expiry_date: expiry || null,
      slot_index: body.slot_index ?? null,
    })
    .select()
    .single()

  if (error) return errorResponse(error.message)

  return NextResponse.json(enrichPantryItem(data as PantryItemRow), { status: 201 })
}
