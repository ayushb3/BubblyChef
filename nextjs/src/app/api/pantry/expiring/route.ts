import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { enrichPantryItem } from '@/lib/pantry-helpers'
import type { PantryItemRow } from '@/lib/pantry-helpers'

export async function GET(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { searchParams } = new URL(request.url)
  const days = parseInt(searchParams.get('days') || '3', 10)

  // Both bounds matter. `expiry_date <= today + days` alone also matches food
  // that expired weeks ago, which made this endpoint report 31 "expiring" items
  // on a pantry with only 2 genuinely expiring in the window (#239). Expired
  // stock is a different problem with a different remedy (toss / used it up),
  // so it is excluded here rather than relabelled.
  const localDateStr = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

  const todayStr = localDateStr(new Date())
  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + days)
  const futureDateStr = localDateStr(futureDate)

  const { data, error } = await supabase
    .from('pantry_items')
    .select('*')
    .eq('user_id', user.id)
    .not('expiry_date', 'is', null)
    .gte('expiry_date', todayStr)
    .lte('expiry_date', futureDateStr)
    .order('expiry_date')

  if (error) return errorResponse(error.message)

  const items = (data as PantryItemRow[]).map(enrichPantryItem)
  return NextResponse.json({ items, count: items.length })
}
