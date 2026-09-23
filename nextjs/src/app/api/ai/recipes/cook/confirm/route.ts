import { NextResponse } from 'next/server'
import { aiProxyJson } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { awardBubbles } from '@/lib/bubbles'

export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const [, user] = auth

  const body = await request.json()
  const response = await aiProxyJson('/v1/recipes/cook/confirm', body)

  if (response.status >= 200 && response.status < 300 && body.recipe_id) {
    const today = new Date().toISOString().slice(0, 10)
    await awardBubbles(user.id, 'cook_confirm', `${body.recipe_id}:${today}`)
  }

  return response
}
