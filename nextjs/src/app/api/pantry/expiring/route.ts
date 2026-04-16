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

  const futureDate = new Date()
  futureDate.setDate(futureDate.getDate() + days)
  const futureDateStr = futureDate.toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('pantry_items')
    .select('*')
    .eq('user_id', user.id)
    .not('expiry_date', 'is', null)
    .lte('expiry_date', futureDateStr)
    .order('expiry_date')

  if (error) return errorResponse(error.message)

  const items = (data as PantryItemRow[]).map(enrichPantryItem)
  return NextResponse.json({ items, count: items.length })
}
