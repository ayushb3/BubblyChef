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
  // Used to key both the `cook_confirm` and `rescue` awards below; a missing
  // or invalid date/offset must never block the cook DEDUCTION itself,
  // matching the never-block contract every other award call site follows
  // (see bubbles-award-call-sites.test.ts) — it only means both awards are
  // skipped for that call, below. (An earlier version of this fix fell back
  // to the server's UTC date for `cook_confirm` instead of skipping it — that
  // reopens the double pay this issue exists to close: one confirm with the
  // valid local date pays `<recipe>:<localDate>`, and a second confirm of
  // the SAME cook with a missing/invalid date pays the fallback
  // `<recipe>:<utcDate>` — two awards for one cook whenever local and UTC
  // dates disagree, i.e. every evening in the Americas. The app always sends
  // a valid date, so skipping — like `rescue` already does — is the correct
  // choice here.)
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
    // cook_confirm (predates #524): keyed on `validDate` — the single
    // client-local date the server just validated exactly against the
    // offset — so the same recipe cooked at 23:50 and 00:10 UTC on the same
    // local day pays once, closing the UTC-midnight double pay this issue
    // was filed for. Issue #550 review: SKIPPED (not fallback-keyed to the
    // server's UTC date) when there's no usable `validDate`, same as
    // `rescue` below — a UTC fallback here would let one cook be paid twice
    // by confirming once with a valid date and once with a missing/invalid
    // one. The cook DEDUCTION above is unaffected either way; only this
    // award is conditional on a usable date, and the app always sends one.
    if (body.recipe_id && validDate) {
      await awardBubbles(user.id, 'cook_confirm', `${body.recipe_id}:${validDate}`)
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
