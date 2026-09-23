import { NextResponse } from 'next/server'
import { aiProxyJson } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { awardBubbles, RESCUE_CAP_PER_COOK } from '@/lib/bubbles'
import { validateClientDate, parseTzOffsetMinutes } from '@/lib/date'
import { isExpiringSoon, daysUntilExpiryOn } from '@/lib/pantry-helpers'

export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const [supabase, user] = auth

  const body = await request.json()

  // Client's local date (#524), validated EXACTLY against the offset-derived
  // local date (#550 — see `validateClientDate`; no more ±1 day tolerance).
  // Used to key the `cook_confirm`/`rescue` awards below; a missing or
  // invalid date/offset must never block the cook deduction itself, matching
  // the never-block contract every other award call site follows (see
  // bubbles-award-call-sites.test.ts) — it only means `cook_confirm` falls
  // back to the server's UTC date and `rescue` is skipped, below.
  const offsetMinutes = parseTzOffsetMinutes(body.tz_offset_minutes)
  const validDate = validateClientDate(body.date, offsetMinutes, 'date')
    ? null
    : (body.date as string)

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
    // that never sends `date` at all must still get this.
    //
    // Keying (#550): the ref_key is `validDate` — the single client-local
    // date the server just validated exactly against the offset — when one
    // was supplied, so the same recipe cooked at 23:50 and 00:10 UTC on the
    // same local day pays once, closing the UTC-midnight double pay this
    // issue was filed for. When there's no usable `validDate` (missing or
    // invalid date/offset), this falls back to the *server's* UTC date
    // rather than skipping the award — cook_confirm must never be blocked
    // by a bad/absent date, and a stale client's cook still needs to get
    // paid somehow. This fallback key can't be gamed into a second award:
    // `validateClientDate` now requires an EXACT match against the
    // offset-derived local date (no more ±1 day tolerance from #520/#524),
    // so a client can no longer mint a second `cook_confirm` by sending
    // yesterday's date on one request and today's on the next — an invalid
    // date just falls back to this same server-UTC key both times.
    const serverToday = new Date().toISOString().slice(0, 10)
    const cookConfirmKey = validDate ?? serverToday
    if (body.recipe_id) {
      await awardBubbles(user.id, 'cook_confirm', `${body.recipe_id}:${cookConfirmKey}`)
    }

    // Rescue bonus (#524): only after the microservice confirms the cook
    // (2xx), one per expiring-soon deducted item, deduplicated and capped.
    // Both the *judgement* (was this item expiring soon at cook time) and
    // the ref_key (#550: agree with `cook_confirm` above, and with
    // `daily_visit`'s key on `GET /api/bubbles`) use `validDate` — the
    // client's exactly-validated local date. Skipped entirely (not
    // server-UTC-keyed, unlike cook_confirm) when there's no usable
    // `validDate`, since a wrongly-classified rescue is worse than a missed
    // one and the eligibility judgement itself needs a real local date.
    if (validDate) {
      const expiringSoonItemIds = Array.from(new Set(pantryItemIds)).filter((id) =>
        isExpiringSoon(daysUntilExpiryOn(expiryByItemId.get(id) ?? null, validDate)),
      )
      for (const pantryItemId of expiringSoonItemIds.slice(0, RESCUE_CAP_PER_COOK)) {
        await awardBubbles(user.id, 'rescue', `${pantryItemId}:${validDate}`)
      }
    }
  }

  return response
}
