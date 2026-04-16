import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { enrichPantryItem, buildPantryListResponse } from '@/lib/pantry-helpers'
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

  const { data, error } = await supabase
    .from('pantry_items')
    .insert({
      user_id: user.id,
      name: body.name,
      name_normalized: (body.name as string).toLowerCase().trim(),
      category: body.category || 'other',
      location: body.storage_location || body.location || 'pantry',
      quantity: body.quantity || 1.0,
      unit: body.unit || 'item',
      expiry_date: body.expiry_date || null,
      slot_index: body.slot_index ?? null,
    })
    .select()
    .single()

  if (error) return errorResponse(error.message)

  return NextResponse.json(enrichPantryItem(data as PantryItemRow), { status: 201 })
}
