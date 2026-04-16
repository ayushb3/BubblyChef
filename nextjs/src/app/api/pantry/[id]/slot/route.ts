import { NextResponse } from 'next/server'
import { requireAuth, errorResponse, notFound } from '@/lib/response-helpers'

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result
  const { id } = await params

  const { searchParams } = new URL(request.url)
  const slotIndex = searchParams.get('slot_index')

  const { data, error } = await supabase
    .from('pantry_items')
    .update({ slot_index: slotIndex ? parseInt(slotIndex, 10) : null })
    .eq('id', id)
    .eq('user_id', user.id)
    .select()
    .single()

  if (error) return errorResponse(error.message)
  if (!data) return notFound('Pantry item')

  return NextResponse.json(data)
}
