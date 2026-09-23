/**
 * Server-only bubbles ledger award helper (issue #520).
 *
 * Awards go through the service-role client, bypassing RLS — `bubble_events`
 * has no client INSERT policy at all (see
 * supabase/migrations/00011_gamification_bubbles_ledger.sql), so this is the
 * only way bubbles get written. The unique (user_id, event_type, ref_key)
 * constraint on the table makes every award idempotent: calling this twice
 * with the same (userId, eventType, refKey) awards once.
 *
 * Never throws — an award failure must never block the caller's own write
 * (pantry add, recipe save, cook confirm, etc.), matching the never-block
 * contract `estimateCategory`/`estimateExpiry` already use in
 * `nextjs/src/lib/api/ai-proxy.ts`.
 */

import { createClient as createServiceClient } from '@supabase/supabase-js'
import type { SupabaseClient } from '@supabase/supabase-js'

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL!
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!

export const BUBBLE_AMOUNTS = {
  scan_confirm: 5,
  pantry_add: 2,
  recipe_save: 3,
  cook_confirm: 10,
  daily_visit: 1,
  /** Using up an item while it's expiring soon (0-3 days left, see `isExpiringSoon`) — issue #524. */
  rescue: 8,
  /** A completed Mon-Sun week with at least one bubble_event and no waste — issue #524. */
  weekly_streak: 20,
} as const

/**
 * Most `rescue` awards a single cook confirm can earn (issue #524) — a
 * recipe with a long ingredient list shouldn't out-earn a whole day of
 * pantry activity. The resolve route has no cap: it only ever handles one
 * item per call.
 */
export const RESCUE_CAP_PER_COOK = 3

export type BubbleEventType = keyof typeof BUBBLE_AMOUNTS

/**
 * Award bubbles for a gamification event.
 *
 * `refKey` is what makes the award idempotent for this event type — see the
 * ref_key conventions documented in the 00011 migration (pantry item id,
 * recipe id, `<recipe_id>:<date>` for a cook, the client's local date for a
 * daily visit, etc).
 *
 * Returns the amount actually awarded, or `0` when the award was a duplicate
 * (swallowed by `ignoreDuplicates`) or the insert failed for any other
 * reason.
 */
export async function awardBubbles(
  userId: string,
  eventType: BubbleEventType,
  refKey: string,
): Promise<number> {
  try {
    const sb = createServiceClient(SUPABASE_URL, SERVICE_ROLE_KEY)
    const { data, error } = await sb
      .from('bubble_events')
      .upsert(
        {
          user_id: userId,
          event_type: eventType,
          amount: BUBBLE_AMOUNTS[eventType],
          ref_key: refKey,
        },
        { onConflict: 'user_id,event_type,ref_key', ignoreDuplicates: true },
      )
      .select()

    if (error) {
      console.error('[bubbles] award failed: %s', error.message)
      return 0
    }

    return data && data.length > 0 ? BUBBLE_AMOUNTS[eventType] : 0
  } catch (err) {
    console.error('[bubbles] award threw: %s', err)
    return 0
  }
}

/**
 * Minimum time between two awards of the same rate-limited event type,
 * measured by the server's own `created_at` (issue #550/#595 review).
 *
 * `date`/`tz_offset_minutes` are client-supplied and cannot be trusted as a
 * security boundary: a fabricated offset makes any date "the" caller's exact
 * local date (`validateClientDate` in `lib/date.ts` is still useful for
 * *judgement* — e.g. was this item expiring soon "today" — and for choosing
 * a sensible ref_key, but it proves nothing about how often the caller has
 * actually been awarded). This cooldown is the actual anti-abuse mechanism:
 * whatever ref_key a call's date produces, a second award of the same event
 * type (optionally scoped to one `ref_key` prefix, e.g. one recipe's
 * `cook_confirm`) within ~20h of the last one is refused outright, so at
 * most one award lands per ~20h no matter how the client's date/offset is
 * shifted.
 */
export const RATE_LIMIT_COOLDOWN_MS = 20 * 60 * 60 * 1000

/**
 * `true` when `lastEventCreatedAt` (a `created_at` timestamp, or `null` when
 * there is no prior event) is recent enough that a new award should be
 * refused.
 */
export function isRateLimited(
  lastEventCreatedAt: string | null,
  now: number = Date.now(),
  cooldownMs: number = RATE_LIMIT_COOLDOWN_MS,
): boolean {
  if (!lastEventCreatedAt) return false
  const lastMs = new Date(lastEventCreatedAt).getTime()
  if (Number.isNaN(lastMs)) return false
  return now - lastMs < cooldownMs
}

/**
 * The server `created_at` of this user's most recent `eventType` event
 * (optionally restricted to `ref_key`s starting with `refKeyPrefix` — e.g.
 * one recipe's `cook_confirm` awards), or `null` when there is none.
 *
 * Reads through the request-scoped (RLS-bound) client, not the service-role
 * one `awardBubbles` uses — this is a read of the caller's own rows, which
 * `bubble_events`' RLS already permits (see the "recent" query in
 * `GET /api/bubbles`).
 *
 * Filters `event_type`/`ref_key` again in JS after the query, not just in
 * `.eq()`/`.like()` — belt-and-suspenders against a test double or an RLS
 * policy that doesn't actually narrow the rows returned; a real Supabase
 * client's own filtering makes this a no-op.
 */
export async function mostRecentEventCreatedAt(
  supabase: SupabaseClient,
  userId: string,
  eventType: BubbleEventType,
  refKeyPrefix?: string,
): Promise<string | null> {
  try {
    let query = supabase
      .from('bubble_events')
      .select('created_at, event_type, ref_key')
      .eq('user_id', userId)
      .eq('event_type', eventType)
      .order('created_at', { ascending: false })
    if (refKeyPrefix) {
      query = query.like('ref_key', `${refKeyPrefix}%`)
    }

    // `.limit(1)` awaited directly, same convention as the "recent" query in
    // `GET /api/bubbles` — not `.limit(1).maybeSingle()`, which some of this
    // codebase's own test doubles (built around a single terminal
    // `.limit()`/`.then()`) don't model as further chainable.
    const { data, error } = await query.limit(1)
    if (error) {
      console.error('[bubbles] mostRecentEventCreatedAt failed: %s', error.message)
      return null
    }

    type Row = { created_at: string; event_type: string; ref_key: string }
    const rows: Row[] = Array.isArray(data) ? data : data ? [data as Row] : []
    const matching = rows.filter(
      (row) =>
        row.event_type === eventType &&
        (!refKeyPrefix || (typeof row.ref_key === 'string' && row.ref_key.startsWith(refKeyPrefix))),
    )
    if (matching.length === 0) return null

    matching.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    return matching[0].created_at
  } catch (err) {
    console.error('[bubbles] mostRecentEventCreatedAt threw: %s', err)
    return null
  }
}
