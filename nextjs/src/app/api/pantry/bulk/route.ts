import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { enrichPantryItem } from '@/lib/pantry-helpers'
import type { PantryItemRow } from '@/lib/pantry-helpers'

interface BulkItemInput {
  name: string
  quantity?: number
  unit?: string
  category?: string
  storage_location?: string
  expiry_date?: string | null
}

export async function POST(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const body = await request.json()
  const items: BulkItemInput[] = body.items

  if (!Array.isArray(items) || items.length === 0) {
    return errorResponse('items must be a non-empty array', 400)
  }

  const rows = items.map((item) => ({
    user_id: user.id,
    name: item.name,
    name_normalized: item.name.toLowerCase().trim(),
    category: item.category || 'other',
    location: item.storage_location || 'pantry',
    quantity: item.quantity ?? 1.0,
    unit: item.unit || 'item',
    expiry_date: item.expiry_date || null,
    slot_index: null,
  }))

  const { data, error } = await supabase
    .from('pantry_items')
    .insert(rows)
    .select()

  if (error) return errorResponse(error.message)

  const enriched = (data as PantryItemRow[]).map(enrichPantryItem)
  return NextResponse.json({ items: enriched, count: enriched.length }, { status: 201 })
}
