/**
 * Kitchen scene slot map (issue #521, repositioned onto the pixel wall in #748).
 *
 * The 12 fixed slots the home-screen kitchen scene renders decorations into.
 * The keys, labels and the catalog that fills them are unchanged since #521;
 * only the positions moved, onto the dollhouse wall.
 *
 * `x`/`y`/`w`/`h` are percentages (0-100) of the scene box, which is always
 * rendered at the wall's 96:80 proportion (`KitchenScene.tsx`), so they are
 * stable at any pixel size. They are written below in wall units (the 96 x 80
 * viewBox of `wall-art.ts`, 1 unit = 1 source pixel of the board) and converted
 * with `at()`, so each box can be checked against the picture.
 *
 * Where each slot sits on the wall (wall units; the labels that Main board A
 * draws are kept clear of every slot):
 *   ceiling, right of window:  hanging_plant (68-76, 0-13), lights (78-96, 0-12)
 *   wall, left of window:      wall_art (25-36, 11-22)
 *   window, right pane:        window_sill (51.5-61.5, 11-22)
 *   wall, right of curtain:    wall_shelf (68-76, 14-29), a small wall shelf
 *   fridge, freezer drawer:    fridge_door (7-21, 47.5-55.5)
 *   worktop, left of the pot:  counter_left (26.5-34.5, 39-44.5),
 *                              counter_right (35-43, 39-44.5)
 *   stove, on the burner:      stove_top (47.5-58.5, 33-44)
 *   floor:                     floor_corner (1-15, 61-78), table (60-76, 60-76),
 *                              rug (24-60, 72.5-80), flat under Bubbles' feet
 *
 * The wall is busy, so a few boxes are small (the counter pair is about 32 x 22
 * px at 390 px wide); the emoji (and later the sprite) is sized to fit the box.
 * Boxes may overlap the drawn room (the stove slot sits over the pot) but never
 * a place's label, and decorations take no taps, so a place stays tappable.
 */
export interface Slot {
  key: string
  label: string
  /** Percentage (0-100) of the scene box's width, from the left edge. */
  x: number
  /** Percentage (0-100) of the scene box's height, from the top edge. */
  y: number
  /** Percentage (0-100) of the scene box's width. */
  w: number
  /** Percentage (0-100) of the scene box's height. */
  h: number
}

/** The wall's viewBox, in wall units. */
export const WALL_W = 96
export const WALL_H = 80

const round = (n: number) => Math.round(n * 100) / 100

/** A box in wall units -> the percentage box a `Slot` stores. */
function at(x: number, y: number, w: number, h: number) {
  return {
    x: round((x / WALL_W) * 100),
    y: round((y / WALL_H) * 100),
    w: round((w / WALL_W) * 100),
    h: round((h / WALL_H) * 100),
  }
}

export const SLOTS: Slot[] = [
  // Ceiling and wall
  { key: 'hanging_plant', label: 'Hanging plant', ...at(68, 0, 8, 13) },
  { key: 'lights', label: 'Lights', ...at(78, 0, 18, 12) },
  { key: 'wall_art', label: 'Wall art', ...at(25, 11, 11, 11) },
  { key: 'window_sill', label: 'Window sill', ...at(51.5, 11, 10, 11) },
  { key: 'wall_shelf', label: 'Wall shelf', ...at(68, 14, 8, 15) },

  // Fridge, worktop and stove
  { key: 'fridge_door', label: 'Fridge door', ...at(7, 47.5, 14, 8) },
  { key: 'counter_left', label: 'Counter (left)', ...at(26.5, 39, 8, 5.5) },
  { key: 'counter_right', label: 'Counter (right)', ...at(35, 39, 8, 5.5) },
  { key: 'stove_top', label: 'Stove top', ...at(47.5, 33, 11, 11) },

  // Floor
  { key: 'floor_corner', label: 'Floor corner', ...at(1, 61, 14, 17) },
  { key: 'table', label: 'Table', ...at(60, 60, 16, 16) },
  { key: 'rug', label: 'Rug', ...at(24, 72.5, 36, 7.5) },
]

export const SLOT_KEYS = SLOTS.map((s) => s.key)
