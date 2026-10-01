/**
 * Library search and the "Cooked Nx" line (issue #855). Pure and client-side:
 * the library already holds the whole list, so there is no server round trip.
 *
 * Search is token-wise. The query is split into words and every word must match
 * somewhere on the recipe (title, ingredient names, tags, cuisine, meal type,
 * description), so "chickpea dinner" finds a curry that has chickpeas in it even
 * though the title says neither. Filler words ("dinner", "recipe") are ignored
 * so they cannot veto a match, unless the query is nothing but filler, in which
 * case they are searched for as written ("dinner" still lists dinners).
 */

import { ingredientParts } from '@/lib/recipe-helpers'
import type { Recipe } from '@/components/recipes/RecipePage'

/** Words that describe the request ("a chickpea dinner recipe"), not the food. */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'dish',
  'dishes',
  'dinner',
  'dinners',
  'for',
  'ideas',
  'idea',
  'meal',
  'meals',
  'of',
  'recipe',
  'recipes',
  'some',
  'the',
  'with',
])

/** The words of a query, lowercased, with filler dropped (kept if it is all there is). */
export function searchTokens(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
  const meaningful = words.filter((w) => !STOP_WORDS.has(w))
  return meaningful.length > 0 ? meaningful : words
}

type Searchable = Pick<
  Recipe,
  'title' | 'ingredients' | 'tags' | 'cuisine' | 'meal_type' | 'description'
>

/** How well one token matches a recipe: 0 is no match anywhere. Title counts most. */
function tokenScore(r: Searchable, ingredientNames: string[], token: string): number {
  const title = r.title.toLowerCase()
  let score = 0
  if (title.startsWith(token)) score += 3
  else if (title.includes(token)) score += 2
  if (ingredientNames.some((n) => n.includes(token))) score += 1
  if (r.tags?.some((t) => t.toLowerCase().includes(token))) score += 1
  if (r.cuisine?.toLowerCase().includes(token)) score += 1
  if (r.meal_type?.toLowerCase().includes(token)) score += 1
  if ((r.description ?? '').toLowerCase().includes(token)) score += 0.5
  return score
}

/**
 * The recipes matching every word of `query`, best match first (ties keep list
 * order). A blank query returns the list as it came.
 */
export function searchRecipes<T extends Searchable>(recipes: T[], query: string): T[] {
  const tokens = searchTokens(query)
  if (tokens.length === 0) return recipes

  const scored: { r: T; score: number }[] = []
  for (const r of recipes) {
    const names = (r.ingredients ?? []).map((i) => ingredientParts(i).name.toLowerCase())
    let total = 0
    let every = true
    for (const token of tokens) {
      const s = tokenScore(r, names, token)
      if (s === 0) {
        every = false
        break
      }
      total += s
    }
    if (every) scored.push({ r, score: total })
  }
  // Array.prototype.sort is stable, so equal scores keep the list's order.
  return scored.sort((a, b) => b.score - a.score).map(({ r }) => r)
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate())

/** Whole calendar days from `then` to `now`, in local time (a cook at 11pm is "yesterday" at 1am). */
function calendarDaysAgo(then: Date, now: Date): number {
  const ms = startOfDay(now).getTime() - startOfDay(then).getTime()
  return Math.round(ms / 86_400_000)
}

function relativeDay(then: Date, now: Date): string {
  const days = calendarDaysAgo(then, now)
  if (days <= 0) return 'today' // a future timestamp (clock skew) is not "ago"
  if (days === 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  if (days < 35) {
    const weeks = Math.floor(days / 7)
    return `${weeks} ${weeks === 1 ? 'week' : 'weeks'} ago`
  }
  const date = `${MONTHS[then.getMonth()]} ${then.getDate()}`
  return then.getFullYear() === now.getFullYear() ? date : `${date}, ${then.getFullYear()}`
}

/**
 * "Cooked 3x, last 2 days ago", or `null` when the recipe was never cooked (or
 * carries no cook data, so the card shows nothing rather than a guess). With a
 * count but no readable timestamp it is just "Cooked 3x".
 */
export function cookedLabel(
  timesCooked: number | null | undefined,
  lastCookedAt: string | null | undefined,
  now: Date = new Date(),
): string | null {
  if (!timesCooked || timesCooked <= 0) return null
  const count = `Cooked ${timesCooked}x`
  if (!lastCookedAt) return count
  const then = new Date(lastCookedAt)
  if (Number.isNaN(then.getTime())) return count
  return `${count}, last ${relativeDay(then, now)}`
}
