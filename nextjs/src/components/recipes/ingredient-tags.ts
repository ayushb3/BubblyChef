/**
 * Issue #745 — the food tag an ingredient row wears when the caller knows how
 * the pantry covers it: "In pantry", "Short ½", "Staple". Pure; built on the
 * cook proposal's `IngredientMatch` (`types/recipes.ts`), so the recipe page
 * and the cook sheet can never disagree about what counts as covered.
 *
 * A missing ingredient (or one with a unit conflict) gets no tag: the tags say
 * what you already have, and an absent tag is "you need it".
 */

import type { ChipTone } from '@/components/ui/Chip'
import type { IngredientMatch } from '@/types/recipes'

export interface PantryTag {
  label: string
  tone: Extract<ChipTone, 'fresh' | 'expiring' | 'muted'>
}

const QUARTERS: Record<number, string> = { 0.25: '¼', 0.5: '½', 0.75: '¾' }

/**
 * "Short ½": the share of what the recipe needs that the pantry can't cover,
 * to the nearest quarter. `shortfall` and `pantry_qty_available` are both in
 * the match's base unit, so the ratio needs no unit conversion. Without both
 * amounts (or a share outside ⅛–⅞) it's plain "Short".
 */
function shortLabel(match: IngredientMatch): string {
  const have = match.pantry_qty_available
  const missing = match.shortfall
  if (have == null || missing == null || missing <= 0 || have < 0) return 'Short'
  const quarter = Math.round((missing / (have + missing)) * 4) / 4
  const glyph = QUARTERS[quarter]
  return glyph ? `Short ${glyph}` : 'Short'
}

export function pantryTag(match: IngredientMatch): PantryTag | null {
  switch (match.status) {
    case 'ready':
    case 'substitute':
    case 'imprecise':
      return { label: 'In pantry', tone: 'fresh' }
    case 'shortfall':
      return { label: shortLabel(match), tone: 'expiring' }
    case 'assumed':
      return { label: 'Staple', tone: 'muted' }
    default:
      return null
  }
}

/**
 * The tag for ingredient row `i` when the matches are aligned to the rows
 * (`useIngredientMatches`, issue #784): two lines of one food each get their own.
 * A `null` entry (a row nothing was asked about) has no tag.
 */
export function tagForRow(rows: (IngredientMatch | null)[] | undefined, i: number): PantryTag | null {
  const match = rows?.[i]
  return match ? pantryTag(match) : null
}

/**
 * The tag for one ingredient row, found by name: the match whose ingredient
 * name appears in the row's label ("400 g tomatoes" ↔ "tomatoes"); the longest
 * name wins when several do ("tomato paste" over "tomato").
 */
export function tagForIngredient(label: string, matches: IngredientMatch[] | undefined): PantryTag | null {
  if (!matches || matches.length === 0) return null
  const haystack = label.toLowerCase()
  let best: IngredientMatch | null = null
  for (const m of matches) {
    const name = m.ingredient_name.trim().toLowerCase()
    if (!name || !haystack.includes(name)) continue
    if (!best || name.length > best.ingredient_name.trim().length) best = m
  }
  return best ? pantryTag(best) : null
}
