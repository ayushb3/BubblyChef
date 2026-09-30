import { randomBytes } from 'crypto'
import { NextResponse } from 'next/server'
import { requireAuth, errorResponse } from '@/lib/response-helpers'
import { getOrCreateList } from '@/lib/grocery-server'

/**
 * `POST /api/grocery/share` — turn sharing on and return the read-only token
 * (issue #497). Repeating the call returns the same token; `{ "rotate": true }`
 * replaces it, which kills every link already handed out.
 *
 * The token is 192 random bits, URL-safe. Holding it lets anyone read the
 * list's UNCHECKED lines through `GET /api/grocery/shared/[token]` and nothing
 * else: no writes, no ids, no account details.
 */
export async function POST(request: Request) {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const body = (await request.json().catch(() => ({}))) as { rotate?: unknown } | null
  const rotate = body?.rotate === true

  try {
    const list = await getOrCreateList(supabase, user.id)
    if (list.share_token && !rotate) return NextResponse.json({ token: list.share_token })

    const token = randomBytes(24).toString('base64url')
    const { error } = await supabase
      .from('grocery_lists')
      .update({ share_token: token })
      .eq('id', list.id)
      .eq('user_id', user.id)
    if (error) return errorResponse(error.message)

    return NextResponse.json({ token })
  } catch (err) {
    return errorResponse(err instanceof Error ? err.message : 'Failed to share the list')
  }
}

/** `DELETE /api/grocery/share` — stop sharing; every link stops working. */
export async function DELETE() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const { error } = await supabase
    .from('grocery_lists')
    .update({ share_token: null })
    .eq('user_id', user.id)
  if (error) return errorResponse(error.message)

  return NextResponse.json({ shared: false })
}
