import { NextResponse } from 'next/server'
import { aiProxyJson } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { awardBubbles, RESCUE_CAP_PER_COOK, mostRecentEventCreatedAt, isRateLimited } from '@/lib/bubbles'
import { validateClientDate, parseTzOffsetMinutes } from '@/lib/date'
import { isExpiringSoon, daysUntilExpiryOn } from '@/lib/pantry-helpers'

export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const [supabase, user] = auth

  const body = await request.json()

  // Client's local date (#524), validated EXACTLY against the offset-derived
  // local date (see `validateClientDate`; no ±1 day tolerance) — but
  // `tz_offset_minutes` is client-supplied, so that match is exact only
  // relative to a number the caller chose (#550/#595 review). `validDate` is
  // therefore used for JUDGEMENT (was this item expiring soon "today") and
  // to pick a sensible ref_key, never as the reason a second award is
  // refused — that's the 20h cooldown below, keyed on the server's own
  // `created_at`. A missing or invalid date/offset must never block the cook
  // DEDUCTION itself, matching the never-block contract every other award
  // call site follows (see bubbles-award-call-sites.test.ts) — it only means
  // both awards below are skipped for that call.
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
    // cook_confirm (predates #524): keyed on `validDate` when there is one —
    // the same recipe cooked at 23:50 and 00:10 UTC on the same local day
    // shares one key. SKIPPED (never a server-UTC fallback) without a usable
    // `validDate`, same as `rescue` below — the cook DEDUCTION above is
    // unaffected either way.
    //
    // #550/#595 review: keying alone can't close the double pay, because
    // `validDate` depends on client-supplied `tz_offset_minutes` — a second
    // confirm of the SAME cook that simply omits the date (or sends a
    // different offset) produces a DIFFERENT key from the first, valid-dated
    // confirm, and would pay again. The actual boundary is this 20h cooldown
    // on the server's own `created_at` for THIS recipe's `cook_confirm`
    // awards, independent of what ref_key any individual call would use —
    // at most one `cook_confirm` per recipe per ~20h, whatever the date says.
    if (body.recipe_id && validDate) {
      const lastCookConfirmCreatedAt = await mostRecentEventCreatedAt(
        supabase,
        user.id,
        'cook_confirm',
        `${body.recipe_id}:`,
      )
      if (!isRateLimited(lastCookConfirmCreatedAt)) {
        await awardBubbles(user.id, 'cook_confirm', `${body.recipe_id}:${validDate}`)
      }
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
