import { createHash } from 'crypto'
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
  estimated_expiry?: boolean
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
        // #363/#398/#439: same precedence as the single-item POST route —
        // when the client didn't supply a date, this route guessed one, so
        // the flag is always true regardless of what the client sent (a
        // blank-date row from the Type tab defaults its flag to `false`,
        // which must not override a real guess). The client's flag is only
        // honoured when the client actually supplied a date: true means
        // catalog auto-fill, false means the user typed it themselves.
        estimated_expiry: item.expiry_date ? Boolean(item.estimated_expiry) : Boolean(expiry),
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

  // scan_confirm's ref_key must not come from client input — a hand-rolled
  // POST could otherwise supply a fresh id on every call and farm the award
  // indefinitely. Instead it's derived entirely from server-known state: the
  // server's UTC date plus the (sorted, lowercased, trimmed) set of item
  // names being confirmed, hashed to stay well under the 200-char ref_key
  // limit (see the CHECK constraint in
  // supabase/migrations/00011_gamification_bubbles_ledger.sql). That makes
  // confirming the same set of items on the same day earn the award once —
  // re-POSTing the identical payload (a real network retry, or a replay
  // attempt) earns nothing, and it doesn't require trusting anything the
  // client sent.
  const hasScanItem = items.some((item) => item.source === 'scan')
  if (hasScanItem) {
    const utcDate = new Date().toISOString().slice(0, 10)
    const nameSet = items
      .map((item) => item.name.toLowerCase().trim())
      .sort()
      .join(',')
    const digest = createHash('sha256').update(nameSet).digest('hex')
    await awardBubbles(user.id, 'scan_confirm', `${utcDate}:${digest}`)
  }

  const enriched = insertedRows.map(enrichPantryItem)
  return NextResponse.json({ items: enriched, count: enriched.length }, { status: 201 })
}
