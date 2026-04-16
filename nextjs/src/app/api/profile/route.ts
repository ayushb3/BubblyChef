import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'

export async function POST(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const body = await request.json()

  const { data, error } = await supabase
    .from('user_profiles')
    .insert({
      user_id: user.id,
      username: body.username,
      email: body.email || user.email,
      display_name: body.display_name,
      avatar_url: body.avatar_url,
      dietary_preferences: body.dietary_preferences || [],
    })
    .select()
    .single()

  if (error) return errorResponse(error.message)

  return NextResponse.json(data, { status: 201 })
}
