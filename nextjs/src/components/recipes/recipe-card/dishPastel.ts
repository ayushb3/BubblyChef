/**
 * The dish pastel for a role (issue #744): main pink, side 1 mint, side 2
 * peach. These are the theme-invariant `--color-dish-*` tokens from
 * globals.css (issue #741), so a dish keeps one colour in every theme and the
 * timeline column can read the same variable.
 */

export type DishRole = 'main' | 'side'

/** `sideIndex` is the side's order among the meal's sides: 0 is side 1, 1 is side 2. */
export function dishPastel(role: DishRole, sideIndex = 0): string {
  if (role === 'main') return 'var(--color-dish-main)'
  return sideIndex >= 1 ? 'var(--color-dish-side-2)' : 'var(--color-dish-side-1)'
}

export const ROLE_LABEL: Record<DishRole, string> = { main: 'Main', side: 'Side' }
