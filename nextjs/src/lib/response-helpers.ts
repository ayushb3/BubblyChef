import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import type { SupabaseClient, User } from '@supabase/supabase-js'

/**
 * Get authenticated user from Supabase session.
 * Returns [supabase, user] or a 401 NextResponse.
 */
export async function requireAuth(): Promise<
  [SupabaseClient, User] | NextResponse
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return [supabase, user]
}

export function errorResponse(message: string, status: number = 500) {
  return NextResponse.json({ error: message }, { status })
}

export function notFound(entity: string = 'Resource') {
  return NextResponse.json({ error: `${entity} not found` }, { status: 404 })
}
