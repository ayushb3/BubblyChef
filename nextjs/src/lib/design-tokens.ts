export const colors = {
  bg: '#FFF0F5',
  primary: '#FFB7C5',
  accent: '#B5D5F5',
  text: '#5C4A5A',
  surface: '#FFFAFC',
  border: '#F2D6E0',
  muted: '#9B8A93',
  primaryDark: '#FF8FAB',
  accentDark: '#7EC8F0',
} as const

/**
 * Dish pastels (issue #741): one per dish role, theme-invariant. The CSS
 * variables `--color-dish-main` / `-side-1` / `-side-2` in globals.css are the
 * source of truth for styling; this mirror is for non-CSS consumers (SVG
 * fills, tests).
 */
export const dishPastels = {
  main: '#FFB5C5',
  side1: '#B5EAD7',
  side2: '#FFDAB3',
} as const
