/**
 * Ingredient-to-pantry match client (issue #784).
 *
 * The recipe card tags each ingredient line have / low / missing against the
 * caller's pantry. `POST /api/ai/pantry/match-ingredients` computes that with
 * the cook matcher's deterministic pass (no model call, writes nothing), so it
 * is cheap enough to ask for on every recipe view. It is a tag, not a gate: the
 * call rejects on any failure and the caller renders the lines without tags.
 */

export type IngredientPantryStatus = 'have' | 'low' | 'missing'

/** One recipe line, as the recipe stores it. */
export interface IngredientLineInput {
  name: string
  quantity?: number | null
  unit?: string | null
}

export interface IngredientPantryMatch {
  status: IngredientPantryStatus
  /** The pantry food that covers the line, when one was matched. */
  pantryFood: string | null
}

const STATUSES: ReadonlySet<string> = new Set(['have', 'low', 'missing'])

/**
 * Status for each of `lines`, in the same order (the result is always exactly
 * as long as the input). Rejects when the request fails or the response isn't
 * one entry per line, so a caller can treat any failure as "no tags".
 */
export async function fetchIngredientMatches(
  lines: IngredientLineInput[]
): Promise<IngredientPantryMatch[]> {
  if (lines.length === 0) return []
  const res = await fetch('/api/ai/pantry/match-ingredients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ingredients: lines.map((l) => ({
        name: l.name,
        quantity: l.quantity ?? null,
        unit: l.unit ?? null,
      })),
    }),
  })
  if (!res.ok) throw new Error(`Couldn't match ingredients to the pantry (${res.status})`)
  const data = (await res.json().catch(() => null)) as { matches?: unknown } | null
  const matches = data?.matches
  if (!Array.isArray(matches) || matches.length !== lines.length) {
    throw new Error("Couldn't match ingredients to the pantry (unexpected response)")
  }
  return matches.map((m) => {
    const entry = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
    if (typeof entry.status !== 'string' || !STATUSES.has(entry.status)) {
      throw new Error("Couldn't match ingredients to the pantry (unexpected status)")
    }
    return {
      status: entry.status as IngredientPantryStatus,
      pantryFood: typeof entry.pantry_food === 'string' ? entry.pantry_food : null,
    }
  })
}
