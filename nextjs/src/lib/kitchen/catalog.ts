/**
 * Decoration catalog for the home-screen kitchen scene (issue #521).
 *
 * Every entry has pixel art (issue #751): `art` is a `data:` SVG drawn in code
 * (`lib/kitchen/sprites/decorations.ts`), one grid per entry the size of its
 * slot. `art` is typed as a string (an asset path or URL), so hand-drawn or bought
 * art can replace any entry's by pointing `art` at a file, with no change to the
 * shape consumers rely on or to the layout (issue #527 tracks that swap). The
 * `emoji` stays as the fallback: an entry without `art` renders it.
 *
 * Every `slot` here must be one of `SLOTS`' keys (enforced in
 * `kitchen-catalog.test.ts`), and every `id` must be unique — `id` is what a
 * `decorations` row's `name` column is expected to match once unlocked
 * (see `lib/api/kitchen.ts`).
 */
import { decorationArt } from '@/lib/kitchen/sprites/decorations'

export interface Decoration {
  id: string
  name: string
  slot: string
  emoji: string
  /** Pixel art for the decoration: an image URL (a path, or a `data:` URI). Unset = the emoji is drawn. */
  art?: string
}

export const CATALOG: Decoration[] = [
  // wall_shelf
  { id: 'shelf_mugs', name: 'Mug collection', slot: 'wall_shelf', emoji: '☕', art: decorationArt('shelf_mugs') },
  { id: 'shelf_cookbooks', name: 'Cookbook stack', slot: 'wall_shelf', emoji: '📚', art: decorationArt('shelf_cookbooks') },

  // window_sill
  { id: 'sill_succulent', name: 'Succulent', slot: 'window_sill', emoji: '🪴', art: decorationArt('sill_succulent') },
  { id: 'sill_herbs', name: 'Herb pots', slot: 'window_sill', emoji: '🌿', art: decorationArt('sill_herbs') },

  // counter_left
  { id: 'counter_fruit_bowl', name: 'Fruit bowl', slot: 'counter_left', emoji: '🍎', art: decorationArt('counter_fruit_bowl') },
  { id: 'counter_kettle', name: 'Kettle', slot: 'counter_left', emoji: '🫖', art: decorationArt('counter_kettle') },

  // counter_right
  { id: 'counter_cutting_board', name: 'Cutting board', slot: 'counter_right', emoji: '🔪', art: decorationArt('counter_cutting_board') },
  { id: 'counter_bread', name: 'Fresh bread', slot: 'counter_right', emoji: '🍞', art: decorationArt('counter_bread') },

  // fridge_door
  { id: 'fridge_magnets', name: 'Fridge magnets', slot: 'fridge_door', emoji: '🧲', art: decorationArt('fridge_magnets') },
  { id: 'fridge_drawing', name: "Kid's drawing", slot: 'fridge_door', emoji: '🖍️', art: decorationArt('fridge_drawing') },

  // rug. There is no rug emoji. These were coloured-square emoji (🟪 🟦), which
  // drew as a bare block on the wall and read as broken art (#748). Yarn and a
  // striped scarf stand in as the fallback now that the rugs have pixel art.
  { id: 'rug_pastel', name: 'Pastel rug', slot: 'rug', emoji: '🧶', art: decorationArt('rug_pastel') },
  { id: 'rug_stripes', name: 'Striped rug', slot: 'rug', emoji: '🧣', art: decorationArt('rug_stripes') },

  // wall_art
  { id: 'art_painting', name: 'Framed painting', slot: 'wall_art', emoji: '🖼️', art: decorationArt('art_painting') },
  { id: 'art_clock', name: 'Kitchen clock', slot: 'wall_art', emoji: '🕐', art: decorationArt('art_clock') },

  // hanging_plant
  { id: 'plant_pothos', name: 'Hanging pothos', slot: 'hanging_plant', emoji: '🌱', art: decorationArt('plant_pothos') },
  { id: 'plant_ivy', name: 'Trailing ivy', slot: 'hanging_plant', emoji: '🍃', art: decorationArt('plant_ivy') },

  // lights
  { id: 'lights_string', name: 'String lights', slot: 'lights', emoji: '✨', art: decorationArt('lights_string') },
  { id: 'lights_lantern', name: 'Paper lantern', slot: 'lights', emoji: '🏮', art: decorationArt('lights_lantern') },

  // stove_top
  { id: 'stove_kettle_pot', name: 'Simmering pot', slot: 'stove_top', emoji: '🍲', art: decorationArt('stove_kettle_pot') },
  { id: 'stove_pan', name: 'Frying pan', slot: 'stove_top', emoji: '🍳', art: decorationArt('stove_pan') },

  // table
  { id: 'table_teapot', name: 'Teapot set', slot: 'table', emoji: '🍵', art: decorationArt('table_teapot') },
  { id: 'table_flowers', name: 'Flower vase', slot: 'table', emoji: '💐', art: decorationArt('table_flowers') },

  // floor_corner
  { id: 'corner_cat_bed', name: "Bubbly's bed", slot: 'floor_corner', emoji: '🛏️', art: decorationArt('corner_cat_bed') },
  { id: 'corner_basket', name: 'Wicker basket', slot: 'floor_corner', emoji: '🧺', art: decorationArt('corner_basket') },
]
