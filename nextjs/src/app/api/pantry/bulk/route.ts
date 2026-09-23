import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { enrichPantryItem } from '@/lib/pantry-helpers'
import { estimateExpiry, estimateCategory, normalizeBaseUnit } from '@/lib/api/ai-proxy'
import { awardBubbles } from '@/lib/bubbles'
import type { PantryItemRow } from '@/lib/pantry-helpers'

interface BulkItemInput {
  name: string
  quantity?: number
  unit?: string
  category?: string
  storage_location?: string
  expiry_date?: string | null
  source?: 'scan' | 'manual'
}

export async function POST(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const body = await request.json()
  const items: BulkItemInput[] = body.items
  const requestId: string | undefined = body.request_id

  if (!Array.isArray(items) || items.length === 0) {
    return errorResponse('items must be a non-empty array', 400)
  }

  // Fill in category and expiry for items the user left at defaults (#177, #158).
  // Also derive base units at write time (#224).
  // All three come from the AI service's Python catalog/heuristic (single source of
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

      const qty = item.quantity ?? 1.0
      const unit = item.unit || 'item'
      const { quantity_base, unit_base } = await normalizeBaseUnit({
        name: item.name,
        quantity: qty,
        unit,
        category,
      })

      return {
        user_id: user.id,
        name: item.name,
        name_normalized: item.name.toLowerCase().trim(),
        category,
        location: item.storage_location || 'pantry',
        quantity: qty,
        unit,
        expiry_date: expiry || null,
        slot_index: null,
        quantity_base: quantity_base ?? null,
        unit_base: unit_base ?? null,
      }
    }),
  )

  const { data, error } = await supabase
    .from('pantry_items')
    .insert(rows)
    .select()

  if (error) return errorResponse(error.message)

  const insertedRows = data as PantryItemRow[]
  await Promise.all(insertedRows.map((row) => awardBubbles(user.id, 'pantry_add', row.id)))

  // scan_confirm is awarded once per confirm click, keyed on the client's
  // per-request id (not per item), so re-confirming the same items twice
  // never double-counts the scan award.
  const hasScanItem = items.some((item) => item.source === 'scan')
  if (hasScanItem && requestId) {
    await awardBubbles(user.id, 'scan_confirm', requestId)
  }

  const enriched = insertedRows.map(enrichPantryItem)
  return NextResponse.json({ items: enriched, count: enriched.length }, { status: 201 })
}
