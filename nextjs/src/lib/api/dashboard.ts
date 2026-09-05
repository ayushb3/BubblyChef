/**
 * Dashboard AI client — calls the Next.js proxy route for
 * `GET /v1/dashboard/daily` (#225, #168).
 *
 * A separate file rather than folding this into `recipes.ts` or `chat.ts`:
 * the endpoint returns a tip *and* a recipe suggestion in one payload, so it
 * doesn't belong to either existing domain, and `HeroHome` is the only
 * consumer today. If a second dashboard-shaped endpoint shows up later this
 * file is where it goes.
 */

export type DashboardSuggestionReason = 'expiring' | 'pantry_match' | 'meal_time' | 'fallback'

export interface DashboardTip {
  text: string
  category: string
}

export interface DashboardSuggestion {
  recipe_id: string
  // Not rendered directly — `copy` (AI-written or templated) already carries
  // the recipe's name when it's relevant, and the LLM copy doesn't always
  // name the dish the way the old bolded-title UI did. Kept typed because
  // it's part of the wire contract and `/recipes/[id]` is the click-through
  // anyway; not wired into the hero card. If losing the bolded title is a
  // UX regression worth fixing, that's a product call for a follow-up issue,
  // not a silent frontend decision here.
  title: string
  total_time_minutes: number | null
  copy: string
  // Not consumed — the design doc's plan to vary hero emphasis by `reason`
  // (e.g. lead differently for "expiring" vs "meal_time") isn't implemented.
  // Kept typed as part of the wire contract; see #225 spec-review finding 4.
  reason: DashboardSuggestionReason
}

export interface DashboardDaily {
  tip: DashboardTip
  suggestion: DashboardSuggestion | null
  generated_at: string
  // Not consumed by the UI — there is no "AI-generated" vs "fallback" badge
  // today. Kept typed as part of the wire contract in case that surfaces
  // later (see #225 spec-review finding 4).
  source: 'ai' | 'fallback'
}

/**
 * The client's UTC offset in minutes, using the endpoint's convention (the
 * number of minutes to ADD to UTC to reach local time — UTC+2 -> 120).
 *
 * `Date.prototype.getTimezoneOffset()` returns the OPPOSITE sign, so this is
 * always its negation. Getting this backwards is a silent bug — the request
 * still succeeds, it just buckets the wrong meal-time and rolls the cache
 * over at the wrong moment. See `ai-service/bubbly_chef/api/routes/dashboard.py`.
 */
export function tzOffsetMinutes(): number {
  return -new Date().getTimezoneOffset()
}

/**
 * Fetch today's tip + recipe suggestion for the current user.
 *
 * Throws on a non-OK response — callers (HeroHome) are expected to catch
 * this and fall back to the static client-side tip list, exactly as the
 * existing pantry/recipes fetches in HeroHome already degrade on failure.
 */
export async function fetchDashboardDaily(): Promise<DashboardDaily> {
  const params = new URLSearchParams({ tz_offset_minutes: String(tzOffsetMinutes()) })
  const res = await fetch(`/api/ai/dashboard/daily?${params}`)

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Dashboard fetch failed' }))
    throw new Error(err.error ?? `Dashboard fetch failed: ${res.status}`)
  }

  return res.json()
}
