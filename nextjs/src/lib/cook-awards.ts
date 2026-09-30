/**
 * Issue #654 (S8) — the one place a cook confirm's bubble award keys are
 * built, shared by the single-recipe confirm proxy
 * (`app/api/ai/recipes/cook/confirm/route.ts`) and the new meal confirm
 * proxy (`app/api/ai/meals/cook/confirm/route.ts`). Before this, the recipe
 * proxy built its own `${recipe_id}:${today}` / `${pantry_item_id}:${today}`
 * strings inline — pulling that out here means both proxies key everything
 * the same way instead of drifting.
 *
 * Issue #550: the recipe proxy passes `keyDate` = the ONE accepted local date
 * from `resolveLedgerDate` (`lib/ledger-date.ts`) — the server's clock in the
 * account's stored zone — so `cook_confirm` and `rescue` agree with
 * `daily_visit`. The meal proxy still passes the claim's own `cooked_on`.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { awardBubbles, RESCUE_CAP_PER_COOK } from '@/lib/bubbles'
import { isExpiringSoon, daysUntilExpiryOn } from '@/lib/pantry-helpers'

export type CookAwardSubject =
  | { kind: 'recipe'; recipeId: string | null }
  | { kind: 'meal'; mealId: string }

export interface CookAwardRefs {
  /** `null` means no `cook_confirm` award (a recipe body with no `recipe_id`). */
  cookConfirm: string | null
  /** `null` for a recipe subject — the meal bonus only ever applies to a meal cook. */
  mealBonus: string | null
  rescue: (pantryItemId: string) => string
}

/**
 * `recipe`: `${recipeId}:${keyDate}`; `meal`: `meal:${mealId}:${keyDate}` for
 * both `cook_confirm` and `meal_bonus`. `rescue`: `${pantryItemId}:${keyDate}`
 * for either subject — the rescue ledger has never distinguished a recipe
 * cook from a meal cook, only the pantry item and the date.
 */
export function cookAwardRefs(subject: CookAwardSubject, keyDate: string): CookAwardRefs {
  const rescue = (pantryItemId: string) => `${pantryItemId}:${keyDate}`

  if (subject.kind === 'recipe') {
    return {
      cookConfirm: subject.recipeId ? `${subject.recipeId}:${keyDate}` : null,
      mealBonus: null,
      rescue,
    }
  }

  return {
    cookConfirm: `meal:${subject.mealId}:${keyDate}`,
    mealBonus: `meal:${subject.mealId}:${keyDate}`,
    rescue,
  }
}

/**
 * The pantry rows' `expiry_date`, read BEFORE forwarding the confirm to the
 * AI service — the row may be gone (or its expiry moot) by the time the
 * microservice's own deduction finishes, and the rescue award needs "was
 * this expiring soon at cook time", not whatever is left afterward. Moved
 * verbatim from the recipe confirm proxy (:31-41 on `main`).
 */
export async function readExpiryByItemId(
  supabase: SupabaseClient,
  userId: string,
  pantryItemIds: string[],
): Promise<Map<string, string | null>> {
  if (pantryItemIds.length === 0) return new Map()

  const { data: rows } = await supabase
    .from('pantry_items')
    .select('id, expiry_date')
    .eq('user_id', userId)
    .in('id', pantryItemIds)

  return new Map(
    ((rows ?? []) as Array<{ id: string; expiry_date: string | null }>).map((row) => [
      row.id,
      row.expiry_date,
    ]),
  )
}

/**
 * De-duplicated, order-preserving, minus `excludeIds` (rows the confirm
 * refused to deduct — N4, they never left the pantry), filtered to
 * expiring-soon on `validDate`, capped at `RESCUE_CAP_PER_COOK` — for a
 * meal cook, that cap is for the whole meal, not per dish.
 */
export function rescueCandidates(
  pantryItemIds: string[],
  expiryByItemId: Map<string, string | null>,
  validDate: string,
  excludeIds: string[] = [],
): string[] {
  const exclude = new Set(excludeIds)
  const seen = new Set<string>()
  const candidates: string[] = []

  for (const id of pantryItemIds) {
    if (exclude.has(id) || seen.has(id)) continue
    seen.add(id)
    if (isExpiringSoon(daysUntilExpiryOn(expiryByItemId.get(id) ?? null, validDate))) {
      candidates.push(id)
    }
  }

  return candidates.slice(0, RESCUE_CAP_PER_COOK)
}

/**
 * Awaits `cook_confirm`, then `meal_bonus`, then each `rescue`, in that
 * order. Never throws — `awardBubbles` itself never does, so a bubbles
 * outage never blocks (or reorders) the caller's own response.
 */
export async function awardCookBubbles(
  userId: string,
  refs: CookAwardRefs,
  rescueIds: string[],
): Promise<void> {
  if (refs.cookConfirm) {
    await awardBubbles(userId, 'cook_confirm', refs.cookConfirm)
  }
  if (refs.mealBonus) {
    await awardBubbles(userId, 'meal_bonus', refs.mealBonus)
  }
  for (const pantryItemId of rescueIds) {
    await awardBubbles(userId, 'rescue', refs.rescue(pantryItemId))
  }
}
