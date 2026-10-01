/**
 * How the /grocery page lays lines out (issue #497). Pure, no React.
 *
 * `groupGroceryLines` (lib/grocery.ts) groups by the raw category key, which is
 * right for the data. The page shows the same food-category headings as the
 * storage list ("Dairy and eggs", "Meat and fish"), in the same fixed order, so
 * two keys that share a heading ("meat", "seafood") are one group here.
 */

import type { GroceryLine } from '@/lib/grocery'
import { categoryGroups } from '@/lib/kitchen/places'

export interface GroceryHeadingGroup {
  /** The heading, which is also the group's stable key. */
  label: string
  lines: GroceryLine[]
}

export function groupByHeading(lines: readonly GroceryLine[]): GroceryHeadingGroup[] {
  const byKey = new Map(lines.map((l) => [l.key, l]))
  // `categoryGroups` owns the heading order; a grocery line has no expiry, so
  // within a group it falls back to name order.
  const groups = categoryGroups(
    lines.map((l) => ({
      id: l.key,
      name: l.name,
      category: l.category,
      quantity: l.quantity ?? 0,
      unit: l.unit ?? '',
    })),
  )
  return groups.map((g) => ({
    label: g.label,
    lines: g.items.map((i) => byKey.get(i.id)).filter((l): l is GroceryLine => l !== undefined),
  }))
}
