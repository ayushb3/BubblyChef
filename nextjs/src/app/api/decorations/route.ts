import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'

export async function GET() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { data, error } = await supabase
    .from('decorations')
    .select('*')
    .eq('user_id', user.id)
    .order('name')

  if (error) return errorResponse(error.message)

  return NextResponse.json({
    decorations: data,
    total: data?.length || 0,
  })
}
