/**
 * Recipe tag helpers and dashboard utilities.
 *
 * AI-generated recipes carry dietary tags in `dietary_tags`; the DB stores a
 * single `tags` array.  This module provides the canonical merge + dedup so
 * both the API route (server) and any client-side callers use identical logic.
 */

/**
 * Pick one recipe at random from an array.
 *
 * Returns `null` when the array is empty so callers don't need to guard the
 * length themselves.  Both dashboard components (HeroHome, BubblesFeed) use
 * this as the single source of random selection; having it here means the
 * rule can't drift between them.
 */
export function pickRandomRecipe<T>(recipes: T[]): T | null {
  if (recipes.length === 0) return null
  return recipes[Math.floor(Math.random() * recipes.length)]
}

/**
 * Merge two tag arrays and return a deduplicated list.
 *
 * Dedup is case-insensitive: the first occurrence wins, later duplicates
 * (regardless of casing) are dropped.  The relative order of unique tags is
 * preserved — `tags` entries first, then any `dietary_tags` not already
 * present.
 *
 * @param tags         General tags already on the recipe (may be undefined).
 * @param dietaryTags  AI-generated dietary tags (may be undefined).
 * @returns            Deduplicated array written to the `tags` column.
 */
export function mergeTags(
  tags: string[] | undefined | null,
  dietaryTags: string[] | undefined | null,
): string[] {
  const combined = [...(tags ?? []), ...(dietaryTags ?? [])]
  const seen = new Set<string>()
  return combined.filter((tag) => {
    const lower = tag.toLowerCase()
    if (seen.has(lower)) return false
    seen.add(lower)
    return true
  })
}
