/**
 * Pixel sprites for the 24 decoration catalog entries (issue #751).
 *
 * Each catalog entry's `art` field is a `data:` SVG built from one of the grids
 * below (`decorationArt`), which is the swap the field was designed for (#521):
 * hand-drawn or bought art later is just a different `art` string (a path or URL),
 * because nothing about the layout depends on how the art was made. To keep that
 * true, every grid is exactly the size of its slot in wall units (`kitchen-sprites
 * .test.ts` checks it), so the `<img>` fills the slot at one pixel per wall unit
 * and a replacement image only has to fill the same box.
 *
 * Things that stand on a surface (the counter, the stove, the table, the floor)
 * are drawn at the bottom of their box; things that hang (the plants, the lights,
 * the art) hang from the top.
 *
 * Decorations render the same whatever the theme ("placed decorations stay exactly
 * where they are" when the theme changes), and an image cannot read the page's CSS
 * variables, so the palette is plain hex and the outline is the base ink.
 */
import { spriteDataUri, type PixelPalette, type PixelRows } from '@/lib/kitchen/sprites/pixel'

export const DECORATION_PALETTE: PixelPalette = {
  k: '#5c4a5a',
  w: '#ffffff',
  r: '#ff9aa2',
  p: '#ffb7c5',
  P: '#ff8fab',
  m: '#b5eadc',
  l: '#c9b5e8',
  y: '#ffe0a3',
  Y: '#f5d36b',
  o: '#f5a66b',
  b: '#7fc4f0',
  B: '#a3c4f5',
  g: '#6fbf73',
  G: '#9ed27a',
  n: '#b98556',
  N: '#d9a877',
  s: '#c9d3dc',
  S: '#9aa6b2',
  e: '#e08f6a',
  i: '#eaf6fb',
}

const blank = (w: number, n: number): string[] => Array.from({ length: n }, () => '.'.repeat(w))
const cycle = (pattern: string, n: number): string => pattern.repeat(Math.ceil(n / pattern.length)).slice(0, n)

/** A flat rug, 36 x 7: an ink outline with rounded corners round five rows of `fill`. */
function rug(fill: (row: number, width: number) => string): string[] {
  const edge = '..' + 'k'.repeat(32) + '..'
  return [
    edge,
    '.k' + fill(0, 32) + 'k.',
    'k' + fill(1, 34) + 'k',
    'k' + fill(2, 34) + 'k',
    'k' + fill(3, 34) + 'k',
    '.k' + fill(4, 32) + 'k.',
    edge,
  ]
}

/** The tabletop and legs shared by the two table decorations: 16 wide, 7 tall. */
const TABLE: string[] = [
  'kkkkkkkkkkkkkkkk',
  'kNNNNNNNNNNNNNNk',
  '.kkkkkkkkkkkkkk.',
  '..kNk......kNk..',
  '..kNk......kNk..',
  '..kNk......kNk..',
  '..kNk......kNk..',
]

export const DECORATION_SPRITES: Record<string, PixelRows> = {
  // wall_shelf (6 x 15)
  shelf_mugs: [
    '......', '......', 'kkkk..', 'kppkk.', 'kppkk.', '.kkk..', 'nnnnnn', '.n..n.',
    '..kkkk', '.kkmmk', '.kkmmk', '..kkkk', 'nnnnnn', '.n..n.', '.n..n.',
  ],
  shelf_cookbooks: [
    '......', '......', '......', '......', '......', 'kkkkk.', 'kbbwk.', 'kkkkkk',
    '.krrwk', 'kkkkkk', 'kmmmwk', 'kkkkk.', 'nnnnnn', '.n..n.', '.n..n.',
  ],

  // window_sill (10 x 11)
  sill_succulent: [
    ...blank(10, 3),
    '....gg....', '..g.GG.g..', '..gGGGGg..', '...gGGg...',
    '..kkkkkk..', '...keek...', '...keek...', '...kkkk...',
  ],
  sill_herbs: [
    ...blank(10, 2),
    '..g....g..', '.ggg..ggg.', '.gGg..gGg.', '..g....g..', '..g....g..',
    '.kkkk.kkkk', '.keek.keek', '.keek.keek', '..kk...kk.',
  ],

  // counter_left, counter_right (8 x 5)
  counter_fruit_bowl: ['..kk.kk.', '.krrkrrk', 'kkkkkkkk', 'kBBBBBBk', '.kkkkkk.'],
  counter_kettle: ['...kk...', '.kkkkkk.', 'kmmmmmkk', 'kmmwmmk.', '.kkkkkk.'],
  counter_cutting_board: ['.kkk....', 'krwrk.ss', 'kkkkkkkk', 'kNNNNNNk', '.kkkkkk.'],
  counter_bread: ['..kkkk..', '.knnnnk.', 'knNnNnNk', 'knnnnnnk', 'kkkkkkkk'],

  // fridge_door (16 x 4)
  fridge_magnets: [
    '.rrr.bbb.YYY.mmm',
    '.rwr.bwb.YwY.mwm',
    '.rrr.bbb.YYY.mmm',
    '.kkk.kkk.kkk.kkk',
  ],
  fridge_drawing: [
    '....kkkkkkkk....',
    '....kwrrbbwk....',
    '....kwygGgwk....',
    '....kkkkkkkk....',
  ],

  // rug (36 x 7)
  rug_pastel: rug((row, n) => (row === 0 || row === 4 ? 'P'.repeat(n) : cycle(row === 2 ? 'lpmp' : 'pmpl', n))),
  rug_stripes: rug((_row, n) => cycle('bbwwrr', n)),

  // wall_art (11 x 11)
  art_painting: [
    'kkkkkkkkkkk',
    'kNNNNNNNNNk',
    'kNbbbbbbbNk',
    'kNbbbYYbbNk',
    'kNbbbYYbbNk',
    'kNbbbbbbbNk',
    'kNbbGGbbbNk',
    'kNGGGGGGGNk',
    'kNgggggggNk',
    'kNNNNNNNNNk',
    'kkkkkkkkkkk',
  ],
  art_clock: [
    '...kkkkk...',
    '..kwwwwwk..',
    '.kwwwkwwwk.',
    'kwwwwkwwwwk',
    'kwwwwkwwwwk',
    'kwwwwkkkwwk',
    'kwwwwwwwwwk',
    'kwwwwwwwwwk',
    '.kwwwwwwwk.',
    '..kwwwwwk..',
    '...kkkkk...',
  ],

  // hanging_plant (8 x 13)
  plant_pothos: [
    '...kk...', '...kk...', '.kkkkkk.', 'gkeeeekg', 'gGkeekGg', 'g.kkkk.g', 'gG....Gg',
    'g......g', 'Gg....gG', '.g....g.', '.Gg..gG.', '..g..g..', '..G..G..',
  ],
  plant_ivy: [
    '...kk...', '...kk...', '.kkkkkk.', '.kllllk.', 'G.kllk.G', 'gG.kk.Gg', 'g.G..g.g',
    'gG...gG.', '.g...g..', '.Gg..Gg.', '..g...g.', '..G...G.', '........',
  ],

  // lights (18 x 12)
  lights_string: [
    'k................k',
    '.kk............kk.',
    '..Ykkk......kkk.r.',
    '..Y..rkkkkkk.Y..r.',
    '.....r..b.m..Y....',
    '........b.m.......',
    ...blank(18, 6),
  ],
  lights_lantern: [
    '........kk........',
    '........kk........',
    '.....kkkkkkkk.....',
    '....krrrrrrrrk....',
    '....kreeeeeerk....',
    '....krrrrrrrrk....',
    '....kreeeeeerk....',
    '....krrrrrrrrk....',
    '.....kkkkkkkk.....',
    '........kk........',
    '........rr........',
    '........rr........',
  ],

  // stove_top (11 x 11)
  stove_kettle_pot: [
    '...i...i...',
    '....i.i....',
    '...i...i...',
    '.....k.....',
    '..kkkkkkk..',
    '.kssssssSk.',
    'kkkkkkkkkkk',
    'kkSSSSSSSkk',
    '.kSwSSSSSk.',
    '.kSSSSSSSk.',
    '.kkkkkkkkk.',
  ],
  stove_pan: [
    ...blank(11, 3),
    '....i.i....',
    '...i...i...',
    '....i.i....',
    '...........',
    '..kkkkkkk..',
    '.kSSSSSSSk.',
    'kSSwwYwwSkk',
    '.kkkkkkkkk.',
  ],

  // table (16 x 16)
  table_teapot: [
    ...blank(16, 3),
    '.......kk.......',
    '......kkkk......',
    '....kkkkkkkk....',
    '..kkkmmwmmmkkk..',
    '..k.kmmmmmmk.k..',
    '....kkkkkkkk....',
    ...TABLE,
  ],
  table_flowers: [
    '................',
    '..........r.....',
    '.....p...rwr....',
    '....pYp...r.....',
    '.....p....g.....',
    '.....g....g.....',
    '.....kkkkkk.....',
    '.....kBBBBk.....',
    '......kkkk......',
    ...TABLE,
  ],

  // floor_corner (14 x 17)
  corner_cat_bed: [
    ...blank(14, 10),
    '..kkkkkkkkkk..',
    '.kPPPPPPPPPPk.',
    'kPppppppppppPk',
    'kPppwppppwppPk',
    'kPppppppppppPk',
    '.kPPPPPPPPPPk.',
    '..kkkkkkkkkk..',
  ],
  corner_basket: [
    ...blank(14, 8),
    '....kkkkkk....',
    '...kppppppk...',
    '..kppppppppk..',
    '.kkkkkkkkkkkk.',
    'kNnNnNnNnNnNnk',
    'knNnNnNnNnNnNk',
    'kNnNnNnNnNnNnk',
    'knNnNnNnNnNnNk',
    '.kkkkkkkkkkkk.',
  ],
}

/** The `art` string for a catalog entry. Throws on an id with no sprite: the catalog test lists every id. */
export function decorationArt(id: string): string {
  const rows = DECORATION_SPRITES[id]
  if (!rows) throw new Error(`No pixel sprite for decoration "${id}"`)
  return spriteDataUri(rows, DECORATION_PALETTE)
}
