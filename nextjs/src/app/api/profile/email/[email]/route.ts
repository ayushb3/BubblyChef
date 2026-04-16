import { NextResponse } from 'next/server'
import { requireAuth, notFound } from '@/lib/response-helpers'

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ email: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase] = result
  const { email } = await params

  const { data, error } = await supabase
    .from('user_profiles')
    .select('*')
    .eq('email', decodeURIComponent(email))
    .single()

  if (error || !data) return notFound('Profile')

  return NextResponse.json(data)
}
