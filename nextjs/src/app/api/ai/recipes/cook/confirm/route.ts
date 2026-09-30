import { NextResponse } from 'next/server'
import { aiProxyJson } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { validateClientDate } from '@/lib/date'
import { cookAwardRefs, readExpiryByItemId, rescueCandidates, awardCookBubbles } from '@/lib/cook-awards'

export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const [supabase, user] = auth

  const body = await request.json()

  // Client's local date (#524) — same clock-skew tolerance as GET /api/bubbles.
  // Only used to key the `rescue` award's eligibility judgement; a missing or
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
  const expiryByItemId = await readExpiryByItemId(supabase, user.id, pantryItemIds)

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
    const refs = cookAwardRefs({ kind: 'recipe', recipeId: body.recipe_id ?? null }, today)

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
    //
    // Rows the confirm itself refused to deduct (`deductions_skipped`, #671)
    // never left the pantry, so they haven't been rescued from anything —
    // same exclusion as the meal proxy. Read a clone: the caller (confirmCook)
    // parses `deductions_skipped` from the very body we return untouched.
    const data = await response.clone().json().catch(() => ({}))
    const rawSkipped = (data as { deductions_skipped?: unknown } | null)?.deductions_skipped
    const skipped = Array.isArray(rawSkipped)
      ? rawSkipped.filter((id): id is string => typeof id === 'string')
      : []

    const rescueIds = validDate
      ? rescueCandidates(pantryItemIds, expiryByItemId, validDate, skipped)
      : []

    await awardCookBubbles(user.id, refs, rescueIds)
  }

  return response
}
