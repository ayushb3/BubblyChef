import { NextResponse } from 'next/server'
import { aiProxyFetch } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { validateClientDate } from '@/lib/date'
import { cookAwardRefs, readExpiryByItemId, rescueCandidates, awardCookBubbles } from '@/lib/cook-awards'

const COOKED_ON_PATTERN = /^\d{4}-\d{2}-\d{2}$/

/**
 * Proxies `POST /v1/meals/cook/confirm` to the AI service (issue #654 / spec
 * #647 §4 S7) and awards this cook's bubbles once the microservice's claim
 * has actually landed.
 *
 * Every award is keyed on `cooked_on`, which the server fixes at the claim
 * (§2c) and returns identically on a replay — so an `already_confirmed`
 * replay awards again with the *same* refs, and the ledger's unique
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

  // Client's local date (#524) — only used to judge rescue eligibility;
  // a missing or out-of-range date must never block the deduction, matching
  // the never-block contract every other award call site follows.
  const validDate = validateClientDate(body.date, 'date') ? null : (body.date as string)

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

    if (typeof mealId === 'string' && typeof cookedOn === 'string' && COOKED_ON_PATTERN.test(cookedOn)) {
      const refs = cookAwardRefs({ kind: 'meal', mealId }, cookedOn)

      // N4: exclude rows the confirm itself refused to deduct — they never
      // left the pantry, so they haven't been rescued from anything.
      const rawSkipped = (data as { deductions_skipped?: unknown })?.deductions_skipped
      const skipped = Array.isArray(rawSkipped)
        ? rawSkipped.filter((id): id is string => typeof id === 'string')
        : []

      const rescueIds = validDate
        ? rescueCandidates(pantryItemIds, expiryByItemId, validDate, skipped)
        : []

      await awardCookBubbles(user.id, refs, rescueIds)
    } else {
      // Never fall back to the proxy's own date — that would let a replay
      // across midnight mint a second day's worth of awards.
      console.error('[meals/cook/confirm] no award: missing/invalid meal_id or cooked_on', {
        mealId,
        cookedOn,
      })
    }
  }

  return NextResponse.json(data, { status: res.status })
}
