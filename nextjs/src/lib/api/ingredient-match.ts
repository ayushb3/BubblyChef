/**
 * Ingredient-to-pantry match client (issue #784).
 *
 * The recipe card tags each ingredient line against the caller's pantry.
 * `POST /api/ai/pantry/match-ingredients` computes that with the cook matcher's
 * deterministic pass (no model call, writes nothing), so it is cheap enough to
 * ask for on every recipe view. It is a tag, not a gate: the call rejects on any
 * failure and the caller renders the lines without tags.
 */

import type { IngredientMatch, IngredientMatchStatus } from '@/types/recipes'

/** One recipe line: the structured shape, or free text ("200 g flour"). */
export type IngredientLineInput =
  | string
  | { name: string; quantity?: number | null; unit?: string | null }

const STATUSES: ReadonlySet<string> = new Set(['have', 'low', 'missing'])

/** The cook proposal's status for a line the endpoint called have / low / missing. */
function cookStatus(status: string, basis: unknown): IngredientMatchStatus {
  if (status === 'low') return 'shortfall'
  if (status === 'missing') return 'missing'
  if (basis === 'assumed') return 'assumed'
  if (basis === 'to_taste') return 'to_taste'
  return 'ready'
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)

/**
 * How the pantry covers each of `lines`, in the same order (the result is
 * always exactly as long as the input), in the cook proposal's `IngredientMatch`
 * shape so the recipe page's food tags (`ingredient-tags.ts`) read it exactly as
 * they read a cook proposal. Rejects when the request fails or the response
 * isn't one entry per line, so a caller can treat any failure as "no tags".
 */
export async function fetchIngredientMatches(
  lines: IngredientLineInput[]
): Promise<IngredientMatch[]> {
  if (lines.length === 0) return []
  const res = await fetch('/api/ai/pantry/match-ingredients', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      ingredients: lines.map((l) =>
        typeof l === 'string'
          ? l
          : { name: l.name, quantity: l.quantity ?? null, unit: l.unit ?? null }
      ),
    }),
  })
  if (!res.ok) throw new Error(`Couldn't match ingredients to the pantry (${res.status})`)
  const data = (await res.json().catch(() => null)) as { matches?: unknown } | null
  const matches = data?.matches
  if (!Array.isArray(matches) || matches.length !== lines.length) {
    throw new Error("Couldn't match ingredients to the pantry (unexpected response)")
  }
  return matches.map((m): IngredientMatch => {
    const entry = (m && typeof m === 'object' ? m : {}) as Record<string, unknown>
    if (typeof entry.status !== 'string' || !STATUSES.has(entry.status)) {
      throw new Error("Couldn't match ingredients to the pantry (unexpected status)")
    }
    const status = cookStatus(entry.status, entry.basis)
    return {
      ingredient_name: typeof entry.name === 'string' ? entry.name : '',
      ingredient_qty: null,
      ingredient_unit: null,
      pantry_item_id: null,
      pantry_item_name: typeof entry.pantry_food === 'string' ? entry.pantry_food : null,
      pantry_qty_available: num(entry.pantry_qty_available),
      deduct_qty: null,
      base_unit: null,
      status,
      shortfall: status === 'shortfall' ? num(entry.shortfall) : null,
      match_type:
        status === 'missing' || status === 'assumed' || status === 'to_taste' ? 'none' : 'exact',
      substitution_note: null,
    }
  })
}
