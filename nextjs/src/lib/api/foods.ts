/**
 * Food catalog client — used for the manual "Type" pantry-add form's
 * ingredient-name autocomplete (issue #398). Reads the same 304-entry
 * USDA-derived catalog the AI ingest paths use, via the Next.js CRUD route
 * (not the AI service — see the "two API surfaces" rule in CLAUDE.md).
 */

/** A single row from the `food_catalog` table, as returned by `GET /api/foods/search`. */
export interface FoodCatalogEntry {
  canonical: string
  category: string
  icon_slug: string | null
  valid_units: string[]
  expiry_days: number
  default_location: string
  emoji: string | null
}

/**
 * Search the food catalog by name prefix/substring.
 *
 * Mirrors the route's own floor: queries under 2 characters return no
 * results server-side, so callers should avoid firing one below that length.
 */
export async function searchFoods(query: string, limit = 8): Promise<FoodCatalogEntry[]> {
  const res = await fetch(`/api/foods/search?q=${encodeURIComponent(query)}&limit=${limit}`)

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Food search failed' }))
    throw new Error(err.error ?? `Food search failed: ${res.status}`)
  }

  const data = await res.json()
  return data.results ?? []
}
