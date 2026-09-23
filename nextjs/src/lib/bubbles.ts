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
