/**
 * Shared look of the meal timeline family (issue #745, signature #4): the
 * dish pastels and the solid / hatched step language, used by the timeline
 * table, the cook-along cards and the recipe page's steps so they read as one
 * system.
 *
 * - A step you do (hands-on, or the moment you start a hands-off step) is
 *   SOLID: a pastel fill with an ink edge.
 * - A step that is just cooking (hands-off, running) is HATCHED: a dashed
 *   muted edge over diagonal stripes, no fill. Hatching never animates.
 *
 * Every colour is a CSS variable (the dish pastels are theme-invariant tokens
 * in `globals.css`), so no hex literal lives here. The strings are complete
 * class names so Tailwind's scanner sees them.
 */

import type { Column } from '@/lib/meal-scheduler'

/** Fill classes for a dish's pastel: "main" is always pink, whatever the theme. */
export const DISH_BG: Record<Column, string> = {
  main: 'bg-[var(--color-dish-main)]',
  side_1: 'bg-[var(--color-dish-side-1)]',
  side_2: 'bg-[var(--color-dish-side-2)]',
}

/** The 2 px ink edge of a solid step. */
export const SOLID_EDGE = 'border-2 border-solid border-[color:var(--color-text)]'

/** The dashed muted edge + diagonal stripes of a hatched (waiting) step. */
export const HATCHED =
  'border-2 border-dashed border-[color:var(--color-muted)] bg-[repeating-linear-gradient(135deg,transparent_0_6px,color-mix(in_srgb,var(--color-text)_7%,transparent)_6px_12px)]'
