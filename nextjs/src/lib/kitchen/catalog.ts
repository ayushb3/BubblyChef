/**
 * Decoration catalog for the home-screen kitchen scene (issue #521).
 *
 * Placeholder art: every entry renders as an emoji today. `art` is typed as
 * an optional string (an asset path/URL) so real sprite art can be dropped
 * in later without changing the shape consumers rely on.
 *
 * Every `slot` here must be one of `SLOTS`' keys (enforced in
 * `kitchen-catalog.test.ts`), and every `id` must be unique — `id` is what a
 * `decorations` row's `name` column is expected to match once unlocked
 * (see `lib/api/kitchen.ts`).
 */
import { SLOT_KEYS } from './slots'

export interface Decoration {
  id: string
  name: string
  slot: string
  emoji: string
  /** Optional real-art asset path/URL — unset today, placeholder emoji only. */
  art?: string
}

export const CATALOG: Decoration[] = [
  // wall_shelf
  { id: 'shelf_mugs', name: 'Mug collection', slot: 'wall_shelf', emoji: '☕' },
  { id: 'shelf_cookbooks', name: 'Cookbook stack', slot: 'wall_shelf', emoji: '📚' },

  // window_sill
  { id: 'sill_succulent', name: 'Succulent', slot: 'window_sill', emoji: '🪴' },
  { id: 'sill_herbs', name: 'Herb pots', slot: 'window_sill', emoji: '🌿' },

  // counter_left
  { id: 'counter_fruit_bowl', name: 'Fruit bowl', slot: 'counter_left', emoji: '🍎' },
  { id: 'counter_kettle', name: 'Kettle', slot: 'counter_left', emoji: '🫖' },

  // counter_right
  { id: 'counter_cutting_board', name: 'Cutting board', slot: 'counter_right', emoji: '🔪' },
  { id: 'counter_bread', name: 'Fresh bread', slot: 'counter_right', emoji: '🍞' },

  // fridge_door
  { id: 'fridge_magnets', name: 'Fridge magnets', slot: 'fridge_door', emoji: '🧲' },
  { id: 'fridge_drawing', name: "Kid's drawing", slot: 'fridge_door', emoji: '🖍️' },

  // rug
  { id: 'rug_pastel', name: 'Pastel rug', slot: 'rug', emoji: '🟪' },
  { id: 'rug_stripes', name: 'Striped rug', slot: 'rug', emoji: '🟦' },

  // wall_art
  { id: 'art_painting', name: 'Framed painting', slot: 'wall_art', emoji: '🖼️' },
  { id: 'art_clock', name: 'Kitchen clock', slot: 'wall_art', emoji: '🕐' },

  // hanging_plant
  { id: 'plant_pothos', name: 'Hanging pothos', slot: 'hanging_plant', emoji: '🌱' },
  { id: 'plant_ivy', name: 'Trailing ivy', slot: 'hanging_plant', emoji: '🍃' },

  // lights
  { id: 'lights_string', name: 'String lights', slot: 'lights', emoji: '✨' },
  { id: 'lights_lantern', name: 'Paper lantern', slot: 'lights', emoji: '🏮' },

  // stove_top
  { id: 'stove_kettle_pot', name: 'Simmering pot', slot: 'stove_top', emoji: '🍲' },
  { id: 'stove_pan', name: 'Frying pan', slot: 'stove_top', emoji: '🍳' },

  // table
  { id: 'table_teapot', name: 'Teapot set', slot: 'table', emoji: '🍵' },
  { id: 'table_flowers', name: 'Flower vase', slot: 'table', emoji: '💐' },

  // floor_corner
  { id: 'corner_cat_bed', name: "Bubbles' bed", slot: 'floor_corner', emoji: '🛏️' },
  { id: 'corner_basket', name: 'Wicker basket', slot: 'floor_corner', emoji: '🧺' },
]

/** Every slot key `CATALOG` must cover — used only by the catalog test. */
export const CATALOG_SLOT_KEYS = SLOT_KEYS
