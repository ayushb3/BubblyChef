import { NextResponse } from 'next/server'
import { requireAuth } from '@/lib/response-helpers'
import type { StarterContext } from '@/types/chat'

/**
 * `GET /api/chat/starter-context` — the context the empty-chat starter-pill
 * ranker (`lib/starter-pills.ts`) chooses from (issue #651, §7a).
 *
 * Six queries run in `Promise.all`, each scoped to the caller. Only auth is
 * non-200: a failed query degrades its own field to a safe default
 * (`console.warn`-logged) rather than failing the whole response, matching
 * `fetchStarterContext`'s client-side normalisation (`lib/api/starter-
 * context.ts`) — belt and suspenders, since either side alone would already
 * keep the ranker safe.
 */

interface RecipeCuisineRow {
  id: string
  cuisine: string | null
  last_cooked_at: string | null
  created_at: string
}

interface MealServingsRow {
  servings: number | null
  last_cooked_at: string | null
}

/** Local (not UTC) calendar date — matches `/api/pantry/expiring`'s window math. */
function localDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/**
 * The shared §6 recent-cuisine rule: merge the two cuisine queries, dedupe by
 * recipe id, sort desc by `coalesce(last_cooked_at, created_at)`, take the
 * top 5, drop blank cuisines, lower-case, and keep the top 2 by count with
 * ties broken toward the most recent. `Array.prototype.sort` is stable, so a
 * tie in `counts` keeps the insertion order of `Map` — which is exactly the
 * newest-first order the recipes were iterated in — giving "ties broken
 * toward the most recent" for free.
 */
function computeRecentCuisines(rows: RecipeCuisineRow[]): string[] {
  const byId = new Map<string, { cuisine: string | null; key: string }>()
  for (const r of rows) {
    if (byId.has(r.id)) continue
    byId.set(r.id, { cuisine: r.cuisine, key: r.last_cooked_at ?? r.created_at })
  }

  const top5 = [...byId.values()]
    .sort((a, b) => (a.key < b.key ? 1 : a.key > b.key ? -1 : 0))
    .slice(0, 5)

  const counts = new Map<string, number>()
  for (const { cuisine } of top5) {
    const c = cuisine?.trim().toLowerCase()
    if (!c) continue
    counts.set(c, (counts.get(c) ?? 0) + 1)
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([cuisine]) => cuisine)
}

/**
 * The shared §6 default-servings rule: the mode of `servings` over up to 3
 * cooked meals, ties broken toward the most recent (rows arrive already
 * ordered desc by `last_cooked_at`, so the same stable-sort trick as above
 * applies). `[]` (no cooked meals) gives 2.
 */
function computeDefaultServings(rows: MealServingsRow[]): number {
  const counts = new Map<number, number>()
  for (const r of rows) {
    if (r.servings == null || r.last_cooked_at == null) continue
    counts.set(r.servings, (counts.get(r.servings) ?? 0) + 1)
  }
  if (counts.size === 0) return 2
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0]
}

export async function GET() {
  const result = await requireAuth()
  if (result instanceof NextResponse) return result
  const [supabase, user] = result

  const now = new Date()
  const minDate = new Date(now)
  minDate.setDate(minDate.getDate() - 1)
  const maxDate = new Date(now)
  maxDate.setDate(maxDate.getDate() + 7)

  const [expiringRes, countRes, recentCooksRes, cookedCuisineRes, createdCuisineRes, mealServingsRes] =
    await Promise.all([
      // 1. Expiring — expiry_date in [today-1, today+7], in-stock only.
      supabase
        .from('pantry_items')
        .select('name, expiry_date')
        .eq('user_id', user.id)
        .not('expiry_date', 'is', null)
        .gte('expiry_date', localDateStr(minDate))
        .lte('expiry_date', localDateStr(maxDate))
        .gt('quantity', 0)
        .order('expiry_date')
        .order('name')
        .limit(10),
      // 2. The pantry count.
      supabase.from('pantry_items').select('id', { count: 'exact', head: true }).eq('user_id', user.id),
      // 3. Recent cooks.
      supabase
        .from('recipes')
        .select('id, title, cuisine, last_cooked_at')
        .eq('user_id', user.id)
        .eq('is_draft', false)
        .not('last_cooked_at', 'is', null)
        .order('last_cooked_at', { ascending: false })
        .limit(3),
      // 4. The cooked-cuisine query (§6).
      supabase
        .from('recipes')
        .select('id, cuisine, last_cooked_at, created_at')
        .eq('user_id', user.id)
        .eq('is_draft', false)
        .not('last_cooked_at', 'is', null)
        .order('last_cooked_at', { ascending: false })
        .limit(5),
      // 5. The created-cuisine query (§6).
      supabase
        .from('recipes')
        .select('id, cuisine, last_cooked_at, created_at')
        .eq('user_id', user.id)
        .eq('is_draft', false)
        .order('created_at', { ascending: false })
        .limit(5),
      // 6. The meal servings query (§6).
      supabase
        .from('meals')
        .select('servings, last_cooked_at')
        .eq('user_id', user.id)
        .not('last_cooked_at', 'is', null)
        .order('last_cooked_at', { ascending: false })
        .limit(3),
    ])

  if (expiringRes.error) console.warn('[starter-context] expiring query failed:', expiringRes.error.message)
  if (countRes.error) console.warn('[starter-context] pantry count query failed:', countRes.error.message)
  if (recentCooksRes.error) console.warn('[starter-context] recent cooks query failed:', recentCooksRes.error.message)
  if (cookedCuisineRes.error) console.warn('[starter-context] cooked-cuisine query failed:', cookedCuisineRes.error.message)
  if (createdCuisineRes.error) console.warn('[starter-context] created-cuisine query failed:', createdCuisineRes.error.message)
  if (mealServingsRes.error) console.warn('[starter-context] meal servings query failed:', mealServingsRes.error.message)

  const cuisineRows: RecipeCuisineRow[] = [
    ...((cookedCuisineRes.data as RecipeCuisineRow[] | null) ?? []),
    ...((createdCuisineRes.data as RecipeCuisineRow[] | null) ?? []),
  ]

  const recentCooksRows =
    (recentCooksRes.data as { id: string; title: string; cuisine: string | null; last_cooked_at: string }[] | null) ?? []

  const body: StarterContext = {
    expiring: (expiringRes.data as { name: string; expiry_date: string }[] | null) ?? [],
    pantry_count: !countRes.error && isNonNegativeCount(countRes.count) ? countRes.count : null,
    recent_cooks: recentCooksRows.map((r) => ({
      recipe_id: r.id,
      title: r.title,
      last_cooked_at: r.last_cooked_at,
      cuisine: r.cuisine,
    })),
    recent_cuisines: computeRecentCuisines(cuisineRows),
    default_servings: computeDefaultServings((mealServingsRes.data as MealServingsRow[] | null) ?? []),
  }

  return NextResponse.json(body)
}

function isNonNegativeCount(count: number | null): count is number {
  return typeof count === 'number' && count >= 0
}
