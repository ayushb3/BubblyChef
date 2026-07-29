import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { enrichPantryItem } from '@/lib/pantry-helpers'
import { estimateExpiry, estimateCategory } from '@/lib/api/ai-proxy'
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

  // Fill in category and expiry for items the user left at defaults (#177, #158).
  // Both come from the AI service's Python catalog/heuristic (single source of
  // truth); failures fall back to 'other'/null and never block the add.
  const rows = await Promise.all(
    items.map(async (item) => {
      const category =
        item.category && item.category !== 'other'
          ? item.category
          : (await estimateCategory(item.name)) || item.category || 'other'

      const expiry =
        item.expiry_date ||
        (await estimateExpiry({
          name: item.name,
          category,
          location: item.storage_location,
        }))
      return {
        user_id: user.id,
        name: item.name,
        name_normalized: item.name.toLowerCase().trim(),
        category,
        location: item.storage_location || 'pantry',
        quantity: item.quantity ?? 1.0,
        unit: item.unit || 'item',
        expiry_date: expiry || null,
        slot_index: null,
      }
    }),
  )

  const { data, error } = await supabase
    .from('pantry_items')
    .insert(rows)
    .select()

  if (error) return errorResponse(error.message)

  const enriched = (data as PantryItemRow[]).map(enrichPantryItem)
  return NextResponse.json({ items: enriched, count: enriched.length }, { status: 201 })
}
