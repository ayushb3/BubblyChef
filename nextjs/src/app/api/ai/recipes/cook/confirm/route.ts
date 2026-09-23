import { NextResponse } from 'next/server'
import { aiProxyJson } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { awardBubbles, RESCUE_CAP_PER_COOK } from '@/lib/bubbles'
import { validateClientDate } from '@/lib/date'
import { daysUntilExpiry, isExpiringSoon } from '@/lib/pantry-helpers'

export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const [supabase, user] = auth

  const body = await request.json()

  // Client's local date (#524) — same clock-skew tolerance as GET /api/bubbles.
  // Only used to key the `cook_confirm`/`rescue` awards; a missing or
  // out-of-range date must never block the cook deduction itself, matching
  // the never-block contract every other award call site follows (see
  // bubbles-award-call-sites.test.ts).
  const validDate = validateClientDate(body.date, 'date') ? null : (body.date as string)

  const deductions = Array.isArray(body.deductions) ? body.deductions : []
  const pantryItemIds: string[] = deductions
    .map((d: { pantry_item_id?: unknown }) => d?.pantry_item_id)
    .filter((id: unknown): id is string => typeof id === 'string')

  // Read expiry_date up front, before forwarding — the pantry row may well
  // be gone by the time the microservice's own deduction finishes, and the
  // rescue award needs "was this expiring soon at cook time", not whatever
  // is left afterward.
  let expiryByItemId = new Map<string, string | null>()
  if (pantryItemIds.length > 0) {
    const { data: rows } = await supabase
      .from('pantry_items')
      .select('id, expiry_date')
      .eq('user_id', user.id)
      .in('id', pantryItemIds)
    expiryByItemId = new Map(
      (rows ?? []).map((row: { id: string; expiry_date: string | null }) => [row.id, row.expiry_date]),
    )
  }

  const response = await aiProxyJson('/v1/recipes/cook/confirm', body)

  if (response.status >= 200 && response.status < 300 && validDate) {
    if (body.recipe_id) {
      await awardBubbles(user.id, 'cook_confirm', `${body.recipe_id}:${validDate}`)
    }

    // Rescue bonus (#524): only after the microservice confirms the cook
    // (2xx), one per expiring-soon deducted item, deduplicated and capped.
    const expiringSoonItemIds = Array.from(new Set(pantryItemIds)).filter((id) =>
      isExpiringSoon(daysUntilExpiry(expiryByItemId.get(id) ?? null)),
    )
    for (const pantryItemId of expiringSoonItemIds.slice(0, RESCUE_CAP_PER_COOK)) {
      await awardBubbles(user.id, 'rescue', `${pantryItemId}:${validDate}`)
    }
  }

  return response
}
