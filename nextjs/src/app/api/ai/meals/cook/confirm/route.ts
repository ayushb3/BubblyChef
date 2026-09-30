import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { localDateInZone, resolveLedgerDate } from '@/lib/ledger-date'
import { cookAwardRefs, readExpiryByItemId, rescueCandidates, awardCookBubbles } from '@/lib/cook-awards'

const COOKED_ON_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Proxies `POST /v1/meals/cook/confirm` to the AI service (issue #654 / spec
 * #647 §4 S7) and awards this cook's bubbles once the microservice's claim
 * has actually landed.
 *
 * Every award is keyed on the account's LOCAL date (#550) of `cooked_at`, the
 * instant the server fixes at the claim (§2c) and returns identically on a
 * replay — so an `already_confirmed` replay awards again with the *same*
 * refs, one meal cooked either side of UTC midnight on one local day pays
 * once, and the ledger's unique
 * `(user_id, event_type, ref_key)` constraint dedupes it for free. That's why
 * this route, unlike the plain success/failure split elsewhere, awards on
 * every 2xx rather than skipping `already_confirmed` — skipping it would lose
 * the award entirely if the *first* response was lost after the deduction
 * actually landed.
 */
export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const [supabase, user] = auth

  const rawBody = await request.json().catch(() => null)
  // Review N5 — a JSON body of `null` (valid JSON, so the `.catch` above
  // never fires) reached `body.date` below as a `TypeError`. Any non-object
  // body (null, a bare string/number/boolean) is rejected the same way.
  if (!(typeof rawBody === 'object' && rawBody)) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const body = rawBody as Record<string, unknown>

  // The account's stored IANA zone (#524, #550), NOT anything the client sends
  // per request — `body.tz` can only propose a zone the first time or move it
  // after the cooldown. Below it turns the claim's instant into the one local
  // date every award keys on. No known zone must never block the deduction,
  // matching the never-block contract every other award call site follows.
  const ledger = await resolveLedgerDate(user, body.tz)

  const deductions = Array.isArray(body.deductions) ? body.deductions : []
  const pantryItemIds: string[] = deductions
    .map((d: { pantry_item_id?: unknown }) => d?.pantry_item_id)
    .filter((id: unknown): id is string => typeof id === 'string')

  // Read expiry_date up front, before forwarding — same reasoning as the
  // recipe confirm proxy: the pantry row may be gone or partly deducted by
  // the time the microservice's own write finishes.
  const expiryByItemId = await readExpiryByItemId(supabase, user.id, pantryItemIds)

  const res = await aiProxyFetch('/v1/meals/cook/confirm', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  // aiProxyFetch returns a NextResponse directly when there's no session (401).
  if (res instanceof NextResponse) return res

  // Parse the upstream body once — it's both the response we forward and the
  // source of `cooked_on` and `deductions_skipped` for the award below.
  const data = await res.json().catch(() => ({}))

  if (res.status >= 200 && res.status < 300) {
    const mealId = body.meal_id
    const cookedOn = (data as { cooked_on?: unknown })?.cooked_on
    const cookedAt = (data as { cooked_at?: unknown })?.cooked_at

    // The award date (#550): the LOCAL date, in the account's stored zone, of
    // the instant the claim was made — NOT the claim's UTC `cooked_on`, and
    // NOT "now". The claim returns `cooked_at` identically on a replay, so a
    // retry after local midnight lands on the first call's key (the ledger
    // dedupes it), while two separate cooks either side of UTC midnight on one
    // local day share a key and pay once. An AI service older than #550 sends
    // no `cooked_at`; it falls back to `cooked_on` so the award isn't lost in
    // the deploy window. With no known zone nothing is awarded (same rule as
    // the recipe proxy); the cook itself is never blocked.
    const claimInstant = typeof cookedAt === 'string' ? new Date(cookedAt) : null
    const claimDate =
      ledger && claimInstant && !Number.isNaN(claimInstant.getTime())
        ? localDateInZone(claimInstant, ledger.timeZone)
        : typeof cookedOn === 'string' && COOKED_ON_PATTERN.test(cookedOn)
          ? cookedOn
          : null

    if (ledger && typeof mealId === 'string' && claimDate) {
      const refs = cookAwardRefs({ kind: 'meal', mealId }, claimDate)

      // N4: exclude rows the confirm itself refused to deduct — they never
      // left the pantry, so they haven't been rescued from anything.
      const rawSkipped = (data as { deductions_skipped?: unknown })?.deductions_skipped
      const skipped = Array.isArray(rawSkipped)
        ? rawSkipped.filter((id): id is string => typeof id === 'string')
        : []

      // Eligibility is judged on the same date the keys use, so all of a
      // cook's awards agree (rule 6 of #550).
      const rescueIds = rescueCandidates(pantryItemIds, expiryByItemId, claimDate, skipped)

      await awardCookBubbles(user.id, refs, rescueIds)
    } else {
      // Never fall back to the proxy's own "now" — that would let a replay
      // across midnight mint a second day's worth of awards.
      console.error('[meals/cook/confirm] no award: no known zone, or missing/invalid meal_id or claim date', {
        mealId,
        cookedOn,
        cookedAt,
        hasZone: Boolean(ledger),
      })
    }
  }

  return NextResponse.json(data, { status: res.status })
}
