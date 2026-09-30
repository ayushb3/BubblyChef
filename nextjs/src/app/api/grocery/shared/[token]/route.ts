import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { formatGroceryShareText, isValidShareToken } from '@/lib/grocery-helpers'
import type { GroceryItem, SharedGroceryResponse } from '@/types/grocery'

/**
 * `GET /api/grocery/shared/[token]` — the read-only view of a shared list
 * (issue #497). Public on purpose: a signed-out friend holding the link can
 * open it, so there is no `requireAuth()` here.
 *
 * It reaches the data only through the `get_shared_grocery_list(p_token)`
 * database function, which returns just name / quantity / unit / category of
 * the UNCHECKED lines for an exact token match. The caller gets no table access
 * and no ids, and there is no write counterpart.
 *
 * An unknown, revoked or malformed token answers exactly like an empty list
 * (200, no items) so the endpoint can't be used to probe which tokens exist.
 */
const EMPTY: SharedGroceryResponse = { items: [], text: '' }
const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params
  if (!isValidShareToken(token)) return NextResponse.json(EMPTY, { headers: HEADERS })

  const supabase = await createClient()
  const { data, error } = await supabase.rpc('get_shared_grocery_list', { p_token: token })
  if (error) return NextResponse.json({ error: 'Failed to load the list' }, { status: 500, headers: HEADERS })

  const rows = (data ?? []) as Array<Pick<GroceryItem, 'name' | 'quantity' | 'unit' | 'category'>>
  const items = rows.map((r) => ({
    name: r.name,
    quantity: r.quantity === null || r.quantity === undefined ? null : Number(r.quantity),
    unit: r.unit ?? null,
    category: r.category ?? 'other',
  }))
  const text = formatGroceryShareText(
    items.map((i, n) => ({
      ...i,
      id: String(n),
      source: 'manual' as const,
      source_ref: null,
      checked: false,
      checked_at: null,
    }))
  )

  return NextResponse.json({ items, text } satisfies SharedGroceryResponse, { headers: HEADERS })
}
