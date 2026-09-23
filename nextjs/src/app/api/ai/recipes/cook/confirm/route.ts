import { NextResponse } from 'next/server'
import { aiProxyJson } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { awardBubbles, RESCUE_CAP_PER_COOK } from '@/lib/bubbles'
import { validateClientDate } from '@/lib/date'
import { isExpiringSoon, daysUntilExpiryOn } from '@/lib/pantry-helpers'

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

  if (response.status >= 200 && response.status < 300) {
    // Pre-existing award (predates #524) — unconditional on `recipe_id`, not
    // on whether the client sent a usable `date`. A client with stale JS
    // that never sends `date` at all must still get this. Keyed by the
    // *server's* UTC date, same as before #524, so a client can't mint a
    // second `cook_confirm` for one cook by sending yesterday's date on one
    // request and today's on the next — only the new rescue bonus below is
    // allowed to depend on `validDate`.
    const today = new Date().toISOString().slice(0, 10)
    if (body.recipe_id) {
      await awardBubbles(user.id, 'cook_confirm', `${body.recipe_id}:${today}`)
    }

    // Rescue bonus (#524): only after the microservice confirms the cook
    // (2xx), one per expiring-soon deducted item, deduplicated and capped.
    // The *judgement* (was this item expiring soon at cook time) uses the
    // client's local date — that's the whole point of validDate, a user
    // near local midnight must not get misclassified by the server's UTC
    // clock. But the ref_key that makes the award idempotent uses the
    // *server's* date, same as cook_confirm above (#570 review): validDate
    // is client-supplied and validateClientDate tolerates ±1 day of skew,
    // so a client resending the same cook confirm with yesterday's date on
    // one call and today's on the next would otherwise mint two rescue
    // awards for what's really one deduction of the same item.
    if (validDate) {
      const expiringSoonItemIds = Array.from(new Set(pantryItemIds)).filter((id) =>
        isExpiringSoon(daysUntilExpiryOn(expiryByItemId.get(id) ?? null, validDate)),
      )
      for (const pantryItemId of expiringSoonItemIds.slice(0, RESCUE_CAP_PER_COOK)) {
        await awardBubbles(user.id, 'rescue', `${pantryItemId}:${today}`)
      }
    }
  }

  return response
}
