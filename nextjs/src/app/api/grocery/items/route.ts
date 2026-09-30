import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { ITEM_COLUMNS, getOrCreateList, toItem } from '@/lib/grocery-server'
import { parseNewItems, simpleFoodKey } from '@/lib/grocery-helpers'

/**
 * `POST /api/grocery/items` — add lines by hand (issue #497).
 *
 * Body: `{ items: [{ name, quantity?, unit?, category? }] }` (1-50). Also the
 * entry point for "add these to my list" from elsewhere (a pantry item, a meal's
 * to-buy names): the client wraps it as `addGroceryItems(names: string[])`.
 *
 * One line per food: a name already on the list (by its plain lowercased key or
 * by the stored name) is adopted instead of duplicated. Adopting makes it a
 * manual line (regenerate never touches those) and un-checks it, because the
 * user just asked for it again. Returns 201 with the added or adopted lines.
 */
export async function POST(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Request body must be JSON', 400)
  }
  const parsed = parseNewItems(body)
  if (parsed.error) return errorResponse(parsed.error, 400)

  try {
    const list = await getOrCreateList(supabase, user.id)

    const { data: existingRows, error: readError } = await supabase
      .from('grocery_items')
      .select('id, name, name_key')
      .eq('user_id', user.id)
      .eq('list_id', list.id)
    if (readError) return errorResponse(readError.message)
    const byKey = new Map<string, string>()
    for (const row of existingRows ?? []) {
      byKey.set(String(row.name_key), String(row.id))
      byKey.set(simpleFoodKey(String(row.name)), String(row.id))
    }

    const touched: Record<string, unknown>[] = []
    const fresh = []
    for (const item of parsed.items) {
      const existingId = byKey.get(item.key)
      if (existingId) {
        const patch: Record<string, unknown> = { source: 'manual', checked: false, checked_at: null }
        if (item.quantity !== null) patch.quantity = item.quantity
        if (item.unit !== null) patch.unit = item.unit
        const { data, error } = await supabase
          .from('grocery_items')
          .update(patch)
          .eq('id', existingId)
          .eq('user_id', user.id)
          .select(ITEM_COLUMNS)
          .maybeSingle()
        if (error) return errorResponse(error.message)
        if (data) touched.push(data as Record<string, unknown>)
      } else {
        fresh.push({
          list_id: list.id,
          user_id: user.id,
          name: item.name,
          name_key: item.key,
          quantity: item.quantity,
          unit: item.unit,
          category: item.category,
          source: 'manual',
        })
      }
    }

    if (fresh.length > 0) {
      const { data, error } = await supabase
        .from('grocery_items')
        .insert(fresh)
        .select(ITEM_COLUMNS)
      if (error) {
        // A concurrent add of the same food hit the (list, food) unique key.
        if (error.code === '23505') return errorResponse('That food is already on the list', 409)
        return errorResponse(error.message)
      }
      touched.push(...((data ?? []) as Record<string, unknown>[]))
    }

    return NextResponse.json({ items: touched.map(toItem) }, { status: 201 })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Failed to add items')
  }
}

/**
 * `DELETE /api/grocery/items?checked=1` — clear the "got it" lines. The flag is
 * required so a bare collection DELETE can never wipe the list by accident.
 */
export async function DELETE(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  if (new URL(request.url).searchParams.get('checked') !== '1') {
    return errorResponse('Pass ?checked=1 to clear checked items', 400)
  }

  const { data, error } = await supabase
    .from('grocery_items')
    .delete()
    .eq('user_id', user.id)
    .eq('checked', true)
    .select('id')
  if (error) return errorResponse(error.message)

  return NextResponse.json({ deleted: (data ?? []).length })
}
