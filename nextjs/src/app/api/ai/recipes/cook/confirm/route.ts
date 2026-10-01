import { NextResponse } from 'next/server'
import { aiProxyJson } from '@/lib/api/ai-proxy'
import { requireAuth } from '@/lib/response-helpers'
import { resolveLedgerDate } from '@/lib/ledger-date'
import { cookAwardRefs, readExpiryByItemId, rescueCandidates, awardCookBubbles } from '@/lib/cook-awards'

export async function POST(request: Request) {
  const auth = await requireAuth()
  if (auth instanceof NextResponse) return auth
  const [supabase, user] = auth

  const body = await request.json()

  // The ONE accepted local date (#550): the server's clock in the account's
  // stored time zone. It keys `cook_confirm` and `rescue` alike, so one recipe
  // pays at most once per local day (no double pay across UTC midnight) and a
  // date or UTC offset the client sends can't open a second key. `body.tz` can
  // only propose a zone the first time, or move it after the cooldown.
  // Resolved BEFORE the (slow) AI call so a cook that straddles midnight is
  // judged on the day it was confirmed.
  //
  // `null` means no trustworthy local date (no stored zone and none sent, e.g.
  // a stale tab): the deduction still goes ahead, but NO date-keyed award is
  // minted on a date the client chose. Never-block contract, see
  // bubbles-award-call-sites.test.ts.
  const ledger = await resolveLedgerDate(user, body?.tz)
  const ledgerDate = ledger?.date ?? null

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

  if (response.status >= 200 && response.status < 300 && ledgerDate) {
    // `cook_confirm` and `rescue` share the one accepted local date (#550).
    // A client can no longer mint a second `cook_confirm` for one cook by
    // sending a different date or offset: the date is not theirs to send.
    const refs = cookAwardRefs({ kind: 'recipe', recipeId: body.recipe_id ?? null }, ledgerDate)

    // Rescue bonus (#524): only after the microservice confirms the cook
    // (2xx), one per expiring-soon deducted item, deduplicated and capped.
    // Both the eligibility judgement (was this item expiring soon at cook
    // time) and the idempotency ref_key use that same accepted local date, so
    // a retried confirm lands on the same key and a user near local midnight
    // isn't misclassified by the server's UTC clock.
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

    const rescueIds = rescueCandidates(pantryItemIds, expiryByItemId, ledgerDate, skipped)

    await awardCookBubbles(user.id, refs, rescueIds)
  }

  return response
}
