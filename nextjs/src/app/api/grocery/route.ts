import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { ITEM_COLUMNS, findList, toItem } from '@/lib/grocery-server'
import type { GroceryListResponse } from '@/types/grocery'

/**
 * `GET /api/grocery` — the caller's grocery list and its lines (issue #497).
 *
 * `list` is null until the user first adds a line, regenerates, or shares;
 * that is an empty list, not an error. Regenerating lives in the AI service
 * (`POST /v1/grocery/regenerate`, proxied at `/api/ai/grocery/regenerate`).
 */
export async function GET() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  try {
    const list = await findList(supabase, user.id)
    if (!list) return NextResponse.json({ list: null, items: [] } satisfies GroceryListResponse)

    const { data, error } = await supabase
      .from('grocery_items')
      .select(ITEM_COLUMNS)
      .eq('user_id', user.id)
      .eq('list_id', list.id)
      .order('category')
      .order('name')
    if (error) return errorResponse(error.message)

    return NextResponse.json({
      list,
      items: (data ?? []).map((row) => toItem(row as Record<string, unknown>)),
    } satisfies GroceryListResponse)
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Failed to load the grocery list')
  }
}
