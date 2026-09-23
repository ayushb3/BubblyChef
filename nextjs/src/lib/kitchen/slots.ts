/**
 * Kitchen scene slot map (issue #521).
 *
 * The 12 fixed slots the home-screen kitchen scene renders into. `x`/`y`/`w`/`h`
 * are percentages (0-100) of the scene box, which is always rendered at a 4:3
 * aspect ratio (`KitchenScene.tsx`) — so these percentages are stable
 * regardless of the box's actual pixel size.
 *
 * Laid out on a rough 4-column x 3-row grid so nothing overlaps:
 *   row 1 (y 2-30):   wall_shelf, wall_art, window_sill, lights
 *   row 2 (y 34-62):  hanging_plant, fridge_door, counter_left, counter_right
 *   row 3 (y 66-94):  stove_top, table, rug, floor_corner
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

export const SLOTS: Slot[] = [
  // Row 1
  { key: 'wall_shelf', label: 'Wall shelf', x: 2, y: 2, w: 21, h: 26 },
  { key: 'wall_art', label: 'Wall art', x: 26.5, y: 2, w: 21, h: 26 },
  { key: 'window_sill', label: 'Window sill', x: 51, y: 2, w: 21, h: 26 },
  { key: 'lights', label: 'Lights', x: 75.5, y: 2, w: 22.5, h: 26 },

  // Row 2
  { key: 'hanging_plant', label: 'Hanging plant', x: 2, y: 34, w: 21, h: 26 },
  { key: 'fridge_door', label: 'Fridge door', x: 26.5, y: 34, w: 21, h: 26 },
  { key: 'counter_left', label: 'Counter (left)', x: 51, y: 34, w: 21, h: 26 },
  { key: 'counter_right', label: 'Counter (right)', x: 75.5, y: 34, w: 22.5, h: 26 },

  // Row 3
  { key: 'stove_top', label: 'Stove top', x: 2, y: 66, w: 21, h: 28 },
  { key: 'table', label: 'Table', x: 26.5, y: 66, w: 21, h: 28 },
  { key: 'rug', label: 'Rug', x: 51, y: 66, w: 21, h: 28 },
  { key: 'floor_corner', label: 'Floor corner', x: 75.5, y: 66, w: 22.5, h: 28 },
]

export const SLOT_KEYS = SLOTS.map((s) => s.key)
