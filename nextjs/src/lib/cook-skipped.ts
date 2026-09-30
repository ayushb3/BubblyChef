/**
 * Issue #621 — turn the pantry item ids the server refused to deduct
 * (`deductions_skipped`) into names the cook can read. Pure.
 *
 * Distinct from `summariseDeductions`' "skipped" (rows the client never sends,
 * `needs_quantity`): this is the server-refused list.
 */

import type { CompoundSuggestion, IngredientMatch } from '@/types/recipes'

export interface SkippedDeductionNames {
  /** Distinct names, for display only. */
  names: string[]
  /** Ids that couldn't be resolved to a name through the proposal. */
  unnamed: number
  /** Distinct refused ids: what the cook is told was not updated. Two rows
   * that both read "Butter" are two items, so this can exceed `names.length + unnamed`. */
  total: number
}

/** The count to show and gate on. Falls back for shapes built without `total`. */
export function skippedTotal(s: { names: string[]; unnamed: number; total?: number }): number {
  return s.total ?? s.names.length + s.unnamed
}

export function skippedDeductionNames(
  proposal: { matches: IngredientMatch[]; compound_suggestions?: CompoundSuggestion[] },
  ids: string[],
): SkippedDeductionNames {
  const nameById = new Map<string, string>()
  for (const m of proposal.matches) {
    if (!m.pantry_item_id) continue
    const name = m.pantry_item_name ?? m.ingredient_name
    if (name && !nameById.has(m.pantry_item_id)) nameById.set(m.pantry_item_id, name)
  }
  for (const s of proposal.compound_suggestions ?? []) {
    for (const c of s.component_items ?? []) {
      if (c.name && !nameById.has(c.pantry_item_id)) nameById.set(c.pantry_item_id, c.name)
    }
  }

  const names: string[] = []
  let unnamed = 0
  const seen = new Set<string>()
  for (const id of ids) {
    if (seen.has(id)) continue
    seen.add(id)
    const name = nameById.get(id)
    if (!name) {
      unnamed += 1
    } else if (!names.includes(name)) {
      names.push(name)
    }
  }
  return { names, unnamed, total: seen.size }
}
