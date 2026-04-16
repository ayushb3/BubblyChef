import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'

export async function GET(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase] = result

  const { searchParams } = new URL(request.url)
  const query = searchParams.get('q') || ''
  const limit = parseInt(searchParams.get('limit') || '10', 10)

  if (!query || query.length < 2) {
    return NextResponse.json({ results: [] })
  }

  const { data, error } = await supabase
    .from('food_catalog')
    .select('*')
    .ilike('canonical', `%${query}%`)
    .limit(limit)

  if (error) return errorResponse(error.message)

  return NextResponse.json({ results: data || [] })
}
