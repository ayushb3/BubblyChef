import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'
import { ITEM_COLUMNS, toItem } from '@/lib/grocery-server'
import { parseItemPatch, simpleFoodKey } from '@/lib/grocery-helpers'

/**
 * `PATCH /api/grocery/items/[id]` — check, uncheck, or edit one line (issue #497).
 *
 * Body: any of `{ checked, quantity, unit, name }`.
 *
 * - `checked: true` stamps `checked_at`; `false` clears it. Checking never
 *   changes why the line exists (`source`).
 * - Editing quantity, unit or name makes the line the user's own (`source:
 *   'manual'`): regenerate refreshes generated lines, so an edit on one would
 *   otherwise be silently overwritten on the next regenerate.
 * - A rename to a food already on the list is a 409.
 *
 * A line that isn't the caller's is a 404, the same as one that doesn't exist.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('Request body must be JSON', 400)
  }
  const parsed = parseItemPatch(body)
  if (parsed.error) return errorResponse(parsed.error, 400)
  const { patch } = parsed

  const update: Record<string, unknown> = {}
  if (patch.checked !== undefined) {
    update.checked = patch.checked
    update.checked_at = patch.checked ? new Date().toISOString() : null
  }
  if (patch.quantity !== undefined) update.quantity = patch.quantity
  if (patch.unit !== undefined) update.unit = patch.unit
  if (patch.name !== undefined) {
    update.name = patch.name
    update.name_key = simpleFoodKey(patch.name)
  }
  if ('quantity' in patch || 'unit' in patch || 'name' in patch) update.source = 'manual'

  const { data, error } = await supabase
    .from('grocery_items')
    .update(update)
    .eq('id', id)
    .eq('user_id', user.id)
    .select(ITEM_COLUMNS)
    .maybeSingle()

  if (error) {
    if (error.code === '23505') return errorResponse('That food is already on the list', 409)
    return errorResponse(error.message)
  }
  if (!data) return notFound('Grocery item')

  return NextResponse.json({ item: toItem(data as Record<string, unknown>) })
}

/** `DELETE /api/grocery/items/[id]` — remove one line. */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const { data, error } = await supabase
    .from('grocery_items')
    .delete()
    .eq('id', id)
    .eq('user_id', user.id)
    .select('id')
  if (error) return errorResponse(error.message)
  if (!data || data.length === 0) return notFound('Grocery item')

  return NextResponse.json({ id, deleted: true })
}
